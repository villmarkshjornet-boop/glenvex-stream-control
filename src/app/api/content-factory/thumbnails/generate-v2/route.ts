/**
 * POST /api/content-factory/thumbnails/generate-v2
 *
 * Frame-basert thumbnail-generering.
 * 1. Henter frames fra Railway (ffmpeg)
 * 2. Velger beste frame med GPT-4o-mini Vision
 * 3. Redigerer frame med gpt-image-1 images.edit → YouTube + TikTok
 * 4. Faller tilbake til V1 (prompt-only) hvis noe feiler
 *
 * clip_status røres ALDRI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import OpenAI, { toFile } from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(step: string, detail = '') {
  console.log(`[THUMB_V2] ${step}${detail ? ': ' + detail : ''}`);
}

// ── Railway frame-fetch ───────────────────────────────────────────────────────

interface FrameData { t: number; b64: string }
interface FrameResponse {
  landscape_frames: FrameData[];
  portrait_frame: FrameData | null;
  duration: number;
}

async function hentFrames(highlightId: string): Promise<FrameResponse | null> {
  const botUrl = process.env.BOT_API_URL;
  if (!botUrl) return null;
  try {
    const res = await fetch(`${botUrl}/content-factory/frames/${highlightId}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as FrameResponse;
  } catch { return null; }
}

// ── Vision: velg beste frame ──────────────────────────────────────────────────

async function velgBesteFrame(client: OpenAI, frames: FrameData[]): Promise<number> {
  if (frames.length <= 1) return 0;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `These are ${frames.length} frames from a video game clip. Which frame would make the best YouTube thumbnail? Consider: good action, clear subject, minimal HUD clutter, interesting composition. Reply with ONLY the number 1, 2, or ${frames.length}.`,
          },
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/jpeg;base64,${f.b64}`, detail: 'low' as const },
          })),
        ],
      }],
    }, { signal: ctrl.signal } as any);
    clearTimeout(tid);
    const n = parseInt(res.choices[0]?.message?.content?.trim() ?? '');
    if (!isNaN(n) && n >= 1 && n <= frames.length) return n - 1;
    return Math.floor(frames.length / 2);
  } catch {
    clearTimeout(tid);
    return Math.floor(frames.length / 2); // fallback: midterste frame
  }
}

// ── Copy-generering ───────────────────────────────────────────────────────────

async function lagCopy(
  client: OpenAI,
  highlight: any,
  vod: any,
  copies: any[]
): Promise<{ headline: string; subheadline: string }> {
  const ytCopy = copies.find((c: any) => c.platform === 'youtube');
  const ttCopy = copies.find((c: any) => c.platform === 'tiktok');
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content: `Du er ekspert på gaming thumbnail-tekster for norsk streamer GLENVEX.
Svar KUN med JSON: {"headline":"...","subheadline":"..."}
headline: 2–5 ORD, STORE BOKSTAVER, norsk, klikkbar
Eksempler: "DETTE VAR SYKT", "HAN HADDE IKKE SJANS", "BOSSEN BLE KNUST"
subheadline: maks 5 ord eller tom string`,
        },
        {
          role: 'user',
          content: [
            `Klipp: ${highlight.title ?? 'Ukjent'}`,
            `Kategori: ${highlight.category ?? ''}`,
            `Spill: ${vod?.category ?? vod?.title ?? ''}`,
            highlight.begrunnelse ? `Begrunnelse: ${highlight.begrunnelse}` : '',
            ytCopy?.tittel ? `YouTube-tittel: ${ytCopy.tittel}` : '',
            ttCopy?.caption ? `TikTok-caption: ${ttCopy.caption}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
    });
    const match = (res.choices[0]?.message?.content ?? '').match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  const headline =
    highlight.category === 'FUNNY'     ? 'DETTE VAR SYKT' :
    highlight.category === 'CLUTCH'    ? 'UTROLIG REDNING' :
    highlight.category === 'FAIL'      ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'      ? 'HAN MISTET DET' :
    highlight.category === 'RP_MOMENT' ? 'RP DRAMA' :
    'SJEKK DETTE';
  return { headline, subheadline: '' };
}

// ── Bygg edit-prompt ──────────────────────────────────────────────────────────

function byggEditPrompt(
  platform: 'youtube' | 'tiktok',
  copy: { headline: string; subheadline: string },
  game: string
): string {
  const pos = platform === 'youtube' ? 'in the lower third' : 'centered vertically';
  return `Transform this video game screenshot into a professional ${platform === 'youtube' ? 'YouTube' : 'TikTok'} gaming thumbnail for Norwegian Twitch streamer GLENVEX playing ${game || 'a video game'}.
Keep the exact same characters, environment, colors, and composition. Do NOT add new characters or change the scene.
Add large bold white text "${copy.headline}" ${pos}, with a dark drop shadow.
${copy.subheadline ? `Add smaller white text "${copy.subheadline}" just below.` : ''}
Slightly increase contrast and saturation. Add subtle neon green color accents on existing light sources.
No additional text, no logos, no extra UI elements.`;
}

// ── gpt-image-1 image edit ────────────────────────────────────────────────────

async function redigerThumbnail(
  client: OpenAI,
  frameB64: string,
  prompt: string,
  size: '1536x1024' | '1024x1536'
): Promise<Buffer | null> {
  try {
    const buf = Buffer.from(frameB64, 'base64');
    const imageFile = await toFile(buf, 'frame.jpg', { type: 'image/jpeg' });
    const res = await (client.images.edit as any)({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      n: 1,
      size,
      quality: 'medium',
    });
    const item = res?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) {
      const r = await fetch(item.url, { signal: AbortSignal.timeout(15_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }
    return null;
  } catch (e: any) {
    log('IMAGE_EDIT_ERROR', String(e?.message ?? e).slice(0, 200));
    return null;
  }
}

// ── gpt-image-1 generate (V1 fallback) ───────────────────────────────────────

async function genererV1(
  client: OpenAI,
  prompt: string,
  size: '1536x1024' | '1024x1536'
): Promise<Buffer | null> {
  try {
    const res = await (client.images.generate as any)({
      model: 'gpt-image-1', prompt, n: 1, size, quality: 'medium',
    });
    const item = res?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) {
      const r = await fetch(item.url, { signal: AbortSignal.timeout(15_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }
    return null;
  } catch (e: any) {
    log('V1_GENERATE_ERROR', String(e?.message ?? e).slice(0, 200));
    return null;
  }
}

function byggV1Prompt(
  platform: 'youtube' | 'tiktok',
  copy: { headline: string; subheadline: string },
  game: string
): string {
  const format = platform === 'youtube' ? '1536x1024 landscape' : '1024x1536 vertical';
  const pos = platform === 'youtube' ? 'bottom third' : 'centered';
  return `${format} gaming channel thumbnail. Video game scene from ${game || 'a video game'}. ` +
    `Bold white text "${copy.headline}" at ${pos}. ` +
    `${copy.subheadline ? `Smaller text "${copy.subheadline}" below. ` : ''}` +
    `Dark background, neon green color accents, high contrast, professional esports style. ` +
    `No violence, no blood, no weapons visible. Clean graphic design.`;
}

// ── Last opp til Supabase Storage ─────────────────────────────────────────────

async function lastOpp(db: any, buf: Buffer, sti: string): Promise<string | null> {
  try {
    const { error } = await db.storage.from('glenvex-assets').upload(sti, buf, {
      contentType: 'image/png', upsert: true,
    });
    if (error) return null;
    const { data } = db.storage.from('glenvex-assets').getPublicUrl(sti);
    return (data as any)?.publicUrl ?? null;
  } catch { return null; }
}

// ── Hoved-handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 500 });

  let highlightId: string;
  try {
    const body = await req.json();
    highlightId = body.highlight_id;
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON – send { highlight_id }' }, { status: 400 });
  }
  if (!highlightId) return NextResponse.json({ error: 'highlight_id kreves' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const { data: h, error: hErr } = await db
    .from('content_highlights')
    .select('id,vod_id,title,category,begrunnelse,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId)
    .single();

  if (hErr || !h) return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json({ error: `clip_status = ${h.clip_status}, ikke CLIPPED` }, { status: 400 });
  }
  if (!h.clip_url && !h.vertical_clip_url) {
    return NextResponse.json({ error: 'Ingen video-URL på highlightet' }, { status: 400 });
  }

  // Sett GENERATING – ALDRI rør clip_status
  await db.from('content_highlights')
    .update({ thumbnail_status: 'GENERATING', thumbnail_error: null })
    .eq('id', highlightId);

  try {
    const client = new OpenAI({ apiKey });

    const [vodRes, copiesRes] = await Promise.all([
      db.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      db.from('content_copy').select('platform,tittel,caption').eq('highlight_id', highlightId),
    ]);
    const vod = vodRes.data;
    const copies = copiesRes.data ?? [];
    const game = vod?.category ?? vod?.title ?? 'video game';

    const copy = await lagCopy(client, h, vod, copies);

    // ── Prøv V2: hent frames fra Railway ─────────────────────────────────────
    log('FRAME_EXTRACTION_STARTED', highlightId);
    const frameData = await hentFrames(highlightId);

    let ytBuf: Buffer | null = null;
    let ttBuf: Buffer | null = null;
    let bruktV2 = false;

    if (frameData && frameData.landscape_frames.length > 0) {
      // Velg beste landscape-frame
      const bestIdx = await velgBesteFrame(client, frameData.landscape_frames);
      const bestFrame = frameData.landscape_frames[bestIdx];
      const portraitFrame = frameData.portrait_frame ?? bestFrame;
      log('FRAME_SELECTED', `frame ${bestIdx + 1} av ${frameData.landscape_frames.length} (t=${bestFrame.t}s)`);

      log('IMAGE_EDIT_STARTED');
      const ytPrompt = byggEditPrompt('youtube', copy, game);
      const ttPrompt = byggEditPrompt('tiktok', copy, game);

      // Rediger begge parallelt
      [ytBuf, ttBuf] = await Promise.all([
        redigerThumbnail(client, bestFrame.b64, ytPrompt, '1536x1024'),
        redigerThumbnail(client, portraitFrame.b64, ttPrompt, '1024x1536'),
      ]);
      log('IMAGE_EDIT_DONE', `yt=${!!ytBuf} tt=${!!ttBuf}`);
      bruktV2 = !!(ytBuf || ttBuf);
    }

    // ── Fallback til V1 hvis V2 feilet ───────────────────────────────────────
    if (!ytBuf && !ttBuf) {
      log('FALLBACK_TO_V1', frameData ? 'image edit feilet' : 'ingen frames fra Railway');
      const ytPrompt = byggV1Prompt('youtube', copy, game);
      const ttPrompt = byggV1Prompt('tiktok', copy, game);
      [ytBuf, ttBuf] = await Promise.all([
        genererV1(client, ytPrompt, '1536x1024'),
        genererV1(client, ttPrompt, '1024x1536'),
      ]);
    }

    // ── Last opp ──────────────────────────────────────────────────────────────
    const baseSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}`;
    const [ytUrl, ttUrl] = await Promise.all([
      ytBuf ? lastOpp(db, ytBuf, `${baseSti}_youtube.png`) : Promise.resolve(null),
      ttBuf ? lastOpp(db, ttBuf, `${baseSti}_tiktok.png`) : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) throw new Error('Ingen thumbnails klarte å bli lastet opp');

    // ── Lagre til DB – clip_status røres ALDRI ────────────────────────────────
    await db.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl ?? null,
      thumbnail_tiktok_url:   ttUrl ?? null,
      thumbnail_prompt:       bruktV2 ? byggEditPrompt('youtube', copy, game) : byggV1Prompt('youtube', copy, game),
      thumbnail_headline:     copy.headline,
      thumbnail_subheadline:  copy.subheadline || null,
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
    }).eq('id', highlightId);

    log('THUMBNAIL_V2_DONE', `bruktV2=${bruktV2} yt=${!!ytUrl} tt=${!!ttUrl}`);
    return NextResponse.json({ ok: true, thumbnail_youtube_url: ytUrl, thumbnail_tiktok_url: ttUrl, v2: bruktV2 });

  } catch (err: any) {
    const msg = (err.message ?? 'Ukjent feil').slice(0, 300);
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
