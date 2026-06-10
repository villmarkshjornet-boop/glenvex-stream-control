/**
 * Thumbnail Builder V2 – AAA Gaming Thumbnail
 *
 * Real frames from the clip + Sharp compositing. No DALL-E, no AI art.
 *
 * Flow:
 *  1. Download gaming font (Bebas Neue) on first use → /tmp/glenvex-fonts/
 *  2. Extract 12 frames spread through the clip
 *  3. Score frames (brightness heuristic)
 *  4. Top 5 → GPT-4o Vision → pick best frame
 *  5. Generate headline + subheadline (GPT sees chosen frame)
 *  6. Sharp: aggressive enhancement (clahe, high saturation, sharpen)
 *     + professional SVG overlay (glow, accent bar, category badge)
 *  7. Upload to Supabase Storage
 *  8. Update DB: DONE, quality_score, source_frame
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

const execAsync = promisify(exec);
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';

// ── Config ────────────────────────────────────────────────────────────────────

const FRAME_COUNT    = 12;
const TOP_CANDIDATES = 5;
const MAX_RETRIES    = 2;
const QUALITY_THRESHOLD = 70;

const YT_W = 1280;
const YT_H = 720;
const TT_W = 1080;
const TT_H = 1920;

// ── Font ──────────────────────────────────────────────────────────────────────

const FONT_DIR  = '/tmp/glenvex-fonts';
const FONT_PATH = path.join(FONT_DIR, 'BebasNeue.ttf');
// Bebas Neue Regular – OFL licence – downloaded once and cached
const FONT_URL  = 'https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf';

let _fontBase64: string | null = null;

async function getFontBase64(): Promise<string | null> {
  if (_fontBase64) return _fontBase64;
  try {
    if (!fs.existsSync(FONT_PATH)) {
      fs.mkdirSync(FONT_DIR, { recursive: true });
      const res = await fetch(FONT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      fs.writeFileSync(FONT_PATH, Buffer.from(await res.arrayBuffer()));
      log('FONT_DOWNLOADED', FONT_PATH);
    }
    _fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
    return _fontBase64;
  } catch (e: any) {
    log('FONT_DOWNLOAD_FAILED', e.message?.slice(0, 100));
    return null;
  }
}

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
      '-q:v', '2',  // higher quality JPEG (scale: 2=~95%)
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
  const percentages = Array.from({ length: FRAME_COUNT }, (_, i) =>
    5 + (i * 90 / (FRAME_COUNT - 1))
  );
  const timestamps = percentages.map(p => Math.max(0.5, (duration * p) / 100));

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

// ── Frame Scoring ─────────────────────────────────────────────────────────────

function scoreBrightness(buf: Buffer): number {
  const start = Math.floor(buf.length * 0.3);
  const end   = Math.floor(buf.length * 0.7);
  let sum = 0; let n = 0;
  for (let i = start; i < end; i += 50) { sum += buf[i]; n++; }
  const avg = n > 0 ? sum / n : 128;
  if (avg < 35)  return 0;
  if (avg > 225) return 20;
  if (avg < 65)  return 35;
  return 100;
}

function scorePosition(pct: number): number {
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
            text: `These ${frames.length} frames are from a ${game || 'video game'} gaming clip (type: ${category || 'general'}). Which frame would make the BEST YouTube gaming thumbnail? Prioritize: high-energy action moments, visible player/character reactions, interesting composition, good lighting. Reply ONLY with the number 1–${frames.length}.`,
          },
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/jpeg;base64,${f.buf.toString('base64')}`, detail: 'low' as const },
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
  } catch { clearTimeout(tid); }
  const fallback = Math.floor(frames.length / 2);
  log('FRAME_SELECTED', `Vision timeout – midterste frame (t=${frames[fallback].t.toFixed(1)}s)`);
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
          content: `Du lager tekst til AAA gaming YouTube-thumbnails. Svar KUN med JSON: {"headline":"...","subheadline":"..."}

headline: 2-4 ORD, STORE BOKSTAVER, norsk, sjokkerende/clickbait-energisk. Eksempler: "DETTE GIKK GALT", "HAN MISTET DET", "BOSSEN FALT ENDELIG", "CHAT MISTET DET", "100% KLARTE DET", "DET VAR IKKE PLANEN", "ALDRI GJØR DETTE"
subheadline: 3-6 ord norsk, bygger på headlinen. Tomt string ("") hvis ikke naturlig.
Unngå generiske fraser. Tenk clickbait-energi.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frameB64}`, detail: 'low' as const } },
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
    highlight.category === 'CLUTCH'      ? 'KLARTE DET AKKURAT' :
    highlight.category === 'FAIL'        ? 'DETTE GIKK GALT' :
    highlight.category === 'RAGE'        ? 'HAN MISTET DET' :
    highlight.category === 'RP_MOMENT'   ? 'RP BLE KAOS' :
    highlight.category === 'EDUCATIONAL' ? 'LÆR DETTE NESTE' :
    'SJEKK DETTE';
  return { headline, subheadline: '' };
}

// ── Design helpers ────────────────────────────────────────────────────────────

interface AccentTheme {
  primary: string;   // hex
  secondary: string; // hex (darker/complementary)
  glow: string;      // hex for the glow colour
}

function accentTheme(category: string): AccentTheme {
  switch (category) {
    case 'RAGE':        return { primary: '#FF3333', secondary: '#CC0000', glow: '#FF0000' };
    case 'CLUTCH':      return { primary: '#00FF87', secondary: '#00CC6A', glow: '#00FF87' };
    case 'FUNNY':       return { primary: '#FFD700', secondary: '#CC9900', glow: '#FFD700' };
    case 'RP_MOMENT':   return { primary: '#FF69B4', secondary: '#CC3380', glow: '#FF69B4' };
    case 'EDUCATIONAL': return { primary: '#00BFFF', secondary: '#0088CC', glow: '#00BFFF' };
    case 'FAIL':        return { primary: '#FF6600', secondary: '#CC4400', glow: '#FF6600' };
    case 'TACTICAL':    return { primary: '#9B59B6', secondary: '#7D3C98', glow: '#9B59B6' };
    default:            return { primary: '#FFFFFF', secondary: '#CCCCCC', glow: '#FFFFFF' };
  }
}

function sanitizeSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap long headline text into two lines if needed
function splitHeadline(text: string, maxCharsPerLine = 16): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= 2 || text.length <= maxCharsPerLine) return [text];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// ── Compositing ───────────────────────────────────────────────────────────────

async function compositeThumbnail(
  frameBuf: Buffer,
  headline: string,
  subheadline: string,
  category: string,
  channelName: string,
  W: number,
  H: number,
  fontBase64: string | null
): Promise<Buffer> {
  const sharp = require('sharp');
  const isVertical = H > W;

  // ── Image enhancement ──────────────────────────────────────────────────────
  let img = sharp(frameBuf).resize(W, H, { fit: 'cover', position: 'entropy' });

  // Try CLAHE for adaptive contrast enhancement (cinema-grade look)
  try {
    img = img.clahe({ width: 3, height: 3, maxSlope: 3 });
  } catch { /* CLAHE not available on this Sharp version */ }

  const enhanced = await img
    .sharpen({ sigma: 2.2, m1: 1.2, m2: 0.5 })
    .modulate({ brightness: 1.05, saturation: 1.65 })
    .linear(1.08, -10)  // mild contrast lift
    .toBuffer();

  // ── Design constants ────────────────────────────────────────────────────────
  const { primary, glow: glowColor } = accentTheme(category);
  const safeHead = sanitizeSvg(headline.toUpperCase());
  const safeSub  = sanitizeSvg(subheadline || '');
  const safeCh   = sanitizeSvg((channelName || 'GLENVEX').toUpperCase());
  const safeCat  = sanitizeSvg(category || '');

  // Typography – Bebas Neue is a condensed all-caps font, so we can go bigger
  const headLines = splitHeadline(safeHead, isVertical ? 12 : 18);
  const wordCount = headline.trim().split(/\s+/).length;
  const baseDivisor = isVertical
    ? (wordCount >= 4 ? 8.5 : 6.5)
    : (wordCount >= 4 ? 11.5 : 9);
  const hSize = Math.round(W / baseDivisor);
  const sSize = Math.round(W / (isVertical ? 22 : 28));
  const chSize = Math.round(W / (isVertical ? 32 : 42));
  const badgeSize = Math.round(W / (isVertical ? 28 : 36));

  // Stroke widths
  const hStroke = Math.max(5, Math.round(hSize / 7));
  const sStroke = Math.max(2, Math.round(sSize / 10));

  // Vertical positioning (bottom-up)
  const accentBarH = Math.max(8, Math.round(H * 0.013));
  const leftBarW   = Math.max(10, Math.round(W * 0.012));
  const lineH      = headLines.length * (hSize * 1.1);
  const textBottom = H - accentBarH - (isVertical ? 60 : 44);
  const subY       = textBottom;
  const headBottomY = subheadline
    ? textBottom - sSize * 1.6 - 8
    : textBottom;
  const headTopY   = headBottomY - lineH;
  const gradStart  = Math.max(0, Math.round(headTopY - hSize * 1.2));

  // Font family declaration – embed Bebas Neue if available, else fall back
  const fontDecl = fontBase64
    ? `@font-face { font-family: 'BebasNeue'; src: url('data:font/truetype;base64,${fontBase64}'); }`
    : '';
  const headFont  = fontBase64 ? 'BebasNeue' : "Impact, 'Arial Black', sans-serif";
  const bodyFont  = "'Liberation Sans', 'DejaVu Sans', Arial, sans-serif";

  // Build headline tspan lines
  const lineSpacing = hSize * 1.12;
  const headTspans = headLines.map((line, i) =>
    `<tspan x="${leftBarW + W * 0.06}" dy="${i === 0 ? 0 : lineSpacing}">${line}</tspan>`
  ).join('');

  // Category badge dimensions
  const badgePad = 12;
  const badgeW = safeCat ? Math.max(60, safeCat.length * badgeSize * 0.62 + badgePad * 2) : 0;
  const badgeH = safeCat ? badgeSize + 14 : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>${fontDecl}</style>

    <!-- Atmospheric bottom gradient -->
    <linearGradient id="grad-bot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="30%"  stop-color="black" stop-opacity="0.08"/>
      <stop offset="65%"  stop-color="black" stop-opacity="0.58"/>
      <stop offset="85%"  stop-color="black" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.97"/>
    </linearGradient>

    <!-- Edge vignette (top) -->
    <linearGradient id="grad-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="black" stop-opacity="0.45"/>
      <stop offset="18%" stop-color="black" stop-opacity="0"/>
    </linearGradient>

    <!-- Left vignette -->
    <linearGradient id="grad-left" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.6"/>
      <stop offset="20%"  stop-color="black" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>

    <!-- Glow filter for headline -->
    <filter id="glow-h" x="-15%" y="-30%" width="130%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10" result="blur"/>
      <feFlood flood-color="${glowColor}" flood-opacity="0.85" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Drop shadow for supporting text -->
    <filter id="drop">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.9"/>
    </filter>
  </defs>

  <!-- Atmospheric bottom gradient -->
  <rect x="0" y="${gradStart}" width="${W}" height="${H - gradStart}" fill="url(#grad-bot)"/>

  <!-- Top vignette -->
  <rect x="0" y="0" width="${W}" height="${Math.round(H * 0.22)}" fill="url(#grad-top)"/>

  <!-- Left vignette (where accent bar is) -->
  <rect x="0" y="0" width="${Math.round(W * 0.22)}" height="${H}" fill="url(#grad-left)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="${leftBarW}" height="${H}" fill="${primary}"/>

  <!-- Bottom accent bar -->
  <rect x="0" y="${H - accentBarH}" width="${W}" height="${accentBarH}" fill="${primary}" opacity="0.95"/>

  <!-- Category badge (top left, after accent bar) -->
  ${safeCat ? `
  <rect x="${leftBarW + 16}" y="18" width="${badgeW}" height="${badgeH}" rx="5"
    fill="${primary}" opacity="0.92"/>
  <text x="${leftBarW + 16 + badgePad}" y="${18 + badgeH * 0.72}"
    font-family="${headFont}, sans-serif"
    font-weight="900" font-size="${badgeSize}px"
    fill="black" letter-spacing="1">${safeCat}</text>` : ''}

  <!-- Channel name (top right) -->
  <text x="${W - leftBarW - 18}" y="${badgeH + 26}"
    text-anchor="end"
    font-family="${headFont}, sans-serif"
    font-weight="900" font-size="${chSize}px"
    fill="${primary}"
    stroke="black" stroke-width="2" paint-order="stroke fill"
    filter="url(#drop)">${safeCh}</text>

  <!-- Headline (left-aligned, large, with glow) -->
  <text
    x="${leftBarW + W * 0.06}" y="${headTopY + hSize}"
    dominant-baseline="text-before-edge"
    font-family="${headFont}, sans-serif"
    font-weight="900" font-size="${hSize}px"
    fill="${primary}"
    stroke="black" stroke-width="${hStroke}" stroke-linejoin="round"
    paint-order="stroke fill"
    filter="url(#glow-h)"
    letter-spacing="2">${headTspans}</text>

  <!-- Subheadline -->
  ${safeSub ? `<text
    x="${leftBarW + W * 0.06}" y="${subY}"
    dominant-baseline="text-before-edge"
    font-family="${bodyFont}"
    font-weight="bold" font-size="${sSize}px"
    fill="white"
    stroke="black" stroke-width="${sStroke}" stroke-linejoin="round"
    paint-order="stroke fill"
    filter="url(#drop)">${safeSub}</text>` : ''}
</svg>`;

  return sharp(enhanced)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 7 })
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
  fontAvailable: boolean;
}): number {
  let score = 0;
  score += Math.min(25, Math.round((opts.extractedFrames / FRAME_COUNT) * 25));
  score += opts.visionUsed ? 20 : 8;
  const words = opts.headline.trim().split(/\s+/).length;
  score += words >= 2 && words <= 4 ? 25 : words === 5 ? 15 : 5;
  score += opts.hasYoutube && opts.hasTiktok ? 20 : opts.hasYoutube || opts.hasTiktok ? 10 : 0;
  const pct = opts.bestFramePct;
  score += pct >= 15 && pct <= 85 ? 10 : 5;
  return Math.min(100, Math.round(score));
}

// ── Storage Upload ────────────────────────────────────────────────────────────

async function uploadPng(sb: any, buf: Buffer, sti: string): Promise<string | null> {
  try {
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(sti, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) { log('UPLOAD_ERROR', JSON.stringify(error)); return null; }
    const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(sti);
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

// ── Bygg ett thumbnail-størrelse ──────────────────────────────────────────────

async function buildOneSize(
  videoUrl: string,
  frameT: number,
  copy: { headline: string; subheadline: string },
  category: string,
  channelName: string,
  W: number,
  H: number,
  fontBase64: string | null,
  label: string
): Promise<Buffer | null> {
  log(`COMPOSITING_${label}`, `${W}x${H} fra t=${frameT.toFixed(1)}s`);
  const hiBuf = await spawnFrame(videoUrl, frameT, W, H, 16_000);
  if (!hiBuf) { log(`FRAME_FETCH_FAILED_${label}`); return null; }
  try {
    return await compositeThumbnail(hiBuf, copy.headline, copy.subheadline, category, channelName, W, H, fontBase64);
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

  const sb     = createClient(sbUrl, sbKey, { realtime: { transport: require('ws') } });
  const client = new OpenAI({ apiKey });

  // Claim the job
  await sb.from('content_highlights').update({
    thumbnail_status: 'GENERATING',
    thumbnail_error:  null,
  }).eq('id', highlightId).in('thumbnail_status', ['PENDING', 'GENERATING']);
  await sb.from('content_highlights').update({ thumbnail_started_at: new Date().toISOString() }).eq('id', highlightId);

  log('JOB_CLAIMED', highlightId);
  logSystemEvent({ source: 'thumbnail', event_type: 'THUMBNAIL_JOB_CLAIMED', title: `Thumbnail claim: ${highlightId.slice(0, 8)}`, severity: 'info', metadata: { highlight_id: highlightId } });

  try {
    // ── Fetch data ─────────────────────────────────────────────────────────
    const { data: h, error: hErr } = await sb.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url,clip_status')
      .eq('id', highlightId)
      .single();

    if (hErr || !h) throw new Error('Highlight ikke funnet');
    if (h.clip_status !== 'CLIPPED') throw new Error(`clip_status = ${h.clip_status}`);

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url eller vertical_clip_url');

    const [vodRes, copiesRes] = await Promise.all([
      sb.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      sb.from('content_copy').select('platform,tittel,caption').eq('highlight_id', highlightId),
    ]);
    const vod    = vodRes.data;
    const copies = copiesRes.data ?? [];
    const game   = vod?.category ?? vod?.title ?? 'video game';
    const channel = await hentKanalNavn(sb, h.vod_id);

    // Download font (non-blocking – falls back to system fonts if unavailable)
    const fontBase64 = await getFontBase64();
    if (fontBase64) log('FONT_READY', 'Bebas Neue lastet');
    else log('FONT_FALLBACK', 'Bruker system-font');

    // ── Frame extraction ────────────────────────────────────────────────────
    log('FRAME_EXTRACTION_STARTED');
    logSystemEvent({ source: 'thumbnail', event_type: 'FRAME_EXTRACTION_STARTED', title: `Ekstraher frames: "${(h.title ?? '').slice(0, 60)}"`, severity: 'info', metadata: { highlight_id: highlightId } });

    const duration  = await getClipDuration(videoUrl);
    const rawFrames = await extractCandidateFrames(videoUrl, duration);
    log('FRAMES_EXTRACTED', `${rawFrames.length}/${FRAME_COUNT} OK`);
    logSystemEvent({ source: 'thumbnail', event_type: 'FRAME_EXTRACTION_DONE', title: `${rawFrames.length}/${FRAME_COUNT} frames OK`, severity: 'info', metadata: { highlight_id: highlightId, frames: rawFrames.length } });

    if (rawFrames.length === 0) throw new Error('Ingen frames kunne ekstraheres');

    // ── Score + rank ────────────────────────────────────────────────────────
    const scored = rawFrames
      .map(f => ({ ...f, score: scoreFrame(f) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_CANDIDATES);

    // ── Vision selection ────────────────────────────────────────────────────
    let visionUsed = false;
    let bestIdx = 0;
    logSystemEvent({ source: 'thumbnail', event_type: 'FRAME_SELECTION_STARTED', title: `GPT Vision velger beste frame (${scored.length} kandidater)`, severity: 'info', metadata: { highlight_id: highlightId, candidates: scored.length } });
    if (scored.length > 1) {
      bestIdx = await selectBestFrame(client, scored, h.category, game);
      visionUsed = true;
    }
    logSystemEvent({ source: 'thumbnail', event_type: 'FRAME_SELECTED', title: `Frame valgt: t=${scored[bestIdx]?.t?.toFixed(1) ?? '?'}s`, severity: 'info', metadata: { highlight_id: highlightId, vision_used: visionUsed, frame_t: scored[bestIdx]?.t } });

    const orderedCandidates = [
      scored[bestIdx],
      ...scored.filter((_, i) => i !== bestIdx),
    ];

    // ── Copy generation ─────────────────────────────────────────────────────
    const copy = await generateCopy(client, h, vod, copies, orderedCandidates[0].buf.toString('base64'));
    log('COPY_GENERATED', `"${copy.headline}" / "${copy.subheadline}"`);

    // ── Build thumbnails ────────────────────────────────────────────────────
    log('IMAGE_BUILD_STARTED');
    logSystemEvent({ source: 'thumbnail', event_type: 'THUMBNAIL_RENDER_STARTED', title: `Kompositter: "${copy.headline}"`, severity: 'info', metadata: { highlight_id: highlightId, headline: copy.headline, font: fontBase64 ? 'BebasNeue' : 'system' } });

    let bestYtBuf: Buffer | null = null;
    let bestTtBuf: Buffer | null = null;
    let usedFrameT = orderedCandidates[0].t;
    let bestScore = 0;

    const attemptsToTry = Math.min(orderedCandidates.length, MAX_RETRIES + 1);

    for (let attempt = 0; attempt < attemptsToTry; attempt++) {
      const candidate = orderedCandidates[attempt];
      const ttSource  = h.vertical_clip_url ?? h.clip_url;

      const [ytBuf, ttBuf] = await Promise.all([
        buildOneSize(h.clip_url, candidate.t, copy, h.category, channel, YT_W, YT_H, fontBase64, 'YT'),
        buildOneSize(ttSource,   candidate.t, copy, h.category, channel, TT_W, TT_H, fontBase64, 'TT'),
      ]);

      const score = computeQualityScore({
        extractedFrames: rawFrames.length,
        visionUsed,
        headline: copy.headline,
        hasYoutube: !!ytBuf,
        hasTiktok:  !!ttBuf,
        bestFramePct: candidate.pct,
        fontAvailable: !!fontBase64,
      });

      log(`ATTEMPT_${attempt + 1}_SCORE`, `${score} (frame t=${candidate.t.toFixed(1)}s)`);

      if (score > bestScore || (!bestYtBuf && !bestTtBuf)) {
        bestYtBuf  = ytBuf;
        bestTtBuf  = ttBuf;
        bestScore  = score;
        usedFrameT = candidate.t;
      }
      if (score >= QUALITY_THRESHOLD) break;
    }

    log('IMAGE_BUILD_DONE', `bestScore=${bestScore} yt=${!!bestYtBuf} tt=${!!bestTtBuf}`);
    logSystemEvent({ source: 'thumbnail', event_type: 'THUMBNAIL_RENDER_DONE', title: `Render ferdig – score: ${bestScore}/100`, severity: 'info', metadata: { highlight_id: highlightId, score: bestScore, has_youtube: !!bestYtBuf, has_tiktok: !!bestTtBuf } });

    if (!bestYtBuf && !bestTtBuf) throw new Error('Compositing feilet for alle forsøk');

    // ── Upload ──────────────────────────────────────────────────────────────
    logSystemEvent({ source: 'thumbnail', event_type: 'SUPABASE_UPLOAD_STARTED', title: 'Laster opp thumbnail', severity: 'info', metadata: { highlight_id: highlightId } });
    const baseSti = `content-factory/thumbnails/${h.vod_id}/${highlightId}`;
    const [ytUrl, ttUrl] = await Promise.all([
      bestYtBuf ? uploadPng(sb, bestYtBuf, `${baseSti}_youtube.png`) : Promise.resolve(null),
      bestTtBuf ? uploadPng(sb, bestTtBuf, `${baseSti}_tiktok.png`)  : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) throw new Error('Opplasting til Supabase Storage feilet');
    logSystemEvent({ source: 'thumbnail', event_type: 'SUPABASE_UPLOAD_DONE', title: 'Thumbnail lastet opp', severity: 'info', metadata: { highlight_id: highlightId, yt_url: ytUrl, tt_url: ttUrl } });

    // ── Update DB ───────────────────────────────────────────────────────────
    const { error: doneErr } = await sb.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl  ?? null,
      thumbnail_tiktok_url:   ttUrl  ?? null,
      thumbnail_headline:     copy.headline,
      thumbnail_subheadline:  copy.subheadline || null,
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
      thumbnail_prompt:       null,
    }).eq('id', highlightId);
    if (doneErr) throw new Error('DB DONE-oppdatering feilet: ' + doneErr.message);

    await sb.from('content_highlights').update({
      thumbnail_source_frame:  usedFrameT,
      thumbnail_quality_score: bestScore,
    }).eq('id', highlightId);

    log('THUMBNAIL_V2_DONE', `score=${bestScore} frame=${usedFrameT.toFixed(1)}s font=${fontBase64 ? 'BebasNeue' : 'system'}`);
    logSystemEvent({ source: 'thumbnail', event_type: 'THUMBNAIL_DONE', title: `Thumbnail FERDIG – score ${bestScore}/100`, description: `"${(h.title ?? '').slice(0, 80)}"`, severity: 'info', metadata: { highlight_id: highlightId, score: bestScore, frame_t: usedFrameT, yt_url: ytUrl, tt_url: ttUrl } });

  } catch (err: any) {
    const msg = (err.message ?? 'Ukjent feil').slice(0, 300);
    log('FAILED', msg);
    logSystemEvent({ source: 'thumbnail', event_type: 'THUMBNAIL_FAILED', title: 'Thumbnail FEILET', description: msg, severity: 'error', metadata: { highlight_id: highlightId, error: msg } });
    try {
      await sb.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
  }
}
