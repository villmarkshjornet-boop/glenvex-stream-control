import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Thumbnail-tekst via GPT-4o-mini ──────────────────────────────────────────

async function lagThumbnailTekst(
  client: OpenAI,
  highlight: any,
  vod: any,
  copies: any[]
): Promise<{ headline: string; subheadline: string; style: string }> {
  const ytCopy = copies.find((c: any) => c.platform === 'youtube');
  const ttCopy = copies.find((c: any) => c.platform === 'tiktok');

  const system = `Du er ekspert på gaming YouTube/TikTok thumbnails for norsk streamer GLENVEX.
Lag thumbnail-tekst. Svar KUN med JSON: {"headline":"...","subheadline":"...","style":"..."}
headline: 2–5 ORD, STORE BOKSTAVER, norsk, høy klikkverdi (eks: "DETTE VAR SYKT", "HAN HADDE IKKE SJANS", "BOSSEN BLE KNUST")
subheadline: maks 5 ord, norsk, kan være tom string
style: én setning om visuell stil`;

  const user = [
    `Tittel: ${highlight.title ?? 'Ukjent'}`,
    `Kategori: ${highlight.category ?? 'Ukjent'}`,
    `Spill: ${vod?.category ?? 'Ukjent'}`,
    highlight.begrunnelse ? `Begrunnelse: ${highlight.begrunnelse}` : '',
    ytCopy?.tittel ? `YouTube-tittel: ${ytCopy.tittel}` : '',
    ttCopy?.caption ? `TikTok-caption: ${ttCopy.caption}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 120,
      temperature: 0.85,
    });
    const text = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  const fallback =
    highlight.category === 'FUNNY'     ? 'DETTE VAR SYKT' :
    highlight.category === 'CLUTCH'    ? 'UTROLIG REDNING' :
    highlight.category === 'FAIL'      ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'      ? 'HAN MISTET DET' :
    highlight.category === 'RP_MOMENT' ? 'RP DRAMA' :
    'SJEKK DETTE';
  return { headline: fallback, subheadline: '', style: 'Dramatisk og mørk med neon-grønt' };
}

// ── DALL-E-3 prompt ───────────────────────────────────────────────────────────

function byggPrompt(
  platform: 'youtube' | 'tiktok',
  highlight: any,
  vod: any,
  copy: { headline: string; subheadline: string; style: string }
): string {
  const spill = vod?.category ?? vod?.title ?? 'video game';
  const format = platform === 'youtube' ? '1792x1024 landscape' : '1024x1792 vertical';
  const tekstPos = platform === 'youtube' ? 'bottom third' : 'centered';

  return `${format} gaming channel thumbnail. Video game scene from ${spill}. ` +
    `Bold white text "${copy.headline}" at ${tekstPos}. ` +
    `${copy.subheadline ? `Smaller text "${copy.subheadline}" below. ` : ''}` +
    `Dark background, neon green color accents, high contrast, professional esports style. ` +
    `No violence, no blood, no weapons visible. Clean graphic design.`;
}

// ── Hent PNG-bytes fra DALL-E URL ─────────────────────────────────────────────

async function hentPng(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

// ── Last opp til Supabase Storage ─────────────────────────────────────────────

async function lastOpp(db: any, buf: Buffer, storageSti: string): Promise<string | null> {
  try {
    const { error } = await db.storage.from('glenvex-assets').upload(storageSti, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) return null;
    const { data } = db.storage.from('glenvex-assets').getPublicUrl(storageSti);
    return (data as any)?.publicUrl ?? null;
  } catch { return null; }
}

// ── Hoved-route ───────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: { highlightId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { highlightId } = params;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 500 });

  // Hent highlight
  const { data: h, error: fetchErr } = await db
    .from('content_highlights')
    .select('id,vod_id,title,category,begrunnelse,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId)
    .single();

  if (fetchErr || !h) {
    return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  }
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json({ error: `clip_status er ${h.clip_status}, ikke CLIPPED` }, { status: 400 });
  }
  if (!h.clip_url && !h.vertical_clip_url) {
    return NextResponse.json({ error: 'Ingen video-URL' }, { status: 400 });
  }

  // Sett GENERATING umiddelbart
  await db.from('content_highlights')
    .update({ thumbnail_status: 'GENERATING', thumbnail_error: null })
    .eq('id', highlightId);

  try {
    const client = new OpenAI({ apiKey });

    // Hent vod + captions parallelt
    const [vodRes, copiesRes] = await Promise.all([
      db.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      db.from('content_copy').select('platform,tittel,caption').eq('highlight_id', highlightId),
    ]);
    const vod = vodRes.data;
    const copies = copiesRes.data ?? [];

    // Generer thumbnail-tekst
    const copy = await lagThumbnailTekst(client, h, vod, copies);

    const ytPrompt = byggPrompt('youtube', h, vod, copy);
    const ttPrompt = byggPrompt('tiktok', h, vod, copy);

    // Generer begge thumbnails parallelt – fang faktisk feilmelding
    let ytErr: string | null = null;
    let ttErr: string | null = null;
    const [ytRes, ttRes] = await Promise.all([
      client.images.generate({
        model: 'dall-e-3', prompt: ytPrompt, n: 1,
        size: '1792x1024', quality: 'standard',
      }).catch((e: any) => { ytErr = String(e?.message ?? e).slice(0, 300); return null; }),
      client.images.generate({
        model: 'dall-e-3', prompt: ttPrompt, n: 1,
        size: '1024x1792', quality: 'standard',
      }).catch((e: any) => { ttErr = String(e?.message ?? e).slice(0, 300); return null; }),
    ]);

    // Last ned PNG-bytes og last opp parallelt
    const [ytBuf, ttBuf] = await Promise.all([
      ytRes?.data?.[0]?.url ? hentPng(ytRes.data[0].url!) : Promise.resolve(null),
      ttRes?.data?.[0]?.url ? hentPng(ttRes.data[0].url!) : Promise.resolve(null),
    ]);

    const [ytUrl, ttUrl] = await Promise.all([
      ytBuf ? lastOpp(db, ytBuf, `content-factory/thumbnails/${h.vod_id}/${highlightId}_youtube.png`) : Promise.resolve(null),
      ttBuf ? lastOpp(db, ttBuf, `content-factory/thumbnails/${h.vod_id}/${highlightId}_tiktok.png`) : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) {
      const detaljer = [
        ytErr ? `YouTube: ${ytErr}` : null,
        ttErr ? `TikTok: ${ttErr}` : null,
      ].filter(Boolean).join(' | ');
      throw new Error(`DALL-E feilet${detaljer ? `: ${detaljer}` : ''}`);
    }

    // Oppdater DB
    await db.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl ?? null,
      thumbnail_tiktok_url:   ttUrl ?? null,
      thumbnail_prompt:       ytPrompt,
      thumbnail_headline:     copy.headline,
      thumbnail_subheadline:  copy.subheadline || null,
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
    }).eq('id', highlightId);

    return NextResponse.json({
      ok: true,
      melding: 'Thumbnails generert',
      harYoutube: !!ytUrl,
      harTiktok: !!ttUrl,
    });

  } catch (err: any) {
    const msg = err.message?.slice(0, 300) ?? 'Ukjent feil';
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
