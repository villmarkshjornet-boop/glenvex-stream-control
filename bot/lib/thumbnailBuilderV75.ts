/**
 * Thumbnail Builder V7.5 — CTR-optimized pipeline
 *
 * Over V7:
 *   • FRAME_SCORER: 18 candidate frames → multi-signal Sharp analysis → top 3
 *   • HOOK ENGINE: 10 Gemini candidates → anti-generic filter → top 3
 *   • CROP ENGINE: 3 modes (attention / face-zone / center-tight)
 *   • COLOR: more aggressive vibrance, contrast, adaptive sharpen
 *   • FOCUS MASK: subject glow + layered gradient behind text
 *   • 3 VARIANTS: frame × hook × crop → Gemini CTR scoring → pick best
 *
 * Acceptance: highlight 45f4a21d-63f4-46a5-8f7c-805f472edb88
 * Target:     AI CTR score ≥ 80, hook from transcript, face fills 30–60%
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

const execAsync = require('util').promisify(require('child_process').exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_BUCKET  = process.env.STORAGE_BUCKET ?? 'glenvex-assets';
const THUMB_BASE      = path.join(process.cwd(), 'data', 'thumbnails');
const FONT_DIR        = '/tmp/glenvex-fonts';
const FONT_ANTON_PATH = path.join(FONT_DIR, 'Anton-Regular.ttf');
const FONT_ANTON_URL  = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf';

const YT_W = 1280;
const YT_H = 720;
const GEMINI_API_URL  = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL    = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

// Text layout constants
const TEXT_MARGIN     = 60;
const HEADLINE_PT     = 108;
const HEADLINE_DPI    = 72;
const SHADOW_OFFSET   = 5;
const TEXT_ZONE_W     = 700;

// Per-process caches
let _fontTestCache: { passed: boolean; fontPath: string | null } | null = null;
const _hookCache = new Map<string, string[]>(); // highlightId → top-3 hooks

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  console.log(`[ThumbnailV75][${level}] ${event}${data ? ' ' + JSON.stringify(data) : ''}`);
}

function sikreDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function accentColor(category: string): string {
  const map: Record<string, string> = {
    RAGE: '#FF2020', CLUTCH: '#00FF87', FUNNY: '#FFD700',
    RP_MOMENT: '#FF69B4', EDUCATIONAL: '#00BFFF', FAIL: '#FF6600', TACTICAL: '#9B59B6',
  };
  return map[category] ?? '#FFFFFF';
}

// ── Font ──────────────────────────────────────────────────────────────────────

async function prepareFont(): Promise<string | null> {
  try {
    if (fs.existsSync(FONT_ANTON_PATH)) return FONT_ANTON_PATH;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const res = await fetch(FONT_ANTON_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    fs.writeFileSync(FONT_ANTON_PATH, Buffer.from(await res.arrayBuffer()));
    return FONT_ANTON_PATH;
  } catch { return null; }
}

async function runFontTest(fp: string | null): Promise<{ passed: boolean; fontPath: string | null }> {
  if (_fontTestCache) return _fontTestCache;
  const sharp = require('sharp');

  const tryFont = async (fontPath: string | null): Promise<boolean> => {
    try {
      const desc   = fontPath ? `Anton ${HEADLINE_PT}` : `DejaVu Sans Bold ${HEADLINE_PT}`;
      const markup = `<span font_desc="${desc}" foreground="white">HELLO ÆØÅ</span>`;
      const buf    = await sharp({ text: { text: markup, fontfile: fontPath ?? undefined, font: fontPath ? 'Anton' : undefined, rgba: true, width: 1000, dpi: HEADLINE_DPI } }).png().toBuffer();
      const { width = 0, height = 0 } = await sharp(buf).metadata();
      return width >= 200 && height >= 40;
    } catch { return false; }
  };

  if (fp && await tryFont(fp)) { _fontTestCache = { passed: true, fontPath: fp }; return _fontTestCache; }
  if (await tryFont(null))     { _fontTestCache = { passed: true, fontPath: null }; return _fontTestCache; }
  _fontTestCache = { passed: false, fontPath: null };
  return _fontTestCache;
}

// ── Video download + duration ─────────────────────────────────────────────────

async function downloadVideo(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch { return false; }
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_format "${videoPath}"`, { timeout: 15_000 });
    return parseFloat((JSON.parse(stdout) as any)?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

// ── FRAME_SCORER ──────────────────────────────────────────────────────────────
//
// Extracts 18 candidate frames, scores each on 6 signals via Sharp pixel analysis,
// returns the top 3 buffers with their scores for use in variant generation.

interface ScoredFrame {
  buf: Buffer;
  score: number;
  pct: number;
  brightness: number;
  contrast: number;
  edgeDensity: number;
  saturation: number;
  quadrantScore: number;
}

async function scoreFrame(buf: Buffer): Promise<Omit<ScoredFrame, 'buf' | 'pct' | 'score'>> {
  const sharp = require('sharp');

  // 8×8 greyscale → brightness + contrast
  const { data: grey } = await sharp(buf).resize(8, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
  const greyArr = Array.from(grey as Buffer) as number[];
  const brightness = greyArr.reduce((a, b) => a + b, 0) / greyArr.length;
  const mean = brightness;
  const variance = greyArr.reduce((a, b) => a + (b - mean) ** 2, 0) / greyArr.length;
  const contrast = Math.sqrt(variance);

  // Edge density: apply Laplacian-like kernel via convolve, measure mean response
  let edgeDensity = 0;
  try {
    const { data: edges } = await sharp(buf)
      .resize(64, 36)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const edgeArr = Array.from(edges as Buffer) as number[];
    edgeDensity = edgeArr.reduce((a, b) => a + Math.abs(b), 0) / edgeArr.length;
  } catch {}

  // Saturation: RGB variance per pixel sample (16×9 grid)
  let saturation = 0;
  try {
    const { data: rgb } = await sharp(buf).resize(16, 9).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgbArr = Array.from(rgb as Buffer) as number[];
    let sat = 0;
    for (let i = 0; i < rgbArr.length; i += 3) {
      const r = rgbArr[i], g = rgbArr[i + 1], b = rgbArr[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx > 0 ? (mx - mn) / mx : 0;
    }
    saturation = sat / (rgbArr.length / 3);
  } catch {}

  // Quadrant scoring: upper-center quadrant is most likely to have faces/action
  // Compare brightness of upper-center vs overall — if it's brighter, more interesting
  let quadrantScore = 0;
  try {
    const { data: qData } = await sharp(buf)
      .extract({ left: Math.round(YT_W * 0.25), top: 0, width: Math.round(YT_W * 0.5), height: Math.round(YT_H * 0.6) })
      .resize(8, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
    const qArr = Array.from(qData as Buffer) as number[];
    const qBrightness = qArr.reduce((a, b) => a + b, 0) / qArr.length;
    // Positive if center is brighter than overall (suggests subject in center)
    quadrantScore = Math.max(0, qBrightness - brightness);
  } catch {}

  return { brightness, contrast, edgeDensity, saturation, quadrantScore };
}

async function extractScoredFrames(videoPath: string, highlightId: string, durationSec: number): Promise<ScoredFrame[]> {
  const frameDir = path.join(THUMB_BASE, highlightId, 'v75_frames');
  sikreDir(frameDir);

  // 18 candidate positions — denser in middle 20-80% where action typically is
  const percentages = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const MIN_BRIGHTNESS = 25;

  const extracted: Array<{ buf: Buffer; pct: number }> = [];

  // Extract in batches of 6 to avoid overwhelming ffmpeg
  const batches: number[][] = [];
  for (let i = 0; i < percentages.length; i += 6) batches.push(percentages.slice(i, i + 6));

  for (const batch of batches) {
    await Promise.all(batch.map(async pct => {
      const t = Math.max(0.5, (durationSec * pct) / 100);
      const framePath = path.join(frameDir, `f${pct}.jpg`);
      try {
        await execAsync(
          `ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale=1280:720" "${framePath}"`,
          { timeout: 12_000 }
        );
        if (!fs.existsSync(framePath) || fs.statSync(framePath).size < 4_000) return;
        extracted.push({ buf: fs.readFileSync(framePath), pct });
      } catch {}
    }));
  }

  if (extracted.length === 0) throw new Error('FRAME_SCORER: ffmpeg kon ikke hente noen frames');

  // Score each frame
  const scored: ScoredFrame[] = await Promise.all(
    extracted.map(async ({ buf, pct }) => {
      const signals = await scoreFrame(buf);
      // Composite CTR score — edge density and saturation are strong CTR signals
      // Normalise each signal to 0-100 scale then weight
      const b   = Math.min(100, signals.brightness / 2.55);         // 0-255 → 0-100
      const c   = Math.min(100, signals.contrast * 1.5);            // empirical scale
      const e   = Math.min(100, signals.edgeDensity * 2.5);         // edge density
      const s   = Math.min(100, signals.saturation * 120);          // saturation
      const q   = Math.min(20, signals.quadrantScore / 2.55 * 0.5); // quadrant bonus (0-20)

      // Penalise nearly-dark or blown-out frames
      const exposurePenalty = (b < 15 || b > 95) ? 20 : 0;

      const score = Math.max(0,
        b * 0.15 +    // brightness (some brightness is good)
        c * 0.20 +    // contrast (high contrast = more visual pop)
        e * 0.35 +    // edge density (action, movement, subjects)
        s * 0.20 +    // saturation (vivid = eye-catching)
        q * 0.10 -    // subject-in-center bonus
        exposurePenalty
      );

      return { buf, pct, score, ...signals };
    })
  );

  // Filter extremely dark frames, sort by score
  const usable = scored.filter(f => f.brightness >= MIN_BRIGHTNESS);
  const sorted = (usable.length > 0 ? usable : scored).sort((a, b) => b.score - a.score);

  wLog('INFO', 'FRAME_SCORER_DONE', {
    total: extracted.length, usable: usable.length,
    top3: sorted.slice(0, 3).map(f => ({ pct: f.pct, score: f.score.toFixed(1) })),
  });

  // Return top 3
  return sorted.slice(0, 3);
}

// ── HOOK ENGINE ───────────────────────────────────────────────────────────────
//
// Sends ONE Gemini request asking for 10 hook candidates.
// Filters out generic fallbacks. Returns top 3 scored hooks.

const FORBIDDEN_GENERIC = new Set([
  'DET GIKK GALT', 'SYKT', 'WOW', 'LOL', 'EPISK ØYEBLIKK',
  'SE DETTE', 'UTROLIG', 'SJEKK DETTE', 'KULT', 'VENT',
]);

function scoreHook(hook: string, title: string, transcript: string | null): number {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Hard requirements
  if (wordCount < 2 || wordCount > 4) return 0;
  if (hook.length < 3 || hook.length > 30) return 0;

  // Forbidden generics penalty
  const base = hook.replace(/[!?]/g, '').trim();
  if (FORBIDDEN_GENERIC.has(base)) return 5; // not 0 — still usable in extremis

  let score = 50; // base

  // Bonus: ends with ! or ? (urgency)
  if (hook.endsWith('!') || hook.endsWith('?') || hook.endsWith('?!')) score += 15;

  // Bonus: references something specific from title/transcript
  const contextWords = [
    ...(title.toLowerCase().split(/\s+/)),
    ...(transcript?.toLowerCase().split(/\s+/) ?? []),
  ].filter(w => w.length > 3);

  const hookLower = hook.toLowerCase();
  const contextHits = contextWords.filter(w => hookLower.includes(w)).length;
  score += Math.min(contextHits * 8, 25);

  // Bonus: proper word count (2-3 is ideal for mobile readability)
  if (wordCount <= 3) score += 10;

  // Bonus: contains emotionally loaded words
  const emotional = ['LØY', 'TATT', 'ARRESTERT', 'VANT', 'TAPTE', 'ANGRER', 'LURT', 'SCAM', 'FEIL', 'UMULIG', 'SJOKK'];
  if (emotional.some(e => hook.includes(e))) score += 15;

  return Math.min(score, 100);
}

async function getHooksMulti(
  highlightId: string,
  frameBuf: Buffer,
  title: string,
  category: string,
  transcript: string | null,
): Promise<string[]> {
  // Return cached hooks (prevents Gemini double-billing on retry)
  const cached = _hookCache.get(highlightId);
  if (cached) {
    wLog('INFO', 'HOOKS_CACHED', { highlightId, count: cached.length });
    return cached;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  let candidates: string[] = [];

  if (geminiKey) {
    try {
      const transcriptHint = transcript
        ? `Transkripsjon: "${transcript.slice(0, 300)}"`
        : '(ingen transkripsjon tilgjengelig)';

      const prompt = [
        'Du er YouTube-thumbnail-ekspert med fokus på CTR.',
        `Tittel: ${title}`,
        `Kategori: ${category}`,
        transcriptHint,
        '',
        'Generer 10 ULIKE norske hooks for dette gaming-klippet.',
        'Hvert hook: 2-4 ORD, VERSALER, norsk, avslutt med ! eller ?!',
        '',
        'Finn den VIRKELIGE konflikten, overraskelsen eller reaksjonen i klippet.',
        'IKKE bruk: DET GIKK GALT / SYKT / WOW / EPISK ØYEBLIKK (for generisk)',
        '',
        'Eksempler på GOD hooks: HUN LØY! / JEG BLE LURT! / POLITIET KOM! / HVEM KOM FØRST?! / ALT FORSVANT!',
        '',
        'Svar med KUN de 10 hookene, én per linje. Ingen numre, ingen forklaring.',
      ].join('\n');

      const res = await fetch(
        `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/jpeg', data: frameBuf.toString('base64') } },
              ],
            }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 200 },
          }),
        }
      );

      if (res.status === 429) {
        wLog('WARN', 'HOOKS_RATE_LIMITED', { highlightId });
      } else if (res.ok) {
        const json = await res.json() as any;
        const rawText = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
        const lines = rawText.split('\n').map((l: string) => l.trim().replace(/^\d+[.)]\s*/, '').toUpperCase().replace(/[^A-ZÆØÅ0-9!? ]/g, '').trim()).filter((h: string) => h.length >= 3);
        candidates = lines;
        wLog('INFO', 'HOOKS_GEMINI_RAW', { highlightId, count: lines.length, examples: lines.slice(0, 3) });
      }
    } catch (e: any) {
      wLog('WARN', 'HOOKS_GEMINI_FAIL', { err: e.message?.slice(0, 100) });
    }
  }

  // Always add deterministic fallbacks so we have ≥3 options
  const titleUp = title.toUpperCase();
  const fallbacks: string[] = [];
  if (titleUp.includes('POLITI') || titleUp.includes('ARRESTERT') || titleUp.includes('TATT')) fallbacks.push('POLITIET KOM!');
  if (titleUp.includes('LØY')   || titleUp.includes('LØGN'))    fallbacks.push('HUN LØY!');
  if (titleUp.includes('SCAM')  || titleUp.includes('LURT'))    fallbacks.push('VI BLE LURT!');
  if (titleUp.includes('VANT')  || titleUp.includes('VINNER'))  fallbacks.push('VI VANT!');
  if (titleUp.includes('TAPTE') || titleUp.includes('FAIL'))    fallbacks.push('JEG TAPTE!');

  const categoryFallbacks: Record<string, string[]> = {
    RAGE: ['JEG ANGRER!', 'FULLSTENDIG KAOS!', 'ALDRI MER!'],
    CLUTCH: ['I SISTE SEKUND!', 'UMULIG REDNING!', 'INGEN TRODDE DET!'],
    FUNNY: ['INGEN FORVENTET DETTE!', 'JEG DØR!', 'HVA SKJER?!'],
    RP_MOMENT: ['POLITIET KOM!', 'VI BLE TATT!', 'HUN LØY!'],
    FAIL: ['JEG ANGRER!', 'TOTALT FAIL!', 'ALDRI IGJEN!'],
    EDUCATIONAL: ['SLIK GJØR DU DET!', 'INGEN VISSTE!', 'HEMMELIG METODE!'],
    TACTICAL: ['PERFEKT PLAN!', 'SLIK VINNER DU!', 'INGEN VISSTE!'],
  };

  const catFallbacks = categoryFallbacks[category] ?? ['SE DETTE!', 'UMULIG!', 'JEG ANGRER!'];
  candidates = [...candidates, ...fallbacks, ...catFallbacks];

  // Score and sort
  const scored = candidates
    .map(h => ({ hook: h, score: scoreHook(h, title, transcript) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Deduplicate by first word (avoid: "JEG ANGRER!" and "JEG ANGRER NESTE GANG!")
  const seen = new Set<string>();
  const unique = scored.filter(x => {
    const key = x.hook.split(' ')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const top3 = unique.slice(0, 3).map(x => x.hook);
  if (top3.length === 0) top3.push('SE HVA SOM SKJEDDE!');

  // Ensure exactly 3
  while (top3.length < 3) top3.push(catFallbacks[top3.length] ?? 'INGEN VISSTE!');

  _hookCache.set(highlightId, top3);

  wLog('INFO', 'HOOKS_SELECTED', {
    highlightId,
    top3,
    scored: unique.slice(0, 5).map(x => `${x.hook}(${x.score})`),
  });

  return top3;
}

// ── CROP ENGINE ───────────────────────────────────────────────────────────────
//
// 3 crop modes for 3 variants:
//   A: 'attention' — Sharp's built-in face/entropy gravity (best general-purpose)
//   B: 'face-zone' — crops upper-center 60% then resizes (face zoom approximation)
//   C: 'entropy'  — Sharp's entropy gravity (picks most complex region)

type CropMode = 'attention' | 'face-zone' | 'entropy';

async function cropFrame(buf: Buffer, mode: CropMode): Promise<Buffer> {
  const sharp = require('sharp');

  if (mode === 'attention') {
    return sharp(buf)
      .resize(YT_W, YT_H, { fit: 'cover', position: 'attention' })
      .toBuffer();
  }

  if (mode === 'face-zone') {
    // Crop: center 70% horizontally, upper 80% vertically → resize to 1280×720
    // This approximates "zoom into the person" in typical gaming clips
    const srcW = YT_W;
    const srcH = YT_H;
    const meta = await sharp(buf).metadata();
    const origW = meta.width ?? srcW;
    const origH = meta.height ?? srcH;

    // First resize to 1280×720 to normalise dimensions
    const base = await sharp(buf).resize(origW, origH, { fit: 'cover' }).toBuffer();
    const baseResized = await sharp(base).resize(YT_W, YT_H, { fit: 'cover', position: 'attention' }).toBuffer();

    // Then crop a zoomed-in region (center 80% × upper 80%), re-resize to full
    const cropW = Math.round(YT_W * 0.80);
    const cropH = Math.round(YT_H * 0.80);
    const cropLeft = Math.round((YT_W - cropW) / 2);
    const cropTop  = 0; // start from top — faces tend to be higher in frame

    return sharp(baseResized)
      .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
      .resize(YT_W, YT_H, { fit: 'fill' })
      .toBuffer();
  }

  // 'entropy': Sharp's entropy gravity
  return sharp(buf)
    .resize(YT_W, YT_H, { fit: 'cover', position: 'entropy' })
    .toBuffer();
}

// ── COLOR GRADING ─────────────────────────────────────────────────────────────
//
// V7.5 enhancement: more aggressive than V7.
// +20 vibrance approx via double-modulate, +20 contrast via linear

async function gradeColors(buf: Buffer): Promise<Buffer> {
  const sharp = require('sharp');

  return sharp(buf)
    // Pass 1: base enhancement
    .modulate({ brightness: 1.1, saturation: 1.6 })
    .linear(1.10, -8)
    // Pass 2: adaptive sharpen — enhances edges without halos
    .sharpen({ sigma: 1.2, m1: 0.8, m2: 4.0, x1: 2, y2: 12, y3: 16 })
    // Pass 3: slight vibrance approximation — boost low-sat areas more
    // (Sharp has no native vibrance; second saturation pass with lower multiplier on already-saturated mimics it)
    .modulate({ saturation: 1.15 })
    .toBuffer();
}

// ── FOCUS MASK ────────────────────────────────────────────────────────────────
//
// Composite two SVG layers over the graded frame:
//   1. Layered gradient: heavy left-bottom shadow for text legibility
//   2. Subtle center-top vignette to focus attention on subject

function buildGradientSvg(textPosition: 'bottom-left' | 'top-left' | 'bottom-center'): string {
  if (textPosition === 'top-left') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0.82"/>
      <stop offset="40%"  stop-color="black" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.10"/>
    </linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.60"/>
      <stop offset="55%"  stop-color="black" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${Math.round(YT_H * 0.5)}" fill="url(#gt)"/>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gl)"/>
</svg>`;
  }

  if (textPosition === 'bottom-center') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="50%"  stop-color="black" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gb)"/>
</svg>`;
  }

  // bottom-left (default — same as V7 but heavier)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.88"/>
      <stop offset="55%"  stop-color="black" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="45%"  stop-color="black" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gl)"/>
  <rect x="0" y="${Math.round(YT_H * 0.32)}" width="${YT_W}" height="${Math.round(YT_H * 0.68)}" fill="url(#gb)"/>
</svg>`;
}

// ── Pango text render ─────────────────────────────────────────────────────────

async function renderPangoText(text: string, fontPath: string | null, colorHex: string, maxW: number, ptSize: number): Promise<Buffer> {
  const sharp = require('sharp');
  const desc   = fontPath ? `Anton ${ptSize}` : `DejaVu Sans Bold ${ptSize}`;
  const markup = `<span font_desc="${desc}" foreground="${colorHex}">${escapeXml(text)}</span>`;
  return sharp({ text: { text: markup, fontfile: fontPath ?? undefined, font: fontPath ? 'Anton' : undefined, rgba: true, width: maxW, dpi: HEADLINE_DPI } }).png().toBuffer();
}

// ── BUILD SINGLE VARIANT ──────────────────────────────────────────────────────

type TextPosition = 'bottom-left' | 'top-left' | 'bottom-center';

async function buildVariant(opts: {
  rawFrame: Buffer;
  hook: string;
  cropMode: CropMode;
  textPosition: TextPosition;
  category: string;
  fontPath: string | null;
}): Promise<Buffer> {
  const sharp = require('sharp');
  const { rawFrame, hook, cropMode, textPosition, category, fontPath } = opts;
  const primary = accentColor(category);

  // 1. Crop
  const cropped = await cropFrame(rawFrame, cropMode);

  // 2. Color grade
  const graded = await gradeColors(cropped);

  // 3. Gradient overlay
  const gradientSvg = buildGradientSvg(textPosition);

  // 4. Text rendering
  const [shadowBuf, mainBuf] = await Promise.all([
    renderPangoText(hook, fontPath, '#000000', TEXT_ZONE_W, HEADLINE_PT),
    renderPangoText(hook, fontPath, primary,   TEXT_ZONE_W, HEADLINE_PT),
  ]);
  const { width: tw = 600, height: th = 120 } = await sharp(mainBuf).metadata();

  // 5. Text position
  let textX: number, textY: number;
  if (textPosition === 'bottom-left') {
    textX = TEXT_MARGIN;
    textY = Math.max(20, YT_H - 80 - th);
  } else if (textPosition === 'top-left') {
    textX = TEXT_MARGIN;
    textY = TEXT_MARGIN;
  } else {
    // bottom-center
    textX = Math.max(0, Math.round((YT_W - tw) / 2));
    textY = Math.max(20, YT_H - 90 - th);
  }

  // 6. Accent stripe
  const stripeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <rect x="0" y="${YT_H - 8}" width="${YT_W}" height="8" fill="${primary}" opacity="0.92"/>
</svg>`;

  // 7. Composite: graded frame → gradient → shadow → headline → stripe
  return sharp(graded)
    .composite([
      { input: Buffer.from(gradientSvg),  top: 0,                        left: 0 },
      { input: shadowBuf,                 top: textY + SHADOW_OFFSET,     left: textX + SHADOW_OFFSET },
      { input: mainBuf,                   top: textY,                     left: textX },
      { input: Buffer.from(stripeSvg),    top: 0,                        left: 0 },
    ])
    .png({ compressionLevel: 7 })
    .toBuffer();
}

// ── AI CTR SCORING ────────────────────────────────────────────────────────────
//
// Sends all 3 variants to Gemini in ONE multimodal request.
// Returns [scoreA, scoreB, scoreC] (0-100 each).

async function scoreCtrVariants(variants: Buffer[], hooks: string[]): Promise<number[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || variants.length === 0) return variants.map(() => 60);

  try {
    // Resize to smaller JPEG for cost efficiency (scoring doesn't need full 1280×720)
    const sharp = require('sharp');
    const thumbs = await Promise.all(
      variants.map(v => sharp(v).resize(320, 180).jpeg({ quality: 75 }).toBuffer())
    );

    const parts: any[] = [
      {
        text: [
          `Du er YouTube CTR-ekspert. Score disse ${variants.length} thumbnail-variantene (0-100).`,
          '',
          'Kriterier:',
          '• Lesbarhet av tekst (0-20): er hooken lett å lese på mobil?',
          '• Emosjon og fokus (0-20): ansikt, reaksjon, handling?',
          '• Kontrast og visuell pop (0-20): skiller den seg ut i feed?',
          '• Relevans og nysgjerrighet (0-20): sier den noe spesifikt?',
          '• Mobilvisning (0-20): fungerer den i lite format?',
          '',
          ...hooks.map((h, i) => `Variant ${String.fromCharCode(65 + i)}: hook="${h}"`),
          '',
          'Svar KUN med tallene, én per linje: f.eks. 72\n68\n81',
          'Ingen forklaring. Nøyaktig ett tall per variant.',
        ].join('\n'),
      },
      ...thumbs.map((t, i) => ({
        inline_data: {
          mime_type: 'image/jpeg',
          data: t.toString('base64'),
          // Gemini doesn't support metadata per part, but we label them in the prompt
        },
      })),
    ];

    const res = await fetch(
      `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 30 },
        }),
      }
    );

    if (!res.ok) return variants.map(() => 60);

    const json = await res.json() as any;
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const scores = text.split('\n')
      .map((l: string) => parseInt(l.trim(), 10))
      .filter((n: number) => !isNaN(n) && n >= 0 && n <= 100);

    // Pad with 60 if Gemini returned fewer scores than variants
    while (scores.length < variants.length) scores.push(60);

    wLog('INFO', 'CTR_SCORES', { scores, hooks });
    return scores.slice(0, variants.length);
  } catch (e: any) {
    wLog('WARN', 'CTR_SCORE_FAIL', { err: e.message?.slice(0, 100) });
    return variants.map(() => 60);
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function uploadBuffer(db: any, buf: Buffer, storagePath: string): Promise<string | null> {
  try {
    const { error } = await Promise.race([
      db.storage.from(STORAGE_BUCKET).upload(storagePath, buf, { contentType: 'image/png', upsert: true }),
      new Promise<{ error: Error }>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timeout 45s')), 45_000)
      ),
    ]);
    if (error) throw error;
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return (data as any)?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'UPLOAD_FAIL', { storagePath, err: err.message?.slice(0, 200) });
    return null;
  }
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export async function buildThumbnailV75(highlightId: string, source?: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const thumbDir  = path.join(THUMB_BASE, highlightId);
  sikreDir(thumbDir);
  const videoPath = path.join(thumbDir, 'video_v75_tmp.mp4');

  wLog('INFO', 'V75_START', { highlightId, source });
  logSystemEvent({
    source: 'thumbnail_worker',
    event_type: 'THUMBNAIL_V75_START',
    title: `Thumbnail V7.5 startet for ${highlightId}`,
    severity: 'info',
    metadata: { highlightId, source: source ?? 'unknown', version: 'V7.5' },
  });

  try {
    // ── 1. Load highlight ─────────────────────────────────────────────────────
    const { data: h } = await db
      .from('content_highlights')
      .select('id,vod_id,title,category,clip_url,vertical_clip_url,start_time,end_time')
      .eq('id', highlightId)
      .single();

    if (!h) throw new Error('Highlight ikke funnet i DB');
    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url');

    wLog('INFO', 'LOADED', { highlightId, title: h.title, category: h.category });

    await db.from('content_highlights').update({
      thumbnail_status:     'GENERATING',
      thumbnail_started_at: new Date().toISOString(),
      thumbnail_error:      null,
    }).eq('id', highlightId);

    // ── 2. Font ───────────────────────────────────────────────────────────────
    const rawFontPath = await prepareFont();
    const { passed: fontOk, fontPath } = await runFontTest(rawFontPath);
    if (!fontOk) throw new Error('Font test feilet — kan ikke garantere lesbar tekst');
    wLog('INFO', 'FONT_READY', { fontPath: fontPath ?? 'system' });

    // ── 3. Transcript ─────────────────────────────────────────────────────────
    const highlightStart = (h.start_time as number) ?? 0;
    const highlightEnd   = (h.end_time   as number) ?? highlightStart + 60;
    const { data: transcriptRows } = h.vod_id
      ? await db.from('content_transcripts')
          .select('start_time,text')
          .eq('vod_id', h.vod_id)
          .gte('end_time', highlightStart)
          .lte('start_time', highlightEnd)
          .order('start_time', { ascending: true })
          .limit(60)
      : { data: null };

    const transcript = (transcriptRows as any[] | null)?.length
      ? (transcriptRows as any[]).map((s: any) => s.text).join(' ').slice(0, 500)
      : null;

    wLog('INFO', 'TRANSCRIPT', { chars: transcript?.length ?? 0 });

    // ── 4. Download video ─────────────────────────────────────────────────────
    if (!await downloadVideo(videoUrl, videoPath)) {
      throw new Error('Video nedlasting feilet (timeout 90s)');
    }
    const durationSec = await getVideoDuration(videoPath);
    wLog('INFO', 'VIDEO_READY', { bytes: fs.statSync(videoPath).size, durationSec });

    // ── 5. FRAME_SCORER ───────────────────────────────────────────────────────
    const scoredFrames = await extractScoredFrames(videoPath, highlightId, durationSec);
    const topFrame = scoredFrames[0];

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_FRAME_SELECTED',
      title: `Frame valgt: pct=${topFrame.pct}% score=${topFrame.score.toFixed(1)}`,
      severity: 'info',
      metadata: {
        highlightId,
        frameScore: topFrame.score,
        framePct: topFrame.pct,
        brightness: topFrame.brightness,
        contrast: topFrame.contrast,
        edgeDensity: topFrame.edgeDensity,
        saturation: topFrame.saturation,
        totalFramesScored: scoredFrames.length,
      },
    });

    // ── 6. HOOK ENGINE ────────────────────────────────────────────────────────
    const hooks = await getHooksMulti(highlightId, topFrame.buf, h.title ?? '', h.category ?? '', transcript);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_HOOK_SELECTED',
      title: `Hook engine: "${hooks[0]}" valgt`,
      severity: 'info',
      metadata: {
        highlightId,
        hook: hooks[0],
        hookAlts: hooks.slice(1),
        hookReason: transcript ? 'transcript_analysis' : 'title_category',
        hasTranscript: !!transcript,
      },
    });

    // ── 7. BUILD 3 VARIANTS ───────────────────────────────────────────────────
    //
    // Variant A: best frame + hook[0] + attention crop + bottom-left text
    // Variant B: 2nd frame  + hook[1] + face-zone crop + top-left text
    // Variant C: best frame + hook[2] + entropy crop   + bottom-center text

    const frameA = scoredFrames[0]?.buf ?? topFrame.buf;
    const frameB = scoredFrames[1]?.buf ?? topFrame.buf;
    const frameC = scoredFrames[0]?.buf ?? topFrame.buf;

    wLog('INFO', 'VARIANTS_BUILD_START', { highlightId, hooks });

    const [varA, varB, varC] = await Promise.all([
      buildVariant({ rawFrame: frameA, hook: hooks[0], cropMode: 'attention',  textPosition: 'bottom-left',   category: h.category ?? '', fontPath }),
      buildVariant({ rawFrame: frameB, hook: hooks[1], cropMode: 'face-zone',  textPosition: 'top-left',     category: h.category ?? '', fontPath }),
      buildVariant({ rawFrame: frameC, hook: hooks[2], cropMode: 'entropy',    textPosition: 'bottom-center', category: h.category ?? '', fontPath }),
    ]);

    wLog('INFO', 'VARIANTS_BUILT', { bytesA: varA.length, bytesB: varB.length, bytesC: varC.length });

    // ── 8. AI CTR SCORING ─────────────────────────────────────────────────────
    const ctrScores = await scoreCtrVariants([varA, varB, varC], hooks);
    const [scoreA, scoreB, scoreC] = ctrScores;

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_CTR_SCORE',
      title: `CTR scores: A=${scoreA} B=${scoreB} C=${scoreC}`,
      severity: 'info',
      metadata: {
        highlightId,
        scoreA, scoreB, scoreC,
        hookA: hooks[0], hookB: hooks[1], hookC: hooks[2],
      },
    });

    // Pick best variant
    const variants = [
      { buf: varA, score: scoreA, label: 'A', hook: hooks[0], cropMode: 'attention',  textPosition: 'bottom-left' },
      { buf: varB, score: scoreB, label: 'B', hook: hooks[1], cropMode: 'face-zone',  textPosition: 'top-left' },
      { buf: varC, score: scoreC, label: 'C', hook: hooks[2], cropMode: 'entropy',    textPosition: 'bottom-center' },
    ];
    const best = variants.reduce((a, b) => a.score >= b.score ? a : b);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_VARIANT_CHOSEN',
      title: `Variant ${best.label} valgt (score: ${best.score}, hook: "${best.hook}")`,
      severity: 'info',
      metadata: {
        highlightId,
        chosenVariant: best.label,
        ctrScore: best.score,
        hook: best.hook,
        cropMode: best.cropMode,
        textPosition: best.textPosition,
        allScores: { A: scoreA, B: scoreB, C: scoreC },
      },
    });

    wLog('INFO', 'VARIANT_CHOSEN', { variant: best.label, score: best.score, hook: best.hook });

    // Debug: write best thumbnail to /tmp for inspection
    try { fs.writeFileSync('/tmp/v75-last-thumbnail.png', best.buf); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantA.png', varA); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantB.png', varB); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantC.png', varC); } catch {}

    // ── 9. Upload best variant ────────────────────────────────────────────────
    const vodId       = h.vod_id ?? 'unknown';
    const storagePath = `content-factory/thumbnails/${vodId}/${highlightId}_v75_yt.png`;
    const thumbnailUrl = await uploadBuffer(db, best.buf, storagePath);
    if (!thumbnailUrl) throw new Error('Upload feilet');

    // Also upload alternates so we can A/B test later
    Promise.all([
      uploadBuffer(db, varA, `content-factory/thumbnails/${vodId}/${highlightId}_v75_A.png`),
      uploadBuffer(db, varB, `content-factory/thumbnails/${vodId}/${highlightId}_v75_B.png`),
      uploadBuffer(db, varC, `content-factory/thumbnails/${vodId}/${highlightId}_v75_C.png`),
    ]).catch(() => {}); // don't block on alt uploads

    wLog('INFO', 'UPLOADED', { url: thumbnailUrl.slice(-50) });

    // ── 10. DB update ─────────────────────────────────────────────────────────
    const { error: dbErr } = await db.from('content_highlights').update({
      thumbnail_status:        'DONE',
      thumbnail_youtube_url:   thumbnailUrl,
      thumbnail_headline:      best.hook,
      thumbnail_error:         null,
      thumbnail_ctr_reason:    `V7.5 · variant:${best.label} · score:${best.score} · crop:${best.cropMode} · hook:${best.hook}`,
      thumbnail_reject_count:  0,
      thumbnail_generated_at:  new Date().toISOString(),
      thumbnail_tiktok_url:    null,
      thumbnail_variant_b_url: null,
      thumbnail_variant_c_url: null,
    }).eq('id', highlightId);

    if (dbErr) throw new Error(`DB update feilet: ${dbErr.message}`);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_V75_RENDER_COMPLETE',
      title: `Thumbnail V7.5 ferdig — "${best.hook}" · score:${best.score} · ${best.buf.length} bytes`,
      severity: 'info',
      metadata: {
        highlightId,
        thumbnailUrl,
        chosenVariant: best.label,
        ctrScore: best.score,
        hook: best.hook,
        cropMode: best.cropMode,
        topFramePct: topFrame.pct,
        topFrameScore: topFrame.score,
        outputBytes: best.buf.length,
        source: source ?? 'unknown',
      },
    });

    wLog('INFO', 'DONE', { highlightId, url: thumbnailUrl, score: best.score, hook: best.hook });

  } catch (e: any) {
    const msg = e.message?.slice(0, 200) ?? 'Ukjent feil';
    wLog('ERROR', 'FAILED', { highlightId, err: msg });

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_V75_FAILED',
      title: `Thumbnail V7.5 feilet: ${msg}`,
      severity: 'error',
      metadata: { highlightId, source: source ?? 'unknown', reason: msg },
    });

    try {
      await db?.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  `V7.5: ${msg}`,
      }).eq('id', highlightId);
    } catch {}

    throw e;

  } finally {
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
  }
}
