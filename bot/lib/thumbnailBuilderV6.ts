/**
 * Thumbnail Builder V6 — Gemini Director System
 *
 * Architecture:
 *  1. Extract 20 context frames (no brightness rejection)
 *  2. Gemini Director: single multimodal call → full ThumbnailStrategy
 *  3. Extract 3 precision frames near focusTimestamp
 *  4. Build variants A/B/C (different headline + crop)
 *  5. CTR Gate (GPT-4o, threshold 75/100) on each variant
 *  6. Upload winner + store all 3 variants
 *
 * Failure policy: only FAIL on ffmpeg error, render error, video-missing.
 * Dark/desaturated frames are accepted — Gemini decides what's interesting.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';
import { runGeminiDirector, ThumbnailStrategy } from './geminiDirector';

const execAsync = require('util').promisify(require('child_process').exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_BUCKET    = process.env.STORAGE_BUCKET ?? 'glenvex-assets';
const THUMB_BASE        = path.join(process.cwd(), 'data', 'thumbnails');
const FONT_DIR          = '/tmp/glenvex-fonts';
const FONT_ANTON_PATH   = path.join(FONT_DIR, 'Anton-Regular.ttf');
const FONT_ANTON_URL    = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf';

const YT_W = 1280;  const YT_H = 720;
const TT_W = 1080;  const TT_H = 1920;

const CONTEXT_FRAME_COUNT = 20;   // frames sent to Gemini (resized 320x180)
const PRECISION_OFFSET_S  = 4;    // seconds offset for variants B and C
const CTR_THRESHOLD_V6    = 75;   // raised from V5's 60
const MAX_REJECTS         = 3;

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  const suffix = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[ThumbnailV6][${level}] ${event}${suffix}`);
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

function sanitizeSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function lastNedFil(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch { return false; }
}

async function uploadBuffer(db: any, buf: Buffer, storagePath: string): Promise<string | null> {
  try {
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, buf, {
      contentType: 'image/png', upsert: true,
    });
    if (error) throw error;
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return (data as any)?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'UPLOAD_FAIL', { storagePath, err: err.message?.slice(0, 200) });
    return null;
  }
}

// ── Font ──────────────────────────────────────────────────────────────────────

async function prepareFont(): Promise<string | null> {
  try {
    if (fs.existsSync(FONT_ANTON_PATH)) return FONT_ANTON_PATH;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const res = await fetch(FONT_ANTON_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { wLog('WARN', 'FONT_DOWNLOAD_FAIL', { status: res.status }); return null; }
    fs.writeFileSync(FONT_ANTON_PATH, Buffer.from(await res.arrayBuffer()));
    wLog('INFO', 'FONT_DOWNLOADED', { path: FONT_ANTON_PATH });
    return FONT_ANTON_PATH;
  } catch (e: any) {
    wLog('WARN', 'FONT_PREP_FAIL', { err: e.message?.slice(0, 100) });
    return null;
  }
}

function fontDeclaration(fontPath: string | null): { decl: string; fontFamily: string } {
  if (fontPath && fs.existsSync(fontPath)) {
    // librsvg blocks url() in @font-face when SVG is loaded as Buffer (no document base URI).
    // Fix: write SVG to a temp file → Sharp loads by path → librsvg resolves file:// correctly.
    return {
      decl: `@font-face { font-family: 'Anton'; src: url('file://${fontPath}'); font-weight: normal; font-style: normal; }`,
      fontFamily: "'Anton', 'Impact', 'DejaVu Sans Bold', sans-serif",
    };
  }
  return {
    decl: '',
    fontFamily: "'DejaVu Sans Bold', 'Liberation Sans Bold', 'Impact', sans-serif",
  };
}

// ── Video duration ────────────────────────────────────────────────────────────

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { timeout: 15_000 }
    );
    return parseFloat((JSON.parse(stdout) as any)?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

// ── Frame extraction ──────────────────────────────────────────────────────────

interface ContextFrame { buf: Buffer; t: number; pct: number; }

async function extractContextFrames(videoPath: string, highlightId: string, durationSec: number): Promise<ContextFrame[]> {
  const frameDir = path.join(THUMB_BASE, highlightId, 'context_frames');
  sikreDir(frameDir);

  const percentages = Array.from(
    { length: CONTEXT_FRAME_COUNT },
    (_, i) => 5 + (i * 90 / (CONTEXT_FRAME_COUNT - 1))
  );
  const frames: ContextFrame[] = [];
  const BATCH = 4;

  for (let i = 0; i < percentages.length; i += BATCH) {
    const batch = percentages.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (pct) => {
      const t = Math.max(0.5, (durationSec * pct) / 100);
      const frameSti = path.join(frameDir, `ctx${Math.round(pct).toString().padStart(2, '0')}.jpg`);
      try {
        // Scale to 320x180 for Gemini — keeps request size manageable
        await execAsync(
          `ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 3 -vf "scale=320:180" "${frameSti}"`,
          { timeout: 15_000 }
        );
        if (!fs.existsSync(frameSti) || fs.statSync(frameSti).size < 1_000) return null;
        const buf = fs.readFileSync(frameSti);
        return { buf, t, pct };
      } catch { return null; }
    }));
    frames.push(...(results.filter(Boolean) as ContextFrame[]));
  }

  wLog('INFO', 'CONTEXT_FRAMES_EXTRACTED', { highlightId, count: frames.length });
  return frames;
}

async function extractPrecisionFrame(videoPath: string, t: number, outPath: string): Promise<Buffer | null> {
  try {
    const safeT = Math.max(0.5, t);
    await execAsync(
      `ffmpeg -y -ss ${safeT.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale=1280:720" "${outPath}"`,
      { timeout: 15_000 }
    );
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 4_000) return null;
    return fs.readFileSync(outPath);
  } catch { return null; }
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function accentColor(category: string): string {
  switch (category) {
    case 'RAGE':        return '#FF3333';
    case 'CLUTCH':      return '#00FF87';
    case 'FUNNY':       return '#FFD700';
    case 'RP_MOMENT':   return '#FF69B4';
    case 'EDUCATIONAL': return '#00BFFF';
    case 'FAIL':        return '#FF6600';
    case 'TACTICAL':    return '#9B59B6';
    default:            return '#FFFFFF';
  }
}

function splitLines(text: string, maxPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= 2 || text.length <= maxPerLine) return [text];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function calcFontSize(text: string, availW: number, maxFontH: number): number {
  const lines   = splitLines(text, Math.ceil(availW / (maxFontH * 0.52)));
  const longest = lines.reduce((a, b) => a.length > b.length ? a : b, '');
  const byWidth = Math.floor(availW / (Math.max(1, longest.length) * 0.52));
  return Math.min(maxFontH, Math.max(30, byWidth));
}

function buildArrowSvg(startX: number, startY: number, targetX: number, targetY: number): string {
  const dx  = targetX - startX;
  const dy  = targetY - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 60) return '';

  const angle   = Math.atan2(dy, dx) * 180 / Math.PI;
  const bodyLen = Math.max(40, len - 45).toFixed(0);
  const tipX    = (parseFloat(bodyLen) + 36).toFixed(0);

  return `<g transform="translate(${startX.toFixed(0)},${startY.toFixed(0)}) rotate(${angle.toFixed(1)})">
    <rect x="0" y="-7" width="${bodyLen}" height="14" rx="7"
      fill="#FF2D2D" stroke="black" stroke-width="4" paint-order="stroke fill"/>
    <polygon points="${bodyLen},-28 ${tipX},0 ${bodyLen},28"
      fill="#FF2D2D" stroke="black" stroke-width="4" paint-order="stroke fill"/>
  </g>`;
}

// ── Composite builder ─────────────────────────────────────────────────────────

type CropPosition = 'entropy' | 'attention' | 'centre';

async function buildCompositeV6(
  frameBuf: Buffer,
  W: number,
  H: number,
  headline: string,
  subheadline: string,
  category: string,
  fontPath: string | null,
  platform: 'youtube' | 'tiktok',
  arrowRequired: boolean,
  crop: CropPosition
): Promise<Buffer> {
  const sharp = require('sharp');
  const { decl, fontFamily } = fontDeclaration(fontPath);
  const primary  = accentColor(category);
  const isYT     = platform === 'youtube';

  const enhanced = await sharp(frameBuf)
    .resize(W, H, { fit: 'cover', position: crop })
    .sharpen({ sigma: 0.7, m1: 0.4, m2: 3.2 })
    .modulate({ brightness: 1.12, saturation: 1.40 })
    .linear(1.06, -8)
    .toBuffer();

  const safeHead  = sanitizeSvg(headline.toUpperCase());
  const safeBadge = sanitizeSvg(subheadline.toUpperCase());

  const textZoneLeft = Math.round(W * (isYT ? 0.04 : 0.06));
  const textZoneW    = Math.round(W * (isYT ? 0.56 : 0.88));

  const wordCount  = headline.trim().split(/\s+/).length;
  const lineCount  = wordCount <= 2 ? 1 : 2;
  const targetBlkH = Math.round(H * (isYT ? 0.24 : 0.16));
  const maxFontH   = Math.round(targetBlkH / (lineCount * 1.15));
  const hSize      = calcFontSize(safeHead, textZoneW, maxFontH);
  const hStroke    = Math.max(7, Math.round(hSize / 6));
  const lineSpacing = hSize * 1.14;

  const headLines  = splitLines(safeHead, Math.floor(textZoneW / (hSize * 0.52)));
  const totalTextH = headLines.length * lineSpacing;

  const badgeFontH   = Math.round(H * (isYT ? 0.058 : 0.04));
  const badgeH       = badgeFontH + 26;
  const badgeApproxW = Math.min(
    Math.round(W * 0.75),
    Math.round(safeBadge.length * badgeFontH * 0.54 + 46)
  );
  const badgeBadgeStroke = Math.max(2, Math.round(badgeFontH / 11));

  const badgeBottomY = H - Math.round(H * 0.045);
  const badgeTopY    = badgeBottomY - badgeH;
  const badgeX       = isYT ? textZoneLeft : Math.round((W - badgeApproxW) / 2);
  const badgeCenterX = badgeX + Math.round(badgeApproxW / 2);
  const badgeCenterY = badgeTopY + Math.round(badgeH / 2);

  const textBottomY  = badgeTopY - Math.round(H * 0.035);
  const headTopY     = textBottomY - totalTextH;
  const headAnchorX  = isYT ? textZoneLeft : Math.round(W / 2);
  const textAnchor   = isYT ? 'start' : 'middle';

  const headTspans = headLines.map((line, i) =>
    `<tspan x="${headAnchorX}" dy="${i === 0 ? 0 : lineSpacing.toFixed(0)}">${line}</tspan>`
  ).join('');

  // Arrow only if Gemini says it's required — point toward center-right of image
  let arrowSvgStr = '';
  if (arrowRequired) {
    const targetX = Math.round(W * 0.65);
    const targetY = Math.round(H * 0.40);
    const arrowStartX = Math.round(headAnchorX + textZoneW * (isYT ? 0.75 : 0.5));
    const arrowStartY = Math.round(headTopY + totalTextH * 0.5);
    arrowSvgStr = buildArrowSvg(arrowStartX, arrowStartY, targetX, targetY);
  }

  const gradStartY = Math.round(H * 0.42);
  const vigCX      = isYT ? '65%' : '50%';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>${decl}</style>
    <radialGradient id="vig" cx="${vigCX}" cy="50%" r="75%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="50%"  stop-color="black" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.70"/>
    </radialGradient>
    <linearGradient id="g-left" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"  stop-color="black" stop-opacity="0.80"/>
      <stop offset="58%" stop-color="black" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="g-bot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="48%"  stop-color="black" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.88"/>
    </linearGradient>
    <filter id="glow-h" x="-25%" y="-60%" width="150%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="blur"/>
      <feFlood flood-color="${primary}" flood-opacity="0.88" result="c"/>
      <feComposite in="c" in2="blur" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="drop">
      <feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="black" flood-opacity="0.92"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g-left)"/>
  <rect x="0" y="${gradStartY}" width="${W}" height="${H - gradStartY}" fill="url(#g-bot)"/>
  <text x="${headAnchorX}" y="${Math.round(headTopY + hSize * 0.88)}"
    text-anchor="${textAnchor}"
    font-family="${fontFamily}" font-size="${hSize}px" font-weight="900"
    fill="${primary}" stroke="black" stroke-width="${hStroke}" stroke-linejoin="round"
    paint-order="stroke fill" letter-spacing="2" filter="url(#glow-h)">${headTspans}</text>
  ${arrowSvgStr}
  <g transform="rotate(-2,${badgeCenterX},${badgeCenterY})">
    <rect x="${badgeX}" y="${badgeTopY}" width="${badgeApproxW}" height="${badgeH}" rx="8"
      fill="#CC0000" opacity="0.95" filter="url(#drop)"/>
    <rect x="${badgeX}" y="${badgeTopY}" width="${badgeApproxW}" height="3" rx="1"
      fill="white" opacity="0.30"/>
    <text x="${badgeCenterX}" y="${Math.round(badgeTopY + badgeH * 0.65)}"
      text-anchor="middle"
      font-family="${fontFamily}" font-size="${badgeFontH}px" font-weight="900"
      fill="white" stroke="black" stroke-width="${badgeBadgeStroke}" paint-order="stroke fill">
      ${safeBadge}
    </text>
  </g>
  <rect x="0" y="${H - 5}" width="${W}" height="5" fill="${primary}" opacity="0.88"/>
</svg>`;

  // librsvg cannot resolve file:// @font-face when SVG is passed as a Buffer (no document base URI).
  // Writing the SVG to a temp file gives librsvg a path-based base URI so font loading works.
  const os = require('os');
  const tmpSvgPath = path.join(os.tmpdir(), `glenvex-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}.svg`);
  fs.writeFileSync(tmpSvgPath, svg, 'utf8');
  try {
    return await sharp(enhanced)
      .composite([{ input: tmpSvgPath, top: 0, left: 0 }])
      .png({ compressionLevel: 7 })
      .toBuffer();
  } finally {
    try { fs.unlinkSync(tmpSvgPath); } catch {}
  }
}

// ── CTR Gate V6 (threshold 75) ────────────────────────────────────────────────

interface CtrResult {
  passed: boolean;
  score: number;
  reason: string;
  subjectVisible: boolean;
  textReadable: boolean;
}

async function runCtrGate(
  client: OpenAI,
  ytBuf: Buffer,
  headline: string,
  highlightId: string,
  variantLabel: string
): Promise<CtrResult> {
  const hardFail: CtrResult = {
    passed: false, score: 0,
    reason: 'CTR Gate teknisk feil — thumbnail avvist',
    subjectVisible: false, textReadable: false,
  };

  try {
    const sharp   = require('sharp');
    const preview = await sharp(ytBuf).resize(320, 180, { fit: 'fill' }).jpeg({ quality: 80 }).toBuffer();

    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [{
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'low' },
        }, {
          type: 'text',
          text: `YouTube gaming thumbnail vurdert ved mobil feed-størrelse (120×90px).
Variant ${variantLabel} — Headline: "${headline}"

Dimensjonsbasert scoring (total 100p):
- Subjekt synlig (25p): ser du tydelig hva/hvem det handler om?
- Tekst impact (25p): er STOR tekst lesbar, fet, emosjonell?
- Emosjonelt signal (25p): gjør dette bildet deg nysgjerrig/spent?
- Klikk-trigger (25p): ville du klikket dette over 20 andre gaming-thumbnails på mobil?

Terskel for godkjenning: score ≥ ${CTR_THRESHOLD_V6}

Svar KUN med JSON:
{"subject_visible":true/false,"text_readable":true/false,"score":0-100,"reason":"1-2 setninger"}`,
        }],
      }],
      max_tokens: 150,
      temperature: 0.1,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return hardFail;

    const d              = JSON.parse(match[0]);
    const subjectVisible = !!d.subject_visible;
    const textReadable   = !!d.text_readable;
    const score          = Math.min(100, Math.max(0, d.score ?? 0));
    const reason         = String(d.reason ?? '').slice(0, 200);
    const passed         = subjectVisible && textReadable && score >= CTR_THRESHOLD_V6;

    return { passed, score, reason, subjectVisible, textReadable };

  } catch (e: any) {
    wLog('WARN', 'CTR_GATE_V6_FAIL', { highlightId, variant: variantLabel, err: e.message?.slice(0, 100) });
    return hardFail;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildThumbnailV6(highlightId: string, source?: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  const client   = new OpenAI({ apiKey });
  const thumbDir = path.join(THUMB_BASE, highlightId);
  sikreDir(thumbDir);

  const videoPath = path.join(thumbDir, 'video_v6_tmp.mp4');
  const frameAPath = path.join(thumbDir, 'frame_a.jpg');
  const frameBPath = path.join(thumbDir, 'frame_b.jpg');
  const frameCPath = path.join(thumbDir, 'frame_c.jpg');

  try {
    wLog('INFO', 'THUMBNAIL_V6_STARTED', { highlightId });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_PIPELINE_START',
      title: `Thumbnail V6 pipeline startet for ${highlightId}`,
      severity: 'info',
      metadata: {
        thumbnailVersion: 'V6',
        highlightId,
        source: source ?? 'unknown',
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasOpenAiKey: !!process.env.OPENAI_API_KEY,
        fontPath: FONT_ANTON_PATH,
        fontExists: fs.existsSync(FONT_ANTON_PATH),
        ctrThreshold: CTR_THRESHOLD_V6,
      },
    });

    // ── 1. Load data ──────────────────────────────────────────────────────────
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url,thumbnail_reject_count,start_time,end_time')
      .eq('id', highlightId).single();
    if (!h) throw new Error('Highlight ikke funnet');

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url — kan ikke generere thumbnail');

    const [vodRes, transcriptRes] = await Promise.all([
      db.from('content_vods').select('id,title,category').eq('id', h.vod_id).single(),
      // Transcript segments overlapping this highlight's time window
      (h.start_time != null && h.end_time != null && h.vod_id)
        ? db.from('content_transcripts')
            .select('start_time,end_time,text')
            .eq('vod_id', h.vod_id)
            .gte('end_time', h.start_time)
            .lte('start_time', h.end_time)
            .order('start_time', { ascending: true })
            .limit(80)
        : Promise.resolve({ data: null }),
    ]);

    const vod = vodRes.data;

    // Build clip-relative transcript (Gemini sees same time axis as frames)
    const highlightStart = (h.start_time as number) ?? 0;
    const transcriptText = (transcriptRes.data as any[] | null)?.length
      ? (transcriptRes.data as any[])
          .map(s => `[${Math.max(0, s.start_time - highlightStart).toFixed(1)}s] ${s.text}`)
          .join(' ')
          .slice(0, 1200)
      : undefined;

    if (transcriptText) {
      wLog('INFO', 'TRANSCRIPT_LOADED', { highlightId, chars: transcriptText.length });
    }

    // ── 2. Font + video download ──────────────────────────────────────────────
    const [fontPath] = await Promise.all([prepareFont()]);
    const fontOk = !!fontPath && fs.existsSync(fontPath);
    wLog('INFO', fontOk ? 'FONT_READY' : 'FONT_FALLBACK', {
      font: fontOk ? 'Anton' : 'system',
      path: fontPath ?? 'null',
      exists: fontOk,
      sizeBytes: fontOk ? fs.statSync(fontPath!).size : 0,
      method: fontOk ? 'file-url-via-temp-svg' : 'system-fallback',
    });

    if (!await lastNedFil(videoUrl, videoPath)) {
      throw new Error('Videofil kunne ikke lastes ned');
    }

    // ── 3. Video duration ─────────────────────────────────────────────────────
    const durationSec = await getVideoDuration(videoPath);
    wLog('INFO', 'VIDEO_DURATION', { highlightId, durationSec });

    // ── 4. Context frames for Gemini (20 frames, 320x180, no darkness filter) ─
    const contextFrames = await extractContextFrames(videoPath, highlightId, durationSec);
    if (contextFrames.length === 0) {
      throw new Error('Kunne ikke ekstrahere frames fra video (ffmpeg feilet)');
    }

    // ── 5. Gemini Director ────────────────────────────────────────────────────
    const { strategy, context: geminiContext } = await runGeminiDirector(
      contextFrames,
      { title: h.title, category: h.category, begrunnelse: h.begrunnelse, transcript: transcriptText },
      vod,
      highlightId,
      durationSec
    );

    wLog('INFO', 'STRATEGY_READY', {
      highlightId,
      headline: strategy.headline,
      emotion: strategy.emotion,
      focusTimestamp: strategy.focusTimestamp,
      arrowRequired: strategy.arrowRequired,
      ctrScore: strategy.ctrScore,
      headlineCount: strategy.headlines.length,
    });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_GEMINI_ANALYSIS_COMPLETE',
      title: `Gemini analyse ferdig — "${strategy.headline}" · ${strategy.emotion} · CTR ${strategy.ctrScore}/100`,
      severity: 'info',
      metadata: {
        thumbnailVersion: 'V6-Gemini-Director',
        highlightId,
        hook: strategy.hook,
        headline: strategy.headline,
        emotion: strategy.emotion,
        ctrScore: strategy.ctrScore,
        focusTimestamp: strategy.focusTimestamp,
        arrowRequired: strategy.arrowRequired,
        thumbnailType: strategy.thumbnailType,
        subheadline: strategy.subheadline,
        headlineOptions: strategy.headlines.slice(0, 5),
        isFallback: strategy.explanation?.includes('Fallback') ?? false,
      },
    });

    // Save strategy early (best-effort) so it's visible even if build fails later
    try {
      await db.from('content_highlights').update({
        thumbnail_director_strategy: strategy as any,
        thumbnail_gemini_context:    geminiContext as any,
      }).eq('id', highlightId);
    } catch {}

    // ── 6. Precision frames for 3 variants ────────────────────────────────────
    const tA = strategy.focusTimestamp;
    const tB = Math.max(0.5, tA - PRECISION_OFFSET_S);
    const tC = Math.min(durationSec - 0.5, tA + PRECISION_OFFSET_S);

    const [bufA, bufB, bufC] = await Promise.all([
      extractPrecisionFrame(videoPath, tA, frameAPath),
      extractPrecisionFrame(videoPath, tB, frameBPath),
      extractPrecisionFrame(videoPath, tC, frameCPath),
    ]);

    // All variants fall back to focusTimestamp frame if offset frames fail
    const frameAOrNull = bufA ?? bufB ?? bufC;
    if (!frameAOrNull) throw new Error('Ingen precision frames kunne ekstraheres (ffmpeg feilet)');

    // TypeScript-safe non-null frames: all fall back to frameAOrNull (guaranteed Buffer)
    const frameA: Buffer = frameAOrNull;
    const frameB: Buffer = (bufB ?? bufA ?? bufC) ?? frameAOrNull;
    const frameC: Buffer = (bufC ?? bufA ?? bufB) ?? frameAOrNull;

    const hl = strategy.headlines;
    const headlineA = strategy.headline;
    const headlineB = hl[1] ?? hl[0] ?? strategy.headline;
    const headlineC = hl[2] ?? hl[0] ?? strategy.headline;

    // ── 7. Build YT composites for A/B/C ─────────────────────────────────────
    const fontFileExists = !!fontPath && fs.existsSync(fontPath);
    const fontSizeBytes  = fontFileExists ? fs.statSync(fontPath!).size : 0;
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_RENDER_START',
      title: `Thumbnail render starter — variant A: "${headlineA}" · font: ${fontFileExists ? 'Anton (temp-svg)' : 'system fallback'}`,
      severity: 'info',
      metadata: {
        thumbnailVersion: 'V6',
        highlightId,
        templateUsed: 'V6-Sharp-SVG-temp-file',
        selectedFrameTimestamp: tA,
        frameBTimestamp: tB,
        frameCTimestamp: tC,
        headlines: [headlineA, headlineB, headlineC],
        subheadline: strategy.subheadline,
        category: h.category,
        fontPath: fontPath ?? 'null',
        fontFileExists,
        fontSizeBytes,
        fontMethod: fontFileExists ? 'file-url-via-temp-svg' : 'system-fallback',
      },
    });

    const [ytA, ytB, ytC] = await Promise.all([
      buildCompositeV6(frameA, YT_W, YT_H, headlineA, strategy.subheadline, h.category, fontPath, 'youtube', strategy.arrowRequired, 'entropy'),
      buildCompositeV6(frameB, YT_W, YT_H, headlineB, strategy.subheadline, h.category, fontPath, 'youtube', strategy.arrowRequired, 'attention'),
      buildCompositeV6(frameC, YT_W, YT_H, headlineC, strategy.subheadline, h.category, fontPath, 'youtube', false, 'centre'),
    ]);

    wLog('INFO', 'VARIANTS_BUILT', { highlightId, headlines: [headlineA, headlineB, headlineC] });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_RENDER_COMPLETE',
      title: `Thumbnail render ferdig — 3 varianter bygget — A: "${headlineA}"`,
      severity: 'info',
      metadata: {
        thumbnailVersion: 'V6',
        highlightId,
        templateUsed: 'V6-Sharp-SVG-temp-file',
        variantA: { headline: headlineA, crop: 'entropy', frameSec: tA },
        variantB: { headline: headlineB, crop: 'attention', frameSec: tB },
        variantC: { headline: headlineC, crop: 'centre', frameSec: tC },
        fontUsed: fontFileExists ? 'Anton' : 'system',
        ytABytes: ytA.length,
        ytBBytes: ytB.length,
        ytCBytes: ytC.length,
      },
    });

    // ── 8. CTR Gate on each variant ───────────────────────────────────────────
    const [gateA, gateB, gateC] = await Promise.all([
      runCtrGate(client, ytA, headlineA, highlightId, 'A'),
      runCtrGate(client, ytB, headlineB, highlightId, 'B'),
      runCtrGate(client, ytC, headlineC, highlightId, 'C'),
    ]);

    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V6_CTR_SCORES',
      title: `CTR Gate V6: A=${gateA.score} B=${gateB.score} C=${gateC.score} (terskel ${CTR_THRESHOLD_V6})`,
      severity: 'info',
      metadata: {
        highlightId,
        variantA: { score: gateA.score, passed: gateA.passed, headline: headlineA },
        variantB: { score: gateB.score, passed: gateB.passed, headline: headlineB },
        variantC: { score: gateC.score, passed: gateC.passed, headline: headlineC },
      },
    });

    // Pick best passing variant
    const variants = [
      { label: 'A', gate: gateA, ytBuf: ytA, frame: frameA, headline: headlineA, crop: 'entropy' as CropPosition },
      { label: 'B', gate: gateB, ytBuf: ytB, frame: frameB, headline: headlineB, crop: 'attention' as CropPosition },
      { label: 'C', gate: gateC, ytBuf: ytC, frame: frameC, headline: headlineC, crop: 'centre' as CropPosition },
    ];
    const passing = variants.filter(v => v.gate.passed).sort((a, b) => b.gate.score - a.gate.score);
    const winner  = passing[0] ?? null;

    if (!winner) {
      const bestScore = Math.max(gateA.score, gateB.score, gateC.score);
      const newCount  = (h.thumbnail_reject_count ?? 0) + 1;
      const maxReached = newCount >= MAX_REJECTS;

      wLog('WARN', maxReached ? 'THUMBNAIL_V6_MAX_REJECTS' : 'THUMBNAIL_V6_REJECTED', {
        highlightId, bestScore, newCount,
      });
      logSystemEvent({
        source: 'thumbnail_worker',
        event_type: maxReached ? 'THUMBNAIL_NEEDS_MANUAL_REVIEW' : 'THUMBNAIL_REJECTED_LOW_CTR',
        title: maxReached
          ? `Thumbnail V6: maks ${MAX_REJECTS} CTR-avvisninger — manuell opplasting påkrevd`
          : `Thumbnail V6 avvist — beste score: ${bestScore}/${CTR_THRESHOLD_V6} (alle 3 varianter under terskel)`,
        severity: 'warning',
        metadata: { highlightId, bestScore, newCount, threshold: CTR_THRESHOLD_V6 },
      });

      await db.from('content_highlights').update({
        thumbnail_status:       maxReached ? 'NEEDS_MANUAL_REVIEW' : 'PENDING',
        thumbnail_reject_count: newCount,
        thumbnail_error:        maxReached
          ? `V6: Maks ${MAX_REJECTS} CTR-avvisninger. Beste score: ${bestScore}/${CTR_THRESHOLD_V6}`
          : `V6 CTR_REJECTED #${newCount}: beste score=${bestScore} — ${gateA.reason}`,
      }).eq('id', highlightId);
      return;
    }

    wLog('INFO', 'THUMBNAIL_V6_WINNER', { highlightId, variant: winner.label, score: winner.gate.score, headline: winner.headline });

    // ── 9. Build TikTok for winner ────────────────────────────────────────────
    const ttWinner = await buildCompositeV6(
      winner.frame, TT_W, TT_H, winner.headline, strategy.subheadline,
      h.category, fontPath, 'tiktok', strategy.arrowRequired, winner.crop
    );

    // ── 10. Upload all variants ───────────────────────────────────────────────
    const vodId = h.vod_id ?? 'unknown';
    const base  = `content-factory/thumbnails/${vodId}/${highlightId}`;

    const [ytAUrl, ytBUrl, ytCUrl, ttWinnerUrl] = await Promise.all([
      uploadBuffer(db, ytA, `${base}_v6_yt_a.png`),
      uploadBuffer(db, ytB, `${base}_v6_yt_b.png`),
      uploadBuffer(db, ytC, `${base}_v6_yt_c.png`),
      uploadBuffer(db, ttWinner, `${base}_v6_tt_winner.png`),
    ]);

    // Winner is whichever variant won
    const winnerYtUrl = winner.label === 'A' ? ytAUrl : winner.label === 'B' ? ytBUrl : ytCUrl;
    if (!winnerYtUrl) throw new Error('Opplasting av vinnende thumbnail feilet');

    // ── 11. Update DB ─────────────────────────────────────────────────────────
    await db.from('content_highlights').update({
      thumbnail_status:          'DONE',
      thumbnail_youtube_url:     winnerYtUrl,
      thumbnail_tiktok_url:      ttWinnerUrl,
      thumbnail_variant_b_url:   ytBUrl,
      thumbnail_variant_c_url:   ytCUrl,
      thumbnail_headline:        winner.headline,
      thumbnail_subheadline:     strategy.subheadline || null,
      thumbnail_generated_at:    new Date().toISOString(),
      thumbnail_error:           null,
      thumbnail_ctr_score:       winner.gate.score,
      thumbnail_concept:         strategy.emotion,
      thumbnail_hook:            { hook: strategy.hook, emotion: strategy.emotion, headline: winner.headline, badge_text: strategy.subheadline },
      thumbnail_director_strategy: strategy as any,
      thumbnail_gemini_context:    geminiContext as any,
      thumbnail_reject_count:    h.thumbnail_reject_count ?? 0,
    }).eq('id', highlightId);

    wLog('INFO', 'THUMBNAIL_V6_DONE', {
      highlightId,
      winner: winner.label,
      score: winner.gate.score,
      headline: winner.headline,
      ytUrl: winnerYtUrl,
    });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V6_DONE',
      title: `Thumbnail V6 ferdig — variant ${winner.label} vant — CTR ${winner.gate.score}/100 — "${winner.headline}"`,
      severity: 'info',
      metadata: {
        highlightId,
        winnerVariant: winner.label,
        ctrScore: winner.gate.score,
        headline: winner.headline,
        subheadline: strategy.subheadline,
        harYoutube: !!winnerYtUrl,
        harTikTok: !!ttWinnerUrl,
        allVariantScores: { A: gateA.score, B: gateB.score, C: gateC.score },
      },
    });

  } catch (err: any) {
    const msg = err.message?.slice(0, 300) ?? 'Ukjent feil';
    wLog('ERROR', 'THUMBNAIL_V6_FAILED', { highlightId, err: msg });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V6_FAILED',
      title: `Thumbnail V6 feilet: ${msg}`, severity: 'error',
      metadata: { highlightId, error: msg },
    });
    try {
      await getDb()?.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  msg,
      }).eq('id', highlightId);
    } catch {}
    throw err;

  } finally {
    ryddFiler(videoPath, frameAPath, frameBPath, frameCPath);
    ryddDir(path.join(THUMB_BASE, highlightId, 'context_frames'));
  }
}
