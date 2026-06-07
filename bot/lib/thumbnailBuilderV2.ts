/**
 * Thumbnail Builder V2
 *
 * Bruker EKTE frames fra klippet som fundament.
 * AI brukes KUN til: frame-selection (Vision) og tekstgenerering.
 * Sharp gjør all bildeprosessering – ingen DALL-E, ingen AI-kunst.
 *
 * Flyt:
 *  1. Hent clip_url fra DB
 *  2. Ekstraher 12 frames spredt jevnt gjennom klippet
 *  3. Score frames (lysstyrke-heuristikk, fjern åpenbart dårlige)
 *  4. Send topp 5 til GPT-4o-mini Vision → velg beste frame
 *  5. Generer headline + subheadline (GPT ser valgt frame)
 *  6. Sharp: resize, sharpen, saturation boost + SVG overlay (gradient + tekst)
 *  7. Last opp til Supabase Storage
 *  8. Oppdater DB med DONE, quality_score, source_frame
 *
 * clip_status røres ALDRI.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const execAsync = promisify(exec);

// ── Config ────────────────────────────────────────────────────────────────────

const FRAME_COUNT    = 12;   // frames å ekstrahere
const TOP_CANDIDATES = 5;    // frames til Vision
const MAX_RETRIES    = 2;    // forsøk hvis score < 70
const QUALITY_THRESHOLD = 70;

const YT_W = 1280;
const YT_H = 720;
const TT_W = 1080;
const TT_H = 1920;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(step: string, detail = '') {
  console.log(`[ThumbnailV2] ${step}${detail ? ': ' + detail : ''}`);
}

// ── Frame Extraction ──────────────────────────────────────────────────────────

function spawnFrame(
  videoUrl: string,
  t: number,
  w: number,
  h: number,
  timeoutMs = 14_000
): Promise<Buffer | null> {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', [
      '-ss', String(Math.max(0.1, t)),
      '-i', videoUrl,
      '-vframes', '1',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout?.on('data', (c: Buffer) => chunks.push(c));
    const tid = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(null); }, timeoutMs);
    proc.on('close', (code: number) => {
      clearTimeout(tid);
      resolve(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null);
    });
    proc.on('error', () => { clearTimeout(tid); resolve(null); });
  });
}

async function getClipDuration(clipUrl: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${clipUrl}"`,
      { timeout: 10_000 }
    );
    const d = parseFloat(stdout.trim());
    return d > 0 && isFinite(d) ? d : 30;
  } catch { return 30; }
}

interface RawFrame {
  idx: number;
  t: number;
  pct: number;
  buf: Buffer;
}

async function extractCandidateFrames(clipUrl: string, duration: number): Promise<RawFrame[]> {
  // Spread jevnt fra 5% til 95%
  const percentages = Array.from({ length: FRAME_COUNT }, (_, i) =>
    5 + (i * 90 / (FRAME_COUNT - 1))
  );
  const timestamps = percentages.map(p => Math.max(0.5, (duration * p) / 100));

  // Ekstraher i parallellbatcher på 4
  const frames: RawFrame[] = [];
  const BATCH = 4;
  for (let i = 0; i < timestamps.length; i += BATCH) {
    const batch = timestamps.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (t, j) => {
        const buf = await spawnFrame(clipUrl, t, 640, 360, 12_000);
        return buf ? { idx: i + j, t, pct: percentages[i + j], buf } : null;
      })
    );
    frames.push(...(results.filter(Boolean) as RawFrame[]));
  }
  return frames;
}

// ── Frame Scoring (heuristikk) ────────────────────────────────────────────────

function scoreBrightness(buf: Buffer): number {
  // Sjekk gjennomsnittlig lysstyrke fra JPEG-bytes (simpel proxy)
  // Bruk byte-verdi-gjennomsnitt for piksler i sentrum av bufferen
  const start = Math.floor(buf.length * 0.3);
  const end   = Math.floor(buf.length * 0.7);
  let sum = 0;
  let n = 0;
  for (let i = start; i < end; i += 50) { sum += buf[i]; n++; }
  const avg = n > 0 ? sum / n : 128;
  if (avg < 40)  return 0;   // for mørk
  if (avg > 220) return 20;  // for lys (overeksponert)
  if (avg < 70)  return 40;  // ganske mørk
  return 100;
}

function scorePosition(pct: number): number {
  // Intro og outro er dårlige valg
  if (pct < 5 || pct > 95) return 10;
  if (pct < 12 || pct > 88) return 50;
  return 100;
}

function scoreFrame(frame: RawFrame): number {
  return Math.round((scoreBrightness(frame.buf) * 0.5) + (scorePosition(frame.pct) * 0.5));
}

// ── Vision Selection ──────────────────────────────────────────────────────────

async function selectBestFrame(
  client: OpenAI,
  frames: RawFrame[],
  category: string,
  game: string
): Promise<number> {
  if (frames.length <= 1) return 0;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `These ${frames.length} frames are from a ${game || 'video game'} gaming clip (type: ${category || 'general'}). Which would make the BEST YouTube thumbnail? Look for: visible player reaction/face, high-energy action moment, interesting composition, good lighting, minimal HUD. Reply with ONLY the number 1 through ${frames.length}.`,
          },
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:image/jpeg;base64,${f.buf.toString('base64')}`,
              detail: 'low' as const,
            },
          })),
        ],
      }],
    }, { signal: ctrl.signal } as any);
    clearTimeout(tid);
    const n = parseInt(res.choices[0]?.message?.content?.trim() ?? '');
    if (!isNaN(n) && n >= 1 && n <= frames.length) {
      log('FRAME_SELECTED', `Vision valgte frame ${n} av ${frames.length} (t=${frames[n-1].t.toFixed(1)}s)`);
      return n - 1;
    }
  } catch {
    clearTimeout(tid);
  }
  const fallback = Math.floor(frames.length / 2);
  log('FRAME_SELECTED', `Vision timeout – bruker midterste frame (t=${frames[fallback].t.toFixed(1)}s)`);
  return fallback;
}

// ── Copy Generation ───────────────────────────────────────────────────────────

async function generateCopy(
  client: OpenAI,
  highlight: any,
  vod: any,
  copies: any[],
  frameB64: string
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
          content: `Du lager thumbnail-tekst for en gaming YouTube-kanal. Svar KUN med JSON: {"headline":"...","subheadline":"..."}
headline: 2-4 ORD, STORE BOKSTAVER, norsk, klikkbar og energisk. Eksempler: "DETTE GIKK GALT", "HAN BLE GAL", "BOSSEN FALT", "RP BLE KAOS", "CHAT MISTET DET"
subheadline: maks 6 ord norsk (valgfri – tom string hvis ikke naturlig)`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${frameB64}`, detail: 'low' as const },
            },
            {
              type: 'text',
              text: [
                `Klipp: ${highlight.title ?? ''}`,
                `Kategori: ${highlight.category ?? ''}`,
                `Spill: ${vod?.category ?? vod?.title ?? ''}`,
                highlight.begrunnelse ? `Hva skjedde: ${highlight.begrunnelse}` : '',
                ytCopy?.tittel ? `Tittel: ${ytCopy.tittel}` : '',
                ttCopy?.caption ? `Caption: ${ttCopy.caption}` : '',
              ].filter(Boolean).join('\n'),
            },
          ],
        },
      ],
    });
    const m = (res.choices[0]?.message?.content ?? '').match(/\{[\s\S]*?\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}

  const headline =
    highlight.category === 'FUNNY'       ? 'DETTE VAR SYKT' :
    highlight.category === 'CLUTCH'      ? 'UTROLIG REDNING' :
    highlight.category === 'FAIL'        ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'        ? 'HAN MISTET DET' :
    highlight.category === 'RP_MOMENT'   ? 'RP BLE KAOS' :
    highlight.category === 'EDUCATIONAL' ? 'LÆR DETTE NESTE' :
    'SJEKK DETTE';
  return { headline, subheadline: '' };
}

// ── Thumbnail Compositing (Sharp + SVG) ───────────────────────────────────────

function accentColor(category: string): string {
  switch (category) {
    case 'RAGE':        return '#FF4444';
    case 'CLUTCH':      return '#00FF87';
    case 'FUNNY':       return '#FFD700';
    case 'RP_MOMENT':   return '#FF69B4';
    case 'EDUCATIONAL': return '#00BFFF';
    default:            return '#FFFFFF';
  }
}

function sanitizeSvgText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function compositeThumbnail(
  frameBuf: Buffer,
  headline: string,
  subheadline: string,
  category: string,
  channelName: string,
  W: number,
  H: number
): Promise<Buffer> {
  const sharp = require('sharp');

  // Enhanse frame: resize til nøyaktig format, skarp, litt mer vibrant
  const enhanced = await sharp(frameBuf)
    .resize(W, H, { fit: 'cover', position: 'entropy' })
    .sharpen({ sigma: 1.5 })
    .modulate({ brightness: 1.06, saturation: 1.3 })
    .toBuffer();

  // Tekststørrelser skalert etter bredde og tittel-lengde
  const headlineWords = headline.trim().split(/\s+/).length;
  const hSize = Math.round(W / (headlineWords >= 4 ? 13 : 10));
  const sSize = Math.round(W / 30);
  const chSize = Math.round(W / 50);
  const accent = accentColor(category);

  const safeH  = sanitizeSvgText(headline.toUpperCase());
  const safeSub = sanitizeSvgText(subheadline || '');
  const safeCh  = sanitizeSvgText(channelName || '');

  // Gradient start: topp halvdel er ren frame, bunn halvdel mørkes ned
  const gradY  = Math.round(H * 0.52);
  const hY     = subheadline ? H - 88 : H - 55;
  const subY   = H - 34;
  const strokeW = Math.max(3, Math.round(hSize / 12));
  const subStrokeW = Math.max(2, Math.round(sSize / 14));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.92"/>
    </linearGradient>
  </defs>

  <!-- Gradient overlay -->
  <rect x="0" y="${gradY}" width="${W}" height="${H - gradY}" fill="url(#bg)"/>

  <!-- Headline -->
  <text x="${W / 2}" y="${hY}"
    text-anchor="middle" dominant-baseline="text-bottom"
    font-family="Impact, 'Arial Black', 'Liberation Sans', 'DejaVu Sans', sans-serif"
    font-weight="900" font-size="${hSize}px"
    fill="${accent}"
    stroke="black" stroke-width="${strokeW}" stroke-linejoin="round"
    paint-order="stroke fill"
    letter-spacing="1">${safeH}</text>

  ${safeSub ? `<!-- Subheadline -->
  <text x="${W / 2}" y="${subY}"
    text-anchor="middle" dominant-baseline="text-bottom"
    font-family="'Liberation Sans', 'DejaVu Sans', Arial, sans-serif"
    font-weight="bold" font-size="${sSize}px"
    fill="white"
    stroke="black" stroke-width="${subStrokeW}" stroke-linejoin="round"
    paint-order="stroke fill">${safeSub}</text>` : ''}

  ${safeCh ? `<!-- Kanalnavn (øverst til høyre) -->
  <text x="${W - 14}" y="36"
    text-anchor="end"
    font-family="'Liberation Sans', 'DejaVu Sans', Arial, sans-serif"
    font-weight="bold" font-size="${chSize}px"
    fill="#9146FF"
    stroke="black" stroke-width="2" paint-order="stroke fill"
    opacity="0.9">${safeCh}</text>` : ''}
</svg>`;

  return sharp(enhanced)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

// ── Quality Score ─────────────────────────────────────────────────────────────

function computeQualityScore(opts: {
  extractedFrames: number;
  visionUsed: boolean;
  headline: string;
  hasYoutube: boolean;
  hasTiktok: boolean;
  bestFramePct: number;
}): number {
  let score = 0;

  // Frame-dekning (0–25)
  score += Math.min(25, Math.round((opts.extractedFrames / FRAME_COUNT) * 25));

  // Vision ble brukt (0–20)
  score += opts.visionUsed ? 20 : 8;

  // Headline-kvalitet (0–25): 2–4 ord er ideelt
  const words = opts.headline.trim().split(/\s+/).length;
  score += words >= 2 && words <= 4 ? 25 : words === 5 ? 15 : 5;

  // Begge formater generert (0–20)
  score += opts.hasYoutube && opts.hasTiktok ? 20 : opts.hasYoutube || opts.hasTiktok ? 10 : 0;

  // Klipp-posisjon (0–10)
  const pct = opts.bestFramePct;
  score += pct >= 15 && pct <= 85 ? 10 : 5;

  return Math.min(100, Math.round(score));
}

// ── Storage Upload ────────────────────────────────────────────────────────────

async function uploadPng(sb: any, buf: Buffer, sti: string): Promise<string | null> {
  try {
    const { error } = await sb.storage.from('glenvex-assets').upload(sti, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) { log('UPLOAD_ERROR', JSON.stringify(error)); return null; }
    const { data } = sb.storage.from('glenvex-assets').getPublicUrl(sti);
    return (data as any)?.publicUrl ?? null;
  } catch (e: any) {
    log('UPLOAD_EXCEPTION', e.message?.slice(0, 200));
    return null;
  }
}

// ── Hent kanalnavn ────────────────────────────────────────────────────────────

async function hentKanalNavn(sb: any, vodId: string): Promise<string> {
  try {
    const { data } = await sb.from('content_vods')
      .select('twitch_channel_name,title')
      .eq('id', vodId)
      .single();
    return data?.twitch_channel_name ?? '';
  } catch { return ''; }
}

// ── Bygg ett thumbnail med retry ──────────────────────────────────────────────

async function buildOneSize(
  candidatesOrdered: RawFrame[],
  frameSource: string,
  frameT: number,
  copy: { headline: string; subheadline: string },
  category: string,
  channelName: string,
  W: number,
  H: number,
  label: string
): Promise<Buffer | null> {
  log(`COMPOSITING_${label}`, `${W}x${H} fra t=${frameT.toFixed(1)}s`);
  const hiBuf = await spawnFrame(frameSource, frameT, W, H, 16_000);
  if (!hiBuf) { log(`FRAME_FETCH_FAILED_${label}`); return null; }
  try {
    return await compositeThumbnail(hiBuf, copy.headline, copy.subheadline, category, channelName, W, H);
  } catch (e: any) {
    log(`COMPOSITE_FAILED_${label}`, e.message?.slice(0, 200));
    return null;
  }
}

// ── Hoved-builder ─────────────────────────────────────────────────────────────

export async function buildThumbnailV2(highlightId: string): Promise<void> {
  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!sbUrl || !sbKey || !apiKey) {
    log('ERROR', 'Mangler SUPABASE_URL / SERVICE_ROLE_KEY / OPENAI_API_KEY');
    return;
  }

  const sb     = createClient(sbUrl, sbKey, { realtime: { transport: ws } });
  const client = new OpenAI({ apiKey });

  // Sett GENERATING
  try {
    await sb.from('content_highlights').update({
      thumbnail_status: 'GENERATING',
      thumbnail_error:  null,
    }).eq('id', highlightId);
  } catch {}

  try {
    // ── Hent data ─────────────────────────────────────────────────────────────
    const { data: h, error: hErr } = await sb.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url,clip_status')
      .eq('id', highlightId)
      .single();

    if (hErr || !h) throw new Error('Highlight ikke funnet');
    if (h.clip_status !== 'CLIPPED') throw new Error(`clip_status = ${h.clip_status}`);
    if (!h.clip_url)                 throw new Error('Ingen clip_url');

    const [vodRes, copiesRes] = await Promise.all([
      sb.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      sb.from('content_copy').select('platform,tittel,caption').eq('highlight_id', highlightId),
    ]);
    const vod     = vodRes.data;
    const copies  = copiesRes.data ?? [];
    const game    = vod?.category ?? vod?.title ?? 'video game';
    const channel = await hentKanalNavn(sb, h.vod_id);

    // ── Frame extraction ──────────────────────────────────────────────────────
    log('FRAME_EXTRACTION_STARTED', highlightId);
    const duration = await getClipDuration(h.clip_url);
    const rawFrames = await extractCandidateFrames(h.clip_url, duration);
    log('FRAMES_EXTRACTED', `${rawFrames.length}/${FRAME_COUNT} OK`);

    if (rawFrames.length === 0) throw new Error('Ingen frames kunne ekstraheres');

    // ── Scoring + utvalg ──────────────────────────────────────────────────────
    const scored = rawFrames
      .map(f => ({ ...f, score: scoreFrame(f) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_CANDIDATES);

    // ── Vision selection ──────────────────────────────────────────────────────
    let visionUsed = false;
    let bestIdx = 0;
    if (scored.length > 1) {
      bestIdx = await selectBestFrame(client, scored, h.category, game);
      visionUsed = true;
    }

    // Bygg liste med kandidater: best first, resten som fallbacks
    const orderedCandidates = [
      scored[bestIdx],
      ...scored.filter((_, i) => i !== bestIdx),
    ];

    // ── Copy generation ───────────────────────────────────────────────────────
    const copy = await generateCopy(client, h, vod, copies, orderedCandidates[0].buf.toString('base64'));
    log('COPY_GENERATED', `"${copy.headline}" / "${copy.subheadline}"`);

    // ── Build thumbnails med retry ────────────────────────────────────────────
    log('IMAGE_BUILD_STARTED');

    let bestYtBuf: Buffer | null = null;
    let bestTtBuf: Buffer | null = null;
    let usedFrameT = orderedCandidates[0].t;
    let bestScore = 0;

    const attemptsToTry = Math.min(orderedCandidates.length, MAX_RETRIES + 1);

    for (let attempt = 0; attempt < attemptsToTry; attempt++) {
      const candidate = orderedCandidates[attempt];

      const ttSource = h.vertical_clip_url ?? h.clip_url;

      const [ytBuf, ttBuf] = await Promise.all([
        buildOneSize(orderedCandidates, h.clip_url,  candidate.t, copy, h.category, channel, YT_W, YT_H, 'YT'),
        buildOneSize(orderedCandidates, ttSource,     candidate.t, copy, h.category, channel, TT_W, TT_H, 'TT'),
      ]);

      const score = computeQualityScore({
        extractedFrames: rawFrames.length,
        visionUsed,
        headline: copy.headline,
        hasYoutube: !!ytBuf,
        hasTiktok:  !!ttBuf,
        bestFramePct: candidate.pct,
      });

      log(`ATTEMPT_${attempt + 1}_SCORE`, `${score} (frame t=${candidate.t.toFixed(1)}s)`);

      if (score > bestScore || (!bestYtBuf && !bestTtBuf)) {
        bestYtBuf  = ytBuf;
        bestTtBuf  = ttBuf;
        bestScore  = score;
        usedFrameT = candidate.t;
      }

      if (score >= QUALITY_THRESHOLD) break;
      log(`RETRY_REASON`, `score=${score} < ${QUALITY_THRESHOLD}, prøver neste candidate`);
    }

    log('IMAGE_BUILD_DONE', `bestScore=${bestScore} yt=${!!bestYtBuf} tt=${!!bestTtBuf}`);

    if (!bestYtBuf && !bestTtBuf) throw new Error('Compositing feilet for alle forsøk');

    // ── Upload ────────────────────────────────────────────────────────────────
    const baseSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}`;
    const [ytUrl, ttUrl] = await Promise.all([
      bestYtBuf ? uploadPng(sb, bestYtBuf, `${baseSti}_youtube.png`) : Promise.resolve(null),
      bestTtBuf ? uploadPng(sb, bestTtBuf, `${baseSti}_tiktok.png`)  : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) throw new Error('Opplasting til Supabase Storage feilet');

    // ── Oppdater DB ───────────────────────────────────────────────────────────
    await sb.from('content_highlights').update({
      thumbnail_status:        'DONE',
      thumbnail_youtube_url:   ytUrl  ?? null,
      thumbnail_tiktok_url:    ttUrl  ?? null,
      thumbnail_headline:      copy.headline,
      thumbnail_subheadline:   copy.subheadline || null,
      thumbnail_source_frame:  usedFrameT,
      thumbnail_quality_score: bestScore,
      thumbnail_generated_at:  new Date().toISOString(),
      thumbnail_error:         null,
      thumbnail_prompt:        null, // V2 bruker ikke prompt
    }).eq('id', highlightId);

    log('THUMBNAIL_V2_DONE', `score=${bestScore} frame=${usedFrameT.toFixed(1)}s yt=${!!ytUrl} tt=${!!ttUrl}`);

  } catch (err: any) {
    const msg = (err.message ?? 'Ukjent feil').slice(0, 300);
    log('FAILED', msg);
    try {
      await sb.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
  }
}
