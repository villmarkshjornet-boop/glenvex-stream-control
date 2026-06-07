/**
 * AI Thumbnail Generator – isolert modul, påvirker ikke clip-pipeline.
 *
 * Flyt per highlight:
 *   1. Last ned ferdig klipp fra Supabase Storage
 *   2. Trekk ut frame-kandidater med ffmpeg
 *   3. Velg beste frame (posisjon + GPT-4o Vision som opt-in)
 *   4. Generer thumbnail-tekst (GPT-4o-mini)
 *   5. Generer YouTube-thumbnail (1792×1024) og TikTok-thumbnail (1024×1792) via DALL-E-3
 *   6. Last opp PNG-er til Supabase Storage
 *   7. Oppdater content_highlights med URL-er og status
 *
 * Thumbnail-feil setter aldri clip_status til FAILED.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { logBotEvent } from './botEvents';
import { logSystemEvent } from './systemEvents';

const execAsync = require('util').promisify(require('child_process').exec);

const THUMB_BASE = path.join(process.cwd(), 'data', 'thumbnails');
const MAX_CONCURRENT = 2;

const generererNå = new Set<string>();
let syklusTeller = 0;

// ── Ring-buffer logger (same pattern as clipWorker) ───────────────────────────

const LOG_RING: Array<{ ts: string; level: string; event: string; data?: Record<string, any> }> = [];

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  const entry: { ts: string; level: string; event: string; data?: Record<string, any> } = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  if (data) entry.data = data;
  LOG_RING.push(entry);
  if (LOG_RING.length > 100) LOG_RING.shift();
  const suffix = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[ThumbnailWorker][${level}] ${event}${suffix}`);
}

export function getThumbnailWorkerStatus() {
  return {
    enabled: process.env.CONTENT_FACTORY_ENABLED === 'true' && !!process.env.OPENAI_API_KEY,
    aktive: Array.from(generererNå),
    pollCount: syklusTeller,
    lastLogs: LOG_RING.slice(-20),
  };
}

// ── Hjelpe-funksjoner ─────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function sikreDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ryddFiler(...paths: string[]) {
  for (const p of paths) try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

function ryddDir(dir: string) {
  try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

async function lastNedFil(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch (err: any) {
    wLog('ERROR', 'DOWNLOAD_FAIL', { url: url.slice(0, 80), err: err.message?.slice(0, 100) });
    return false;
  }
}

// ── Varighetsmåling og frame-ekstraksjon ──────────────────────────────────────

async function hentVideoDuration(videoSti: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoSti}"`,
      { timeout: 15_000 }
    );
    const d = JSON.parse(stdout) as any;
    return parseFloat(d?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

interface Frame {
  path: string;
  percent: number;
}

async function hentFrames(videoSti: string, highlightId: string): Promise<Frame[]> {
  wLog('INFO', 'THUMBNAIL_FRAME_EXTRACTION_STARTED', { highlightId });
  const durSek = await hentVideoDuration(videoSti);
  const frameDir = path.join(THUMB_BASE, highlightId, 'frames');
  sikreDir(frameDir);

  const percentages = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const frames: Frame[] = [];

  for (const pct of percentages) {
    const sek = Math.min((durSek * pct) / 100, durSek - 0.5);
    const frameSti = path.join(frameDir, `frame_${String(pct).padStart(2, '0')}.jpg`);
    try {
      await execAsync(
        `ffmpeg -y -ss ${sek.toFixed(2)} -i "${videoSti}" -vf "scale=640:360" -frames:v 1 -q:v 3 "${frameSti}"`,
        { timeout: 20_000 }
      );
      // Forkast frames som er for små (svart/tom)
      if (fs.existsSync(frameSti) && fs.statSync(frameSti).size > 4_000) {
        frames.push({ path: frameSti, percent: pct });
      }
    } catch {}
  }

  if (frames.length > 0) {
    wLog('INFO', 'THUMBNAIL_FRAMES_EXTRACTED', { highlightId, antall: frames.length });
  } else {
    wLog('ERROR', 'THUMBNAIL_FRAME_EXTRACTION_FAILED', { highlightId });
  }
  return frames;
}

// ── Frame-scoring og Vision ───────────────────────────────────────────────────

function velgBestFrameEnkel(frames: Frame[]): Frame | null {
  if (frames.length === 0) return null;
  // Foretrekk frames nær midten (40–60 %)
  return [...frames].sort((a, b) => Math.abs(a.percent - 50) - Math.abs(b.percent - 50))[0];
}

async function analyserMedVision(
  client: OpenAI,
  frames: Frame[],
  highlightId: string
): Promise<{ bestFrame: Frame; description: string }> {
  const fallback = velgBestFrameEnkel(frames)!;

  if (frames.length === 0) return { bestFrame: fallback, description: '' };

  wLog('INFO', 'THUMBNAIL_FRAME_SCORING_STARTED', { highlightId, antall: frames.length });

  // Send de 3 beste kandidatene (nærmest midten) til Vision
  const sortert = [...frames].sort((a, b) => Math.abs(a.percent - 50) - Math.abs(b.percent - 50));
  const kandidater = sortert.slice(0, Math.min(3, sortert.length));

  try {
    const imageContent: any[] = kandidater.map(f => {
      const b64 = fs.readFileSync(f.path).toString('base64');
      return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' } };
    });
    imageContent.push({
      type: 'text',
      text: `These are ${kandidater.length} frames from a gaming clip (at ${kandidater.map(f => f.percent + '%').join(', ')} through the video).
Which frame (1, 2, or 3 from left to right) would make the most impactful gaming thumbnail? Consider: visual interest, intense action, visible faces, dramatic moments.
Also describe what is happening in the best frame in 2–3 sentences for thumbnail generation.
Reply ONLY with JSON: {"best": 1, "description": "..."}`,
    });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: imageContent }],
      max_tokens: 220,
      temperature: 0.3,
    });

    const text = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { best?: number; description?: string };
      const idx = Math.max(0, (parsed.best ?? 1) - 1);
      const bestFrame = kandidater[idx] ?? fallback;
      wLog('INFO', 'THUMBNAIL_BEST_FRAME_SELECTED', { highlightId, percent: bestFrame.percent, visionBrukt: true });
      return { bestFrame, description: parsed.description ?? '' };
    }
  } catch (err: any) {
    wLog('WARN', 'VISION_FAILED', { highlightId, err: err.message?.slice(0, 100) });
  }

  wLog('INFO', 'THUMBNAIL_BEST_FRAME_SELECTED', { highlightId, percent: fallback.percent, visionBrukt: false });
  wLog('INFO', 'THUMBNAIL_FRAME_SCORING_FALLBACK_USED', { highlightId });
  return { bestFrame: fallback, description: '' };
}

// ── Thumbnail-tekst (headline / subheadline) ──────────────────────────────────

interface ThumbnailCopy {
  headline: string;
  subheadline: string;
  style_direction: string;
}

async function generateThumbnailCopy(
  client: OpenAI,
  highlight: any,
  vod: any,
  creatorContext: string
): Promise<ThumbnailCopy> {
  const system = `Du er ekspert på gaming YouTube/TikTok thumbnails for norsk Twitch-streamer GLENVEX.
Lag thumbnail-tekst basert på klippet.

Regler for headline:
- 2–5 ORD maksimum, STORE BOKSTAVER
- Norsk, høy klikkverdi, stem med klippets faktiske innhold
- Eksempler: "DETTE VAR SYKT", "HAN HADDE IKKE SJANS", "JEG OVERLEVDE SÅVIDT", "BOSSEN BLE KNUST", "CHAT KLIKKET", "RP DRAMA ESKALERTE"

Svar KUN med JSON:
{"headline": "...", "subheadline": "...", "style_direction": "..."}
subheadline: maks 6 ord, norsk, kan være tom string
style_direction: én setning om visuell stil`;

  const user = [
    `Klipp-tittel: ${highlight.title ?? 'Ukjent'}`,
    `Kategori: ${highlight.category ?? 'Ukjent'}`,
    `Spill: ${vod?.category ?? vod?.title ?? 'Ukjent'}`,
    highlight.begrunnelse ? `Begrunnelse: ${highlight.begrunnelse}` : '',
    creatorContext ? `Community-kontekst: ${creatorContext}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 130,
      temperature: 0.85,
    });
    const text = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as ThumbnailCopy;
  } catch {}

  // Fallback basert på kategori
  const headline =
    highlight.category === 'FUNNY'      ? 'DETTE VAR SYKT' :
    highlight.category === 'CLUTCH'     ? 'UTROLIG REDNING' :
    highlight.category === 'FAIL'       ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'       ? 'HAN MISTET DET' :
    highlight.category === 'TACTICAL'   ? 'PERFEKT SPILT' :
    highlight.category === 'RP_MOMENT'  ? 'RP DRAMA' :
                                          'SJEKK DETTE';
  return { headline, subheadline: '', style_direction: 'Dramatisk og mørk med neon-grønt' };
}

// ── Creator-kontekst fra Supabase AI Memory ───────────────────────────────────

async function hentCreatorContext(db: any): Promise<string> {
  const ws = process.env.WORKSPACE_ID || 'glenvex-default';
  try {
    const [patternsRes, insightsRes] = await Promise.all([
      db.from('ai_agent_memory').select('summary')
        .eq('workspace_id', ws).in('memory_type', ['content_pattern', 'game_pattern'])
        .order('occurrence_count', { ascending: false }).limit(3),
      db.from('ai_agent_insights').select('title,summary')
        .eq('workspace_id', ws).order('created_at', { ascending: false }).limit(2),
    ]);
    const deler: string[] = [];
    if (patternsRes.data?.length) {
      deler.push('Mønstre: ' + (patternsRes.data as any[]).map((p: any) => p.summary).join('; '));
    }
    if (insightsRes.data?.length) {
      deler.push('Innsikter: ' + (insightsRes.data as any[]).map((i: any) => `${i.title}: ${i.summary}`).join('; '));
    }
    return deler.join(' | ');
  } catch { return ''; }
}

// ── DALL-E prompt-bygging ─────────────────────────────────────────────────────

function byggDallePrompt(
  platform: 'youtube' | 'tiktok',
  highlight: any,
  vod: any,
  frameDescription: string,
  copy: ThumbnailCopy
): string {
  const spill = vod?.category ?? vod?.title ?? 'gaming';
  const format = platform === 'youtube'
    ? 'landscape 16:9 YouTube gaming thumbnail (1920×1080)'
    : 'vertical 9:16 TikTok/YouTube Shorts gaming thumbnail (1080×1920)';
  const textPlacement = platform === 'youtube'
    ? 'large bold white text with dark stroke in the lower or upper third, not center'
    : 'large bold white text, centered horizontally, safe zone respected – keep 10% margin from all edges';

  return [
    `Ultra-high-quality ${format} for Norwegian Twitch streamer GLENVEX.`,
    `Game: ${spill}.`,
    frameDescription ? `Scene: ${frameDescription}` : '',
    `Main text overlay: "${copy.headline}" as ${textPlacement}.`,
    copy.subheadline ? `Subtext: "${copy.subheadline}" smaller, below main text.` : '',
    `Visual style: ${copy.style_direction}. Dark cinematic background, neon green (#00FF87) accent lighting, high contrast, intense dramatic mood, professional gaming thumbnail aesthetic.`,
    'Composition: eye-catching at small mobile thumbnail size, emotionally engaging, works in dark and light feed.',
    'No watermarks, no channel logos, no borders, no extra text beyond what is specified.',
  ].filter(Boolean).join('\n');
}

// ── Opplasting til Supabase Storage ──────────────────────────────────────────

async function lastOppBilde(db: any, localPath: string, storageSti: string): Promise<string | null> {
  try {
    const buf = fs.readFileSync(localPath);
    const { error } = await db.storage.from('glenvex-assets').upload(storageSti, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) throw error;
    const { data } = db.storage.from('glenvex-assets').getPublicUrl(storageSti);
    wLog('INFO', 'THUMBNAIL_UPLOAD_DONE', { storageSti });
    return (data as any)?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'THUMB_UPLOAD_FAIL', { storageSti, err: err.message?.slice(0, 200) });
    return null;
  }
}

// ── Hent PNG-buffer fra DALL-E URL ────────────────────────────────────────────

async function lastNedBilde(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.existsSync(dest) && fs.statSync(dest).size > 1_000;
  } catch { return false; }
}

// ── Hoved-generator ───────────────────────────────────────────────────────────

export async function genererThumbnail(highlightId: string): Promise<{ ok: boolean; melding: string }> {
  const db = getDb();
  if (!db) return { ok: false, melding: 'Ingen DB-tilkobling' };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, melding: 'OPENAI_API_KEY mangler' };

  const client = new OpenAI({ apiKey });

  const thumbDir = path.join(THUMB_BASE, highlightId);
  sikreDir(thumbDir);

  const videoSti = path.join(thumbDir, 'video_tmp.mp4');
  const ytSti    = path.join(thumbDir, 'youtube.png');
  const ttSti    = path.join(thumbDir, 'tiktok.png');

  try {
    wLog('INFO', 'THUMBNAIL_JOB_FOUND', { highlightId });

    // Sett GENERATING
    await db.from('content_highlights')
      .update({ thumbnail_status: 'GENERATING' })
      .eq('id', highlightId);

    // Hent highlight-data
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url')
      .eq('id', highlightId)
      .single();

    if (!h) throw new Error('Highlight ikke funnet');

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) {
      wLog('WARN', 'THUMBNAIL_SKIPPED_NO_VIDEO', { highlightId });
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error: 'THUMBNAIL_SKIPPED_NO_VIDEO – ingen clip_url',
      }).eq('id', highlightId);
      return { ok: false, melding: 'Ingen video-URL' };
    }

    const { data: vod } = await db.from('content_vods')
      .select('id,title,category')
      .eq('id', h.vod_id)
      .single();

    wLog('INFO', 'THUMBNAIL_GENERATING', { highlightId, title: h.title });

    // Last ned video
    const videoOk = await lastNedFil(videoUrl, videoSti);
    if (!videoOk) throw new Error('Kunne ikke laste ned video fra Storage');

    // Frame-ekstraksjon
    const frames = await hentFrames(videoSti, highlightId);

    // Velg beste frame (Vision hvis mulig, ellers posisjonsscore)
    let frameDescription = '';
    let bestFrame = velgBestFrameEnkel(frames);

    if (frames.length > 0 && bestFrame) {
      wLog('INFO', 'THUMBNAIL_AI_GENERATION_STARTED', { highlightId });
      const visionRes = await analyserMedVision(client, frames, highlightId);
      bestFrame = visionRes.bestFrame;
      frameDescription = visionRes.description;
    }

    // Creator-kontekst + thumbnail-tekst
    const [creatorContext, copy] = await Promise.all([
      hentCreatorContext(db),
      generateThumbnailCopy(client, h, vod, ''),
    ]);
    // Lag copy på nytt med kontekst dersom vi fikk noe nyttig
    const copyMedKontekst = creatorContext
      ? await generateThumbnailCopy(client, h, vod, creatorContext)
      : copy;

    const ytPrompt = byggDallePrompt('youtube', h, vod, frameDescription, copyMedKontekst);
    const ttPrompt = byggDallePrompt('tiktok', h, vod, frameDescription, copyMedKontekst);

    // DALL-E-3 – YouTube (1792×1024, nærmest 16:9)
    let ytUrl: string | null = null;
    let ttUrl: string | null = null;

    try {
      const ytRes = await client.images.generate({
        model: 'dall-e-3',
        prompt: ytPrompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        response_format: 'url',
      });
      const dalleUrl = ytRes.data?.[0]?.url;
      if (dalleUrl && await lastNedBilde(dalleUrl, ytSti)) {
        const storageSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}_youtube.png`;
        ytUrl = await lastOppBilde(db, ytSti, storageSti);
        if (ytUrl) wLog('INFO', 'THUMBNAIL_YOUTUBE_DONE', { highlightId });
      }
    } catch (err: any) {
      wLog('WARN', 'THUMBNAIL_YOUTUBE_FAIL', { highlightId, err: err.message?.slice(0, 150) });
    }

    // DALL-E-3 – TikTok (1024×1792, nærmest 9:16)
    try {
      const ttRes = await client.images.generate({
        model: 'dall-e-3',
        prompt: ttPrompt,
        n: 1,
        size: '1024x1792',
        quality: 'standard',
        response_format: 'url',
      });
      const dalleUrl = ttRes.data?.[0]?.url;
      if (dalleUrl && await lastNedBilde(dalleUrl, ttSti)) {
        const storageSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}_tiktok.png`;
        ttUrl = await lastOppBilde(db, ttSti, storageSti);
        if (ttUrl) wLog('INFO', 'THUMBNAIL_TIKTOK_DONE', { highlightId });
      }
    } catch (err: any) {
      wLog('WARN', 'THUMBNAIL_TIKTOK_FAIL', { highlightId, err: err.message?.slice(0, 150) });
    }

    if (!ytUrl && !ttUrl) throw new Error('Begge DALL-E-genereringer feilet');

    // Lagre til DB
    await db.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl,
      thumbnail_tiktok_url:   ttUrl,
      thumbnail_prompt:       ytPrompt,
      thumbnail_headline:     copyMedKontekst.headline,
      thumbnail_subheadline:  copyMedKontekst.subheadline || null,
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
    }).eq('id', highlightId);

    logBotEvent('thumbnail_ferdig', { id: highlightId, harYt: !!ytUrl, harTt: !!ttUrl });
    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_GENERATED',
      title: `Thumbnail generert for highlight ${highlightId}`,
      severity: 'info',
      metadata: {
        highlightId,
        vodId: h.vod_id,
        harYoutube: !!ytUrl,
        harTikTok: !!ttUrl,
        headline: copyMedKontekst.headline,
      },
    });
    wLog('INFO', 'THUMBNAIL_DONE', { highlightId });

    return { ok: true, melding: `Thumbnails generert for ${highlightId}` };

  } catch (err: any) {
    const msg = err.message?.slice(0, 300) ?? 'Ukjent feil';
    wLog('ERROR', 'THUMBNAIL_FAILED', { highlightId, err: msg });
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
    return { ok: false, melding: msg };
  } finally {
    ryddFiler(videoSti, ytSti, ttSti);
    ryddDir(path.join(THUMB_BASE, highlightId, 'frames'));
  }
}

// ── Worker-syklus (V2) ────────────────────────────────────────────────────────

async function kjørThumbnailSyklus(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') return;

  const db = getDb();
  if (!db) return;

  syklusTeller++;

  // ── Stale reset: GENERATING > 5 min ──────────────────────────────────────
  const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  let generatingStaleFound = 0;
  try {
    const { data: stale } = await db
      .from('content_highlights')
      .select('id')
      .eq('thumbnail_status', 'GENERATING')
      .lt('thumbnail_started_at', staleCutoff);

    generatingStaleFound = stale?.length ?? 0;
    for (const s of (stale ?? [])) {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  'Thumbnail job timed out/stale (>5 min ingen oppdatering)',
      }).eq('id', s.id);
      wLog('WARN', 'THUMBNAIL_STALE_RESET', { id: s.id });
      generererNå.delete(s.id);
    }
  } catch {}

  // ── Tell ventende jobber (for logging) ────────────────────────────────────
  let pendingFound = 0;
  let doneFound = 0;
  try {
    const [pRes, dRes] = await Promise.all([
      db.from('content_highlights').select('id', { count: 'exact', head: true })
        .eq('clip_status', 'CLIPPED').eq('thumbnail_status', 'PENDING').not('clip_url', 'is', null),
      db.from('content_highlights').select('id', { count: 'exact', head: true })
        .eq('clip_status', 'CLIPPED').eq('thumbnail_status', 'DONE'),
    ]);
    pendingFound = (pRes as any).count ?? 0;
    doneFound    = (dRes as any).count ?? 0;
  } catch {}

  wLog('INFO', 'THUMBNAIL_POLL_CYCLE', {
    syklus: syklusTeller,
    pending_found: pendingFound,
    generating_stale_found: generatingStaleFound,
    done_found: doneFound,
    aktive: generererNå.size,
    filter: 'clip_status=CLIPPED AND thumbnail_status=PENDING AND clip_url IS NOT NULL',
  });

  // ── Hent jobber å starte ──────────────────────────────────────────────────
  const ledig = MAX_CONCURRENT - generererNå.size;
  if (ledig <= 0) return;
  if (pendingFound === 0) return;

  const lock = Array.from(generererNå);
  const baseQuery = db
    .from('content_highlights')
    .select('id,clip_url')
    .eq('clip_status', 'CLIPPED')
    .eq('thumbnail_status', 'PENDING')
    .not('clip_url', 'is', null)
    .limit(ledig);

  const { data: highlights, error } = lock.length > 0
    ? await baseQuery.not('id', 'in', `(${lock.join(',')})`)
    : await baseQuery;

  if (error) { wLog('ERROR', 'THUMBNAIL_POLL_ERROR', { err: error.message, filter: baseQuery }); return; }
  if (!highlights || highlights.length === 0) return;

  wLog('INFO', 'THUMBNAIL_JOB_FOUND', { antall: highlights.length, ids: highlights.map((h: any) => h.id) });

  for (const h of highlights) {
    if (generererNå.has(h.id)) continue;
    generererNå.add(h.id);

    // Atomic claim – sikrer mot race med HTTP fast-path
    // thumbnail_started_at settes separat for å unngå avhengighet av thumbnail-v2b-migration.sql
    let claimed = false;
    const { data: claimedRows, error: claimErr } = await db
      .from('content_highlights')
      .update({
        thumbnail_status: 'GENERATING',
        thumbnail_error:  null,
      })
      .eq('id', h.id)
      .eq('thumbnail_status', 'PENDING')
      .select('id');
    claimed = !claimErr && (claimedRows?.length ?? 0) > 0;
    // V2b: sett stale-timer (ignorer feil om kolonne ikke eksisterer ennå)
    if (claimed) {
      await db.from('content_highlights').update({ thumbnail_started_at: new Date().toISOString() }).eq('id', h.id);
    }

    if (!claimed) {
      // HTTP fast-path slo til først – hopp over
      wLog('INFO', 'THUMBNAIL_JOB_SKIP_ALREADY_CLAIMED', { id: h.id });
      generererNå.delete(h.id);
      continue;
    }

    wLog('INFO', 'THUMBNAIL_JOB_CLAIMED', { id: h.id });

    const { buildThumbnailV2 } = require('./thumbnailBuilderV2');
    buildThumbnailV2(h.id)
      .catch((err: any) => {
        wLog('ERROR', 'THUMBNAIL_CRASH', { id: h.id, err: err.message?.slice(0, 200) });
        getDb()?.from('content_highlights').update({
          thumbnail_status: 'FAILED',
          thumbnail_error:  `Crash: ${err.message?.slice(0, 200)}`,
        }).eq('id', h.id).then(() => {});
      })
      .finally(() => { generererNå.delete(h.id); });
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

export async function startThumbnailWorker(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    console.log('[ThumbnailWorker] Deaktivert (CONTENT_FACTORY_ENABLED != true)');
    return;
  }

  wLog('INFO', 'WORKER_STARTED');

  const db = getDb();
  if (!db) return;

  // Reset GENERATING → PENDING ved Railway-restart (alle pågående bygg er avbrutt)
  try {
    const { data: stuck } = await db.from('content_highlights')
      .update({ thumbnail_status: 'PENDING', thumbnail_error: 'Resatt ved worker-restart' })
      .eq('thumbnail_status', 'GENERATING')
      .select('id');
    if (stuck?.length) wLog('INFO', 'THUMBNAIL_STARTUP_RESET', { antall: stuck.length });
    // V2b: reset stale-timer på alle PENDING (ignorer feil om kolonne ikke eksisterer ennå)
    await db.from('content_highlights').update({ thumbnail_started_at: null }).eq('thumbnail_status', 'PENDING');
  } catch {}

  const POLL_MS = 60_000; // 1 minutt
  wLog('INFO', 'THUMBNAIL_POLL_STARTED', {
    intervallMs: POLL_MS,
    versjon: 'V2 (Sharp + Vision – ingen DALL-E)',
    filter: 'clip_status=CLIPPED AND thumbnail_status=PENDING AND clip_url IS NOT NULL',
  });
  await kjørThumbnailSyklus();
  setInterval(kjørThumbnailSyklus, POLL_MS);
}

// ── Manuell force-trigger (fra dataApi.ts) ────────────────────────────────────

export async function forceThumbnail(highlightId: string): Promise<{ ok: boolean; melding: string }> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    return { ok: false, melding: 'CONTENT_FACTORY_ENABLED er ikke true' };
  }
  if (generererNå.has(highlightId)) {
    return { ok: false, melding: 'Genererer allerede dette highlightet' };
  }

  const db = getDb();
  if (!db) return { ok: false, melding: 'Supabase ikke tilkoblet' };

  const { data: h } = await db.from('content_highlights')
    .select('id,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId).single();

  if (!h) return { ok: false, melding: 'Highlight ikke funnet' };
  if (!h.clip_url && !h.vertical_clip_url) return { ok: false, melding: 'Ingen video-URL' };

  generererNå.add(highlightId);
  genererThumbnail(highlightId)
    .catch(() => {})
    .finally(() => { generererNå.delete(highlightId); });

  return { ok: true, melding: `Thumbnail-generering startet for ${highlightId}` };
}
