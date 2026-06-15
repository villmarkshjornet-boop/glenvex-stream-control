/**
 * Thumbnail Builder V5.5 – Sharp/SVG 7-layer CTR pipeline
 *
 * Layer 1: Original frame (ffmpeg extract)
 * Layer 2: Brightness + saturation enhancement (Sharp)
 * Layer 3: Vignette + left-side darkening (SVG radialGradient)
 * Layer 4: Massive headline text 20-25% of height (Anton font, Norwegian-safe)
 * Layer 5: Red arrow pointing at detected subject (SVG, if box available)
 * Layer 6: Badge with secondary hook text (SVG rect + text)
 * CTR Gate: GPT-4o Vision strict gate — score < 60 → THUMBNAIL_REJECTED_LOW_CTR
 *
 * NO gpt-image-1. NO AI image generation. Text rendered only via Sharp/SVG.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';

const execAsync = require('util').promisify(require('child_process').exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_BUCKET   = process.env.STORAGE_BUCKET ?? 'glenvex-assets';
const THUMB_BASE       = path.join(process.cwd(), 'data', 'thumbnails');
const FONT_DIR         = '/tmp/glenvex-fonts';
const FONT_ANTON_PATH  = path.join(FONT_DIR, 'Anton-Regular.ttf');
const FONT_ANTON_URL   = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf';

const YT_W = 1280;  const YT_H = 720;
const TT_W = 1080;  const TT_H = 1920;

const FRAME_COUNT    = 20;
const BRIGHTNESS_MIN = 40;   // Hard reject frames below this (0-255 scale)
const SAT_STD_MIN    = 5;    // Hard reject near-grayscale frames
const CTR_THRESHOLD  = 60;
const MAX_REJECTS    = 3;

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  const suffix = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[ThumbnailV55][${level}] ${event}${suffix}`);
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

// ── Font ─────────────────────────────────────────────────────────────────────

async function prepareFont(): Promise<string | null> {
  try {
    if (!fs.existsSync(FONT_ANTON_PATH)) {
      fs.mkdirSync(FONT_DIR, { recursive: true });
      const res = await fetch(FONT_ANTON_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { wLog('WARN', 'FONT_DOWNLOAD_FAIL', { status: res.status }); return null; }
      fs.writeFileSync(FONT_ANTON_PATH, Buffer.from(await res.arrayBuffer()));
      wLog('INFO', 'FONT_DOWNLOADED', { path: FONT_ANTON_PATH });
    }
    return FONT_ANTON_PATH;
  } catch (e: any) {
    wLog('WARN', 'FONT_PREP_FAIL', { err: e.message?.slice(0, 100) });
    return null;
  }
}

function fontDeclaration(fontPath: string | null): { decl: string; fontFamily: string } {
  if (fontPath && fs.existsSync(fontPath)) {
    return {
      decl: `@font-face { font-family: 'Anton'; src: url('file://${fontPath}'); font-weight: normal; font-style: normal; }`,
      fontFamily: "'Anton', 'Impact', 'DejaVu Sans Bold', sans-serif",
    };
  }
  // DejaVu Sans Bold: always on Debian/Ubuntu, supports full Unicode including æøå
  return {
    decl: '',
    fontFamily: "'Impact', 'DejaVu Sans Bold', 'Liberation Sans Bold', sans-serif",
  };
}

// ── Frame extraction ──────────────────────────────────────────────────────────

interface Frame { buf: Buffer; pct: number; t: number; brightness: number; }

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { timeout: 15_000 }
    );
    return parseFloat((JSON.parse(stdout) as any)?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

async function getFrameStats(buf: Buffer): Promise<{ brightness: number; satStd: number }> {
  const sharp = require('sharp');
  try {
    // Sample center 60% of frame to avoid dark borders
    const meta   = await sharp(buf).metadata();
    const W      = meta.width ?? 640;
    const H      = meta.height ?? 360;
    const cW     = Math.round(W * 0.60);
    const cH     = Math.round(H * 0.60);
    const cX     = Math.round((W - cW) / 2);
    const cY     = Math.round((H - cH) / 2);

    const center = await sharp(buf).extract({ left: cX, top: cY, width: cW, height: cH }).toBuffer();
    const stats  = await sharp(center).stats();

    const means: number[] = stats.channels.slice(0, 3).map((c: any) => c.mean as number);
    const brightness = means.reduce((a, b) => a + b, 0) / means.length;
    const satStd = Math.sqrt(
      means.reduce((sum, m) => sum + (m - brightness) ** 2, 0) / means.length
    );
    return { brightness, satStd };
  } catch { return { brightness: 128, satStd: 20 }; }
}

async function extractFrames(videoPath: string, highlightId: string): Promise<Frame[]> {
  const dur      = await getVideoDuration(videoPath);
  const frameDir = path.join(THUMB_BASE, highlightId, 'frames');
  sikreDir(frameDir);

  const percentages = Array.from(
    { length: FRAME_COUNT },
    (_, i) => 5 + (i * 90 / (FRAME_COUNT - 1))
  );
  const frames: Frame[] = [];
  const BATCH = 4;

  for (let i = 0; i < percentages.length; i += BATCH) {
    const batch = percentages.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (pct) => {
      const t        = Math.max(0.5, (dur * pct) / 100);
      const frameSti = path.join(frameDir, `f${Math.round(pct).toString().padStart(2, '0')}.jpg`);
      try {
        await execAsync(
          `ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale=640:360" "${frameSti}"`,
          { timeout: 15_000 }
        );
        if (!fs.existsSync(frameSti) || fs.statSync(frameSti).size < 4_000) return null;
        const buf  = fs.readFileSync(frameSti);
        const { brightness, satStd } = await getFrameStats(buf);

        if (brightness < BRIGHTNESS_MIN) {
          wLog('INFO', 'THUMBNAIL_FRAME_REJECTED_DARK', { highlightId, pct: Math.round(pct), brightness: Math.round(brightness) });
          logSystemEvent({
            source: 'thumbnail_worker', event_type: 'THUMBNAIL_FRAME_REJECTED_DARK',
            title: `Frame forkastet: for mørk — ${Math.round(pct)}% (lyshet ${Math.round(brightness)}/255)`,
            severity: 'info',
            metadata: { highlightId, pct: Math.round(pct), brightness: Math.round(brightness) },
          });
          return null;
        }
        if (satStd < SAT_STD_MIN && brightness < 70) {
          wLog('INFO', 'FRAME_REJECTED_DESATURATED', { highlightId, pct: Math.round(pct) });
          return null;
        }

        return { buf, pct, t, brightness };
      } catch { return null; }
    }));
    frames.push(...(results.filter(Boolean) as Frame[]));
  }
  return frames;
}

// ── Phase 1: Hook Discovery ───────────────────────────────────────────────────

interface HookData {
  hook:       string;
  emotion:    string;
  headline:   string;   // 2–4 words, CAPS, Norwegian-safe
  badge_text: string;   // 3–6 words, CAPS
}

async function hookDiscovery(
  client: OpenAI,
  h: any,
  vod: any,
  highlightId: string
): Promise<HookData> {
  const cat = h.category ?? '';
  const fallback: HookData = {
    hook:       h.title ?? 'Episk øyeblikk',
    emotion:    'excitement',
    headline:   cat === 'FUNNY' ? 'DETTE VAR SYKT' : cat === 'FAIL' ? 'DET GIKK GALT'
                : cat === 'RAGE' ? 'HAN MISTET DET' : cat === 'RP_MOMENT' ? 'IKKE MULIG'
                : 'SJEKK DETTE',
    badge_text: 'JEG TRODDE IKKE DETTE',
  };

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Du er ekspert på norske YouTube gaming-thumbnails med høy CTR.
Lag thumbnail-tekst. Norsk er OK — æ, ø, å er støttet i fonten.

Svar KUN med JSON:
{
  "hook": "kjernespenningen i 1 setning",
  "emotion": "shock|curiosity|rage|triumph|fear|joy",
  "headline": "2-4 ORD CAPS — følelsen, IKKE beskrivelse",
  "badge_text": "3-6 ORD CAPS — nysgjerrig undertittel"
}

Gode headline-eksempler: "DET GIKK GALT", "ALT FORSVANT", "HAN MISTET DET", "NEI NEI NEI", "IKKE IGJEN", "JEG KØDDER", "ALDRI MER"
Gode badge-eksempler: "JEG TRODDE IKKE DETTE", "HVEM GJØR DETTE", "VERDENS DUMMESTE FEIL", "DET KUNNE IKKE GÅ VERRE"
ALDRI beskrivende titler. ALLTID emosjonell reaksjon. MAKS 4 ord headline.`,
      }, {
        role: 'user',
        content: [
          `Klipp: ${h.title ?? 'Ukjent'}`,
          `Kategori: ${h.category ?? 'Ukjent'}`,
          `Spill: ${vod?.category ?? vod?.title ?? 'Ukjent'}`,
          h.begrunnelse ? `Hva skjedde: ${h.begrunnelse}` : '',
        ].filter(Boolean).join('\n'),
      }],
      max_tokens: 200,
      temperature: 0.9,
    });
    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return { ...fallback, ...JSON.parse(match[0]) };
  } catch (e: any) {
    wLog('WARN', 'HOOK_DISCOVERY_FAIL', { highlightId, err: e.message?.slice(0, 100) });
  }
  return fallback;
}

// ── Phase 3: Vision frame analysis ───────────────────────────────────────────

interface SubjectBox { x: number; y: number; w: number; h: number; }
type SubjectType = 'face' | 'character' | 'vehicle' | 'action' | 'object' | 'none';
interface SubjectAnalysis { box: SubjectBox | null; type: SubjectType; }

async function analyzeFramesWithVision(
  client: OpenAI,
  frames: Frame[],
  hook: HookData,
  highlightId: string
): Promise<{ bestFrame: Frame; subject: SubjectAnalysis }> {
  const fallbackSubject: SubjectAnalysis = { box: null, type: 'none' };
  // Score heuristically: brightness quality + position bonus
  const scored = frames
    .map(f => ({
      ...f,
      hScore:
        Math.min(1, Math.max(0, (f.brightness - BRIGHTNESS_MIN) / 140)) * 0.55 +
        Math.max(0, 1 - Math.abs(f.pct - 50) / 50) * 0.45,
    }))
    .sort((a, b) => b.hScore - a.hScore);

  const candidates = scored.slice(0, Math.min(5, scored.length));
  if (candidates.length === 0) throw new Error('Ingen brukbare frames');

  const fallback = { bestFrame: candidates[0], subject: fallbackSubject };
  if (candidates.length === 1) return fallback;

  try {
    const imageContent: any[] = candidates.map(f => ({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${f.buf.toString('base64')}`,
        detail: 'low',
      },
    }));
    imageContent.push({
      type: 'text',
      text: `${candidates.length} frames from a gaming clip. Hook: "${hook.hook}" | Emotion: ${hook.emotion}

Score each frame 0-100 for THUMBNAIL CTR potential at 120×90px mobile size:
- Brightness OK? Subject clearly visible? Conflict/reaction visible? More colorful?
- Prefer: visible faces/reactions > dramatic conflict > clear subject > good lighting

Also identify the winning frame's MAIN SUBJECT and its bounding box.
Subject types: face | character | vehicle | action | object | none

Reply ONLY with valid JSON (no markdown):
{
  "scores": [{"n":1,"s":0-100,"why":"brief"},{"n":2,...}],
  "winner": <1-${candidates.length}>,
  "subject": {"type":"face|character|vehicle|action|object|none","sx":0.0,"sy":0.0,"sw":0.5,"sh":0.7}
}`,
    });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: imageContent }],
      max_tokens: 350,
      temperature: 0.1,
    });

    const raw   = (res.choices[0]?.message?.content ?? '').replace(/```[a-z]*\n?/gi, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    const d       = JSON.parse(match[0]);
    const winnerN = Math.max(1, Math.min(candidates.length, d.winner ?? 1));
    const best    = candidates[winnerN - 1];

    const sub = d.subject ?? {};
    const boxValid = typeof sub.sx === 'number' && typeof sub.sw === 'number'
      && sub.sw > 0.04 && sub.sh > 0.04;
    const box: SubjectBox | null = boxValid ? {
      x: Math.max(0, Math.min(0.95, sub.sx)),
      y: Math.max(0, Math.min(0.95, sub.sy ?? 0)),
      w: Math.max(0.05, Math.min(0.98, sub.sw)),
      h: Math.max(0.05, Math.min(0.98, sub.sh ?? 0.5)),
    } : null;

    const validTypes: SubjectType[] = ['face','character','vehicle','action','object','none'];
    const subjectType: SubjectType = validTypes.includes(sub.type) ? sub.type : 'none';

    wLog('INFO', 'VISION_ANALYSIS_DONE', {
      highlightId,
      winner: winnerN,
      brightness: Math.round(best.brightness),
      subjectType,
      hasBox: !!box,
    });

    return { bestFrame: best, subject: { box, type: subjectType } };
  } catch (e: any) {
    wLog('WARN', 'VISION_ANALYSIS_FAIL', { highlightId, err: e.message?.slice(0, 100) });
    return fallback;
  }
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

function buildArrowSvg(
  startX: number, startY: number,
  targetX: number, targetY: number
): string {
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

// ── Phase 5: 7-layer composite ────────────────────────────────────────────────

async function buildComposite(
  frameBuf: Buffer,
  W: number,
  H: number,
  hook: HookData,
  subject: SubjectAnalysis,
  category: string,
  fontPath: string | null,
  platform: 'youtube' | 'tiktok'
): Promise<Buffer> {
  const sharp = require('sharp');
  const { decl, fontFamily } = fontDeclaration(fontPath);
  const primary = accentColor(category);
  const isYT    = platform === 'youtube';

  // === Layer 1 + 2: Frame resize + enhancement ===
  const enhanced = await sharp(frameBuf)
    .resize(W, H, { fit: 'cover', position: 'entropy' })
    .sharpen({ sigma: 0.7, m1: 0.4, m2: 3.2 })
    .modulate({ brightness: 1.12, saturation: 1.40 })
    .linear(1.06, -8)
    .toBuffer();

  // === Headline sizing: target full block = 22-25% of height ===
  const safeHead  = sanitizeSvg(hook.headline.toUpperCase());
  const safeBadge = sanitizeSvg(hook.badge_text.toUpperCase());

  const textZoneLeft = Math.round(W * (isYT ? 0.04 : 0.06));
  const textZoneW    = Math.round(W * (isYT ? 0.56 : 0.88));

  const wordCount    = hook.headline.trim().split(/\s+/).length;
  const lineCount    = wordCount <= 2 ? 1 : 2;
  const targetBlkH   = Math.round(H * (isYT ? 0.24 : 0.16));
  const maxFontH     = Math.round(targetBlkH / (lineCount * 1.15));
  const hSize        = calcFontSize(safeHead, textZoneW, maxFontH);
  const hStroke      = Math.max(7, Math.round(hSize / 6));
  const lineSpacing  = hSize * 1.14;

  const headLines  = splitLines(safeHead, Math.floor(textZoneW / (hSize * 0.52)));
  const totalTextH = headLines.length * lineSpacing;

  // Badge sizing
  const badgeFontH = Math.round(H * (isYT ? 0.058 : 0.04));
  const badgeH     = badgeFontH + 26;
  const badgeApproxW = Math.min(
    Math.round(W * 0.75),
    Math.round(safeBadge.length * badgeFontH * 0.54 + 46)
  );
  const badgeBadgeStroke = Math.max(2, Math.round(badgeFontH / 11));

  // Positions (bottom-up layout)
  const badgeBottomY = H - Math.round(H * 0.045);
  const badgeTopY    = badgeBottomY - badgeH;
  const badgeX       = isYT ? textZoneLeft : Math.round((W - badgeApproxW) / 2);
  const badgeCenterX = badgeX + Math.round(badgeApproxW / 2);
  const badgeCenterY = badgeTopY + Math.round(badgeH / 2);

  const textBottomY = badgeTopY - Math.round(H * 0.035);
  const headTopY    = textBottomY - totalTextH;
  const headAnchorX = isYT ? textZoneLeft : Math.round(W / 2);
  const textAnchor  = isYT ? 'start' : 'middle';

  const headTspans = headLines.map((line, i) =>
    `<tspan x="${headAnchorX}" dy="${i === 0 ? 0 : lineSpacing.toFixed(0)}">${line}</tspan>`
  ).join('');

  // Arrow: from mid-right of text zone toward subject
  let arrowSvgStr = '';
  if (subject.box && subject.type !== 'none') {
    const sub = subject.box;
    const subX = Math.round((sub.x + sub.w * 0.25) * W);
    const subY = Math.round((sub.y + sub.h * 0.50) * H);
    // Start arrow from the right edge of the text block, vertically centered
    const arrowStartX = Math.round(headAnchorX + textZoneW * (isYT ? 0.75 : 0.5));
    const arrowStartY = Math.round(headTopY + totalTextH * 0.5);
    arrowSvgStr = buildArrowSvg(arrowStartX, arrowStartY, subX, subY);
  }

  // Vignette and gradient values
  const gradStartY    = Math.round(H * 0.42);
  const vigCX         = isYT ? '65%' : '50%';

  // === SVG overlay: layers 3-6 ===
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

  <!-- Layer 3: Vignette -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g-left)"/>
  <rect x="0" y="${gradStartY}" width="${W}" height="${H - gradStartY}" fill="url(#g-bot)"/>

  <!-- Layer 4: Headline -->
  <text x="${headAnchorX}" y="${Math.round(headTopY + hSize * 0.88)}"
    text-anchor="${textAnchor}"
    font-family="${fontFamily}" font-size="${hSize}px" font-weight="900"
    fill="${primary}" stroke="black" stroke-width="${hStroke}" stroke-linejoin="round"
    paint-order="stroke fill" letter-spacing="2" filter="url(#glow-h)">${headTspans}</text>

  <!-- Layer 5: Arrow (if subject detected) -->
  ${arrowSvgStr}

  <!-- Layer 6: Badge -->
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

  <!-- Accent bar -->
  <rect x="0" y="${H - 5}" width="${W}" height="5" fill="${primary}" opacity="0.88"/>
</svg>`;

  return sharp(enhanced)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 7 })
    .toBuffer();
}

// ── Phase 6: CTR Gate ─────────────────────────────────────────────────────────

interface CtrGateResult {
  passed:         boolean;
  score:          number;
  reason:         string;
  subjectVisible: boolean;
  textReadable:   boolean;
}

async function runCtrGate(
  client: OpenAI,
  ytBuf: Buffer,
  hook: HookData,
  highlightId: string
): Promise<CtrGateResult> {
  const hardFail: CtrGateResult = {
    passed: false, score: 0,
    reason: 'CTR Gate feilet teknisk — thumbnail avvist',
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
          text: `YouTube gaming thumbnail evaluated at mobile feed size (120×90px equivalent).
Context: "${hook.hook}"

Strict criteria:
1. subject_visible: Can you clearly see the MAIN SUBJECT (person, character, vehicle, action)? A mostly dark or empty frame = false.
2. text_readable: Is the LARGE TEXT legible? Boxes □ or scrambled characters = false. Missing text = false.
3. Score 0-100:
   - Subject visibility  /25: can you tell what's happening?
   - Text impact         /25: large, bold, readable, emotional?
   - Emotional signal    /25: does this image make you feel something?
   - Curiosity trigger   /25: would you click this over 20 other videos?

Score ≥ 60 = publishable. Score < 60 = must be regenerated.

Reply ONLY with JSON:
{"subject_visible":true/false,"text_readable":true/false,"score":0-100,"reason":"1-2 sentences"}`,
        }],
      }],
      max_tokens: 160,
      temperature: 0.1,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return hardFail;

    const d             = JSON.parse(match[0]);
    const subjectVisible = !!d.subject_visible;
    const textReadable   = !!d.text_readable;
    const score          = Math.min(100, Math.max(0, d.score ?? 0));
    const reason         = String(d.reason ?? '').slice(0, 200);
    const passed         = subjectVisible && textReadable && score >= CTR_THRESHOLD;

    return { passed, score, reason, subjectVisible, textReadable };
  } catch (e: any) {
    wLog('WARN', 'CTR_GATE_FAIL', { highlightId, err: e.message?.slice(0, 100) });
    return hardFail;
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function buildThumbnailV5(highlightId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  const client    = new OpenAI({ apiKey });
  const thumbDir  = path.join(THUMB_BASE, highlightId);
  const videoPath = path.join(thumbDir, 'video_tmp.mp4');
  sikreDir(thumbDir);

  try {
    wLog('INFO', 'THUMBNAIL_V55_STARTED', { highlightId });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V55_STARTED',
      title: `Thumbnail V5.5 startet for ${highlightId}`, severity: 'info',
      metadata: { highlightId },
    });

    // Load data
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url,thumbnail_reject_count')
      .eq('id', highlightId).single();
    if (!h) throw new Error('Highlight ikke funnet');

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url');

    const { data: vod } = await db.from('content_vods')
      .select('id,title,category').eq('id', h.vod_id).single();

    // Font
    const fontPath = await prepareFont();
    wLog('INFO', fontPath ? 'FONT_READY' : 'FONT_FALLBACK', { font: fontPath ? 'Anton' : 'system (DejaVu/Impact)' });

    // Download video
    if (!await lastNedFil(videoUrl, videoPath)) throw new Error('Kunne ikke laste ned video');

    // Phase 1: Hook Discovery
    const hook = await hookDiscovery(client, h, vod, highlightId);
    wLog('INFO', 'HOOK_DISCOVERED', { highlightId, headline: hook.headline, badge: hook.badge_text, emotion: hook.emotion });

    // Phase 2: Frame extraction + brightness filter
    const frames = await extractFrames(videoPath, highlightId);
    if (frames.length === 0) throw new Error('Ingen brukbare frames — alle for mørke eller desaturerte');
    wLog('INFO', 'FRAMES_EXTRACTED', { highlightId, antall: frames.length });

    // Phase 3: Vision frame analysis
    const { bestFrame, subject } = await analyzeFramesWithVision(client, frames, hook, highlightId);
    wLog('INFO', 'THUMBNAIL_FRAME_SELECTED', {
      highlightId, pct: Math.round(bestFrame.pct),
      brightness: Math.round(bestFrame.brightness), subjectType: subject.type,
    });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_FRAME_SELECTED',
      title: `Frame: ${Math.round(bestFrame.pct)}%, lyshet ${Math.round(bestFrame.brightness)}/255, motiv: ${subject.type}`,
      severity: 'info',
      metadata: { highlightId, pct: Math.round(bestFrame.pct), brightness: Math.round(bestFrame.brightness), subjectType: subject.type, hasBox: !!subject.box },
    });

    // Phase 4+5: Build composites (YouTube + TikTok)
    const [ytBuf, ttBuf] = await Promise.all([
      buildComposite(bestFrame.buf, YT_W, YT_H, hook, subject, h.category, fontPath, 'youtube'),
      buildComposite(bestFrame.buf, TT_W, TT_H, hook, subject, h.category, fontPath, 'tiktok'),
    ]);

    wLog('INFO', 'THUMBNAIL_TEXT_RENDERED', {
      highlightId, headline: hook.headline, badge: hook.badge_text,
      font: fontPath ? 'Anton' : 'system-fallback',
    });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_TEXT_RENDERED',
      title: `Tekst: "${hook.headline}" / badge: "${hook.badge_text}" / font: ${fontPath ? 'Anton' : 'system'}`,
      severity: 'info',
      metadata: { highlightId, headline: hook.headline, badge: hook.badge_text, font: fontPath ? 'Anton' : 'system' },
    });

    if (subject.box && subject.type !== 'none') {
      wLog('INFO', 'THUMBNAIL_SUBJECT_MARKED', { highlightId, type: subject.type });
      logSystemEvent({
        source: 'thumbnail_worker', event_type: 'THUMBNAIL_SUBJECT_MARKED',
        title: `Motiv markert med pil: ${subject.type}`,
        severity: 'info',
        metadata: { highlightId, subjectType: subject.type, box: subject.box },
      });
    }

    // Phase 6: CTR Gate
    const gate        = await runCtrGate(client, ytBuf, hook, highlightId);
    const rejectCount = (h.thumbnail_reject_count ?? 0);

    wLog(
      gate.passed ? 'INFO' : 'WARN',
      gate.passed ? 'THUMBNAIL_CTR_GATE_PASSED' : 'THUMBNAIL_REJECTED_LOW_CTR',
      { highlightId, score: gate.score, subjectVisible: gate.subjectVisible, textReadable: gate.textReadable, reason: gate.reason },
    );
    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: gate.passed ? 'THUMBNAIL_CTR_GATE_PASSED' : 'THUMBNAIL_REJECTED_LOW_CTR',
      title: gate.passed
        ? `CTR Gate: GODKJENT — ${gate.score}/100`
        : `CTR Gate: AVVIST — ${gate.score}/100 (${!gate.subjectVisible ? 'motiv ikke synlig' : !gate.textReadable ? 'tekst ikke lesbar' : 'for lav score'})`,
      severity: gate.passed ? 'info' : 'warning',
      metadata: { highlightId, score: gate.score, subjectVisible: gate.subjectVisible, textReadable: gate.textReadable, reason: gate.reason, rejectCount: rejectCount + (gate.passed ? 0 : 1) },
    });

    if (!gate.passed) {
      const newCount   = rejectCount + 1;
      const maxReached = newCount >= MAX_REJECTS;

      if (maxReached) {
        wLog('WARN', 'THUMBNAIL_NEEDS_MANUAL_REVIEW', { highlightId, totalRejects: newCount });
        logSystemEvent({
          source: 'thumbnail_worker', event_type: 'THUMBNAIL_NEEDS_MANUAL_REVIEW',
          title: `Thumbnail: maks ${MAX_REJECTS} CTR-avvisninger — manuell opplasting påkrevd`,
          severity: 'warning',
          metadata: { highlightId, totalRejects: newCount },
        });
        await db.from('content_highlights').update({
          thumbnail_status:       'NEEDS_MANUAL_REVIEW',
          thumbnail_reject_count: newCount,
          thumbnail_error:        `Maks ${MAX_REJECTS} CTR-avvisninger. Siste: ${gate.reason}`,
        }).eq('id', highlightId);
      } else {
        // Reset to PENDING — worker picks up on next cycle with incremented reject_count
        await db.from('content_highlights').update({
          thumbnail_status:       'PENDING',
          thumbnail_reject_count: newCount,
          thumbnail_error:        `CTR_REJECTED #${newCount}: score=${gate.score} — ${gate.reason}`,
        }).eq('id', highlightId);
      }
      return; // Controlled rejection, not a crash
    }

    // Phase 7: Upload winner
    const vodId = h.vod_id ?? 'unknown';
    const base  = `content-factory/thumbnails/${vodId}/${highlightId}`;
    const [ytUrl, ttUrl] = await Promise.all([
      uploadBuffer(db, ytBuf, `${base}_youtube_v55.png`),
      uploadBuffer(db, ttBuf, `${base}_tiktok_v55.png`),
    ]);

    if (!ytUrl && !ttUrl) throw new Error('Opplasting av thumbnails feilet');

    await db.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl,
      thumbnail_tiktok_url:   ttUrl,
      thumbnail_headline:     hook.headline,
      thumbnail_subheadline:  hook.badge_text || null,
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
      thumbnail_ctr_score:    gate.score,
      thumbnail_concept:      hook.emotion,
      thumbnail_hook:         hook,
    }).eq('id', highlightId);

    wLog('INFO', 'THUMBNAIL_V55_DONE', {
      highlightId, score: gate.score, headline: hook.headline,
      harYT: !!ytUrl, harTT: !!ttUrl,
    });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V55_DONE',
      title: `Thumbnail V5.5 ferdig — CTR ${gate.score}/100 — "${hook.headline}"`,
      severity: 'info',
      metadata: { highlightId, ctrScore: gate.score, headline: hook.headline, badge: hook.badge_text, harYoutube: !!ytUrl, harTikTok: !!ttUrl },
    });

  } catch (err: any) {
    const msg = err.message?.slice(0, 300) ?? 'Ukjent feil';
    wLog('ERROR', 'THUMBNAIL_V55_FAILED', { highlightId, err: msg });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V55_FAILED',
      title: `Thumbnail V5.5 feilet: ${msg}`, severity: 'error',
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
    ryddFiler(videoPath);
    ryddDir(path.join(THUMB_BASE, highlightId, 'frames'));
  }
}
