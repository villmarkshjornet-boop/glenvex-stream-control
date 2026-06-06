/**
 * POST /api/content-factory/thumbnails/generate
 *
 * Isolert AI-thumbnail-generator på Vercel.
 * - Ingen ffmpeg
 * - Ingen store videofiler lastes ned
 * - Thumbnail-feil setter aldri clip_status
 * - maxDuration=60 for å gi DALL-E nok tid
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Copy-generering ───────────────────────────────────────────────────────────

async function lagCopy(
  client: OpenAI,
  highlight: any,
  vod: any,
  copies: any[]
): Promise<{ headline: string; subheadline: string; style: string }> {
  const ytCopy = copies.find((c: any) => c.platform === 'youtube');
  const ttCopy = copies.find((c: any) => c.platform === 'tiktok');

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Du er ekspert på gaming YouTube/TikTok thumbnails for norsk streamer GLENVEX.
Svar KUN med JSON: {"headline":"...","subheadline":"...","style":"..."}
headline: 2–5 ORD, STORE BOKSTAVER, norsk, høy klikkverdi
Eksempler: "DETTE VAR SYKT", "HAN HADDE IKKE SJANS", "BOSSEN BLE KNUST", "RP DRAMA ESKALERTE"
subheadline: maks 5 ord eller tom string
style: én setning visuell retning`,
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
      max_tokens: 120,
      temperature: 0.85,
    });
    const text = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  const headline =
    highlight.category === 'FUNNY'     ? 'DETTE VAR SYKT' :
    highlight.category === 'CLUTCH'    ? 'UTROLIG REDNING' :
    highlight.category === 'FAIL'      ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'      ? 'HAN MISTET DET' :
    highlight.category === 'RP_MOMENT' ? 'RP DRAMA' :
    'SJEKK DETTE';
  return { headline, subheadline: '', style: 'Dramatisk og mørk med neon-grønt' };
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

  // Kort, trygg prompt som unngår content-policy-triggere
  return `${format} gaming channel thumbnail. Video game scene from ${spill}. ` +
    `Bold white text "${copy.headline}" at ${tekstPos}. ` +
    `${copy.subheadline ? `Smaller text "${copy.subheadline}" below. ` : ''}` +
    `Dark background, neon green color accents, high contrast, professional esports style. ` +
    `No violence, no blood, no weapons visible. Clean graphic design.`;
}

// ── Last ned PNG fra URL ──────────────────────────────────────────────────────

async function hentPng(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

// ── Generer bilde med gpt-image-1 ─────────────────────────────────────────────

async function genererBilde(
  client: OpenAI,
  prompt: string,
  size: '1536x1024' | '1024x1536',
): Promise<{ buf: Buffer | null; err: string | null }> {
  try {
    const res = await (client.images.generate as any)({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size,
      quality: 'medium',
    });
    const item = res?.data?.[0];
    if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64'), err: null };
    if (item?.url) return { buf: await hentPng(item.url), err: null };
    return { buf: null, err: 'Tomt svar fra API' };
  } catch (e: any) {
    return { buf: null, err: String(e?.message ?? e).slice(0, 300) };
  }
}

// ── Last opp til Supabase Storage ─────────────────────────────────────────────

async function lastOpp(db: any, buf: Buffer, sti: string): Promise<string | null> {
  try {
    const { error } = await db.storage.from('glenvex-assets').upload(sti, buf, {
      contentType: 'image/png',
      upsert: true,
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

  // Hent highlight (bare nødvendige felt)
  const { data: h, error: hErr } = await db
    .from('content_highlights')
    .select('id,vod_id,title,category,begrunnelse,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId)
    .single();

  if (hErr || !h) {
    return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  }
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json(
      { error: `Highlight er ikke klippet ennå (clip_status = ${h.clip_status})` },
      { status: 400 }
    );
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

    // Hent vod + captions parallelt
    const [vodRes, copiesRes] = await Promise.all([
      db.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      db.from('content_copy').select('platform,tittel,caption').eq('highlight_id', highlightId),
    ]);
    const vod = vodRes.data;
    const copies = copiesRes.data ?? [];

    // Lag thumbnail-tekst
    const copy = await lagCopy(client, h, vod, copies);

    const ytPrompt = byggPrompt('youtube', h, vod, copy);
    const ttPrompt = byggPrompt('tiktok', h, vod, copy);

    // Generer begge formater parallelt med gpt-image-1
    const [ytResult, ttResult] = await Promise.all([
      genererBilde(client, ytPrompt, '1536x1024'),
      genererBilde(client, ttPrompt, '1024x1536'),
    ]);

    const baseSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}`;
    const [ytUrl, ttUrl] = await Promise.all([
      ytResult.buf ? lastOpp(db, ytResult.buf, `${baseSti}_youtube.png`) : Promise.resolve(null),
      ttResult.buf ? lastOpp(db, ttResult.buf, `${baseSti}_tiktok.png`) : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) {
      const detaljer = [
        ytResult.err ? `YouTube: ${ytResult.err}` : null,
        ttResult.err ? `TikTok: ${ttResult.err}` : null,
      ].filter(Boolean).join(' | ');
      throw new Error(`Bildegenerering feilet${detaljer ? `: ${detaljer}` : ''}`);
    }

    // Lagre til DB – clip_status røres ALDRI
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
      thumbnail_youtube_url: ytUrl,
      thumbnail_tiktok_url:  ttUrl,
    });

  } catch (err: any) {
    const msg = (err.message ?? 'Ukjent feil').slice(0, 300);
    // Sett FAILED – clip_status røres ALDRI
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
