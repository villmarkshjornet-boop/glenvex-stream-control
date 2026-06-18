/**
 * Thumbnail Builder V8 — AAA Thumbnail Director
 *
 * Philosophy: Story > Emotion > Curiosity > Action > Faces > Composition > Sharpness
 *
 * "If this thumbnail was next to MrBeast, Asmongold, TommyInnit, or JMWFilms...
 *  would anyone think a human made it? If no — never generate it."
 *
 * Pipeline:
 *  1. STORY_ANALYSIS   — understand highlight BEFORE touching video
 *  2. FRAME_EXTRACT    — 150-200 frames via ffmpeg fps=2
 *  3. SHARP_PREFILTER  — 200 → 40 fast candidates (no AI cost)
 *  4. GEMINI_SCORE     — 40 frames × 15+ signals, batches of 10
 *  5. DEEP_COMPARE     — top 10 frames, AI ranks and explains WHY
 *  6. SUBJECT_PROCESS  — zoom to subject, bg darken, subject brighten, glow
 *  7. CINEMATIC_GRADE  — HDR look, cinematic curve, clarity, dehaze
 *  8. HOOK_V3          — story-driven, transcript-first, no generics
 *  9. VARIANT_BUILD    — 3 different variants + 1 composite (multi-frame)
 * 10. SELF_REVIEW_LOOP — score 0-100, reject <85, retry max 10 times
 * 11. UPLOAD + DB
 *
 * Scoring weights: Story 40% · Emotion 25% · Curiosity 15% · Action 10% · Quality 10%
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';
import { onContentPipelineUpdate } from './streamStateSync';

const execAsync = require('util').promisify(require('child_process').exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_BUCKET  = process.env.STORAGE_BUCKET ?? 'glenvex-assets';
const THUMB_BASE      = path.join(process.cwd(), 'data', 'thumbnails');
const FONT_DIR        = '/tmp/glenvex-fonts';
const FONT_ANTON_PATH = path.join(FONT_DIR, 'Anton-Regular.ttf');
const FONT_ANTON_URL  = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf';
const YT_W            = 1280;
const YT_H            = 720;
const GEMINI_URL      = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL    = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const HEADLINE_PT     = 108;
const HEADLINE_DPI    = 72;
const TEXT_ZONE_W     = 700;
const MAX_FRAMES      = 200;
const GEMINI_BATCH    = 10;
const PREFILTER_KEEP  = 40;
const DEEP_COMPARE_N  = 10;
const SELF_REVIEW_MIN = 85;
const SELF_REVIEW_MAX_ATTEMPTS = 10;

// Top YouTubers to compare against — used in self-review prompt
const BENCHMARK_CREATORS = ['MrBeast', 'Asmongold', 'JMWFilms', 'TommyInnit', 'Dream'];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoryAnalysis {
  conflict:       string;   // "Politiet kjører 190 km/t og stopper streamer"
  emotionalPeak:  string;   // "Streamer mister alt på vei unna"
  clickTrigger:   string;   // "Seerne vil lure på om de blir tatt"
  keyMoments:     string[]; // 3-5 story beats
  recommendedHooks: string[];
  storyScore:     number;   // 0-100: how good is this story for a thumbnail?
  compositeRecommended: boolean; // should we build a multi-frame composite?
}

export interface RawFrame {
  buf:   Buffer;
  index: number;     // frame number
  timeSec: number;   // seconds into clip
}

export interface ScoredFrame {
  buf:           Buffer;
  index:         number;
  timeSec:       number;
  // Gemini signals
  storyScore:    number;
  emotionScore:  number;
  curiosityScore: number;
  actionScore:   number;
  qualityScore:  number;
  faceDetected:  boolean;
  emotionLabel:  string;
  subjectBbox:   [number, number, number, number] | null; // [x, y, w, h] normalized 0-1
  uiClutter:     number;    // 0-10, higher = more distracting HUD
  cinematicScore: number;
  // Combined
  finalScore:    number;
  comparisonRank?: number;  // set by deepCompare
  comparisonReason?: string;
  // Sharp quick signals
  brightness:    number;
  sharpScore:    number;
}

export interface HookV3 {
  text:             string;
  specificityScore: number;
  emotionScore:     number;
  curiosityScore:   number;
  conflictScore:    number;
  storyAlignment:   number; // how well does it match the story analysis?
  totalScore:       number;
  source:           'gemini_story' | 'transcript_direct' | 'fallback';
}

export interface SelfReviewScore {
  story:       number;
  emotion:     number;
  curiosity:   number;
  composition: number;
  lighting:    number;
  professional: number;
  ctr:         number;
  total:       number;
  verdict:     'APPROVED' | 'RETRY' | 'REJECT';
  reason:      string;
}

interface VariantV8 {
  buf:        Buffer;
  label:      'A' | 'B' | 'C' | 'COMPOSITE';
  frame:      ScoredFrame;
  hook:       HookV3;
  cropMode:   string;
  textPos:    string;
  selfReview: SelfReviewScore | null;
  attempts:   number;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  console.log(`[ThumbnailV8][${level}] ${event}${data ? ' ' + JSON.stringify(data) : ''}`);
}

function sikreDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function accentColor(category: string): string {
  const map: Record<string, string> = {
    RAGE: '#FF2020', CLUTCH: '#00FF87', FUNNY: '#FFD700',
    RP_MOMENT: '#FF69B4', EDUCATIONAL: '#00BFFF', FAIL: '#FF6600', TACTICAL: '#9B59B6',
  };
  return map[category] ?? '#FFFFFF';
}

function logEv(eventType: string, title: string, meta: Record<string, unknown>) {
  logSystemEvent({ source: 'thumbnail_worker', event_type: eventType, title, severity: 'info', metadata: meta });
}

// ── Font ──────────────────────────────────────────────────────────────────────

let _fontCache: { passed: boolean; fontPath: string | null } | null = null;

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

async function getFontPath(): Promise<string | null> {
  if (_fontCache) return _fontCache.fontPath;
  const sharp = require('sharp');
  const fp = await prepareFont();
  try {
    const desc = fp ? `Anton ${HEADLINE_PT}` : `DejaVu Sans Bold ${HEADLINE_PT}`;
    const markup = `<span font_desc="${desc}" foreground="white">TEST ÆØÅ</span>`;
    const buf = await sharp({ text: { text: markup, fontfile: fp ?? undefined, font: fp ? 'Anton' : undefined, rgba: true, width: 1000, dpi: HEADLINE_DPI } }).png().toBuffer();
    const { width = 0 } = await sharp(buf).metadata();
    if (width >= 200) { _fontCache = { passed: true, fontPath: fp }; return fp; }
  } catch {}
  _fontCache = { passed: true, fontPath: null };
  return null;
}

// ── Video utilities ───────────────────────────────────────────────────────────

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

// ── STEP 1: STORY ANALYSIS ────────────────────────────────────────────────────
//
// Analyze the highlight's story, conflict, and emotional peak BEFORE touching any frames.
// This defines WHAT we're looking for in the video, not the other way around.

async function analyzeHighlightStory(
  title: string,
  category: string,
  transcript: string | null,
  highlightId: string,
): Promise<StoryAnalysis> {
  const fallback: StoryAnalysis = {
    conflict: title,
    emotionalPeak: 'Ukjent',
    clickTrigger: 'Noe uventet skjer',
    keyMoments: [title],
    recommendedHooks: [],
    storyScore: 50,
    compositeRecommended: false,
  };

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return fallback;

  try {
    const transcriptSection = transcript
      ? `Transkripsjon (${transcript.length} tegn):\n"${transcript.slice(0, 800)}"`
      : '(ingen transkripsjon tilgjengelig)';

    const prompt = `Du er en YouTube-ekspert som analyserer gaming-innhold for å lage thumbnails.

Analyser dette highlightet:
Tittel: ${title}
Kategori: ${category}
${transcriptSection}

Svar med JSON (ingen annen tekst):
{
  "conflict": "Én setning som beskriver konflikten/dramaet",
  "emotionalPeak": "Hva er det mest emosjonelle øyeblikket?",
  "clickTrigger": "Hva vil få en tilfeldig YouTube-seer til å klikke?",
  "keyMoments": ["story beat 1", "story beat 2", "story beat 3"],
  "recommendedHooks": ["HOOK 1!", "HOOK 2?!", "HOOK 3!"],
  "storyScore": 75,
  "compositeRecommended": false
}

Hooks-regler: maks 4 ord, VERSALER, norsk, spesifikt — ALDRI: WOW, LOL, SYKT, DETTE SKJEDDE, HERREGUD.
compositeRecommended = true hvis det er to distinkte scener som ville sett bra ut side ved side.
storyScore: hvor dramatisk/interessant er denne historien for en thumbnail? (0-100)`;

    const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
      }),
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json() as any;
    const raw = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Ingen JSON i Gemini-svar');

    const parsed = JSON.parse(match[0]) as StoryAnalysis;

    logEv('THUMBNAIL_STORY_FOUND', `Story: "${parsed.conflict}" · score:${parsed.storyScore}`, {
      highlightId, conflict: parsed.conflict, emotionalPeak: parsed.emotionalPeak,
      clickTrigger: parsed.clickTrigger, storyScore: parsed.storyScore,
      compositeRecommended: parsed.compositeRecommended,
      recommendedHooks: parsed.recommendedHooks,
    });

    wLog('INFO', 'STORY_ANALYSIS_DONE', { conflict: parsed.conflict, score: parsed.storyScore, composite: parsed.compositeRecommended });
    return parsed;
  } catch (e: any) {
    wLog('WARN', 'STORY_ANALYSIS_FAIL', { err: e.message?.slice(0, 100) });
    return fallback;
  }
}

// ── STEP 2-3: FRAME EXTRACTION + SHARP PRE-FILTER ───────────────────────────
//
// Extract 150-200 frames at fps=2 (or calculated to reach ~150 frames).
// Sharp pre-filter: eliminate obviously bad frames (too dark, too bright, low edge density).
// Keep top PREFILTER_KEEP candidates for Gemini analysis.

async function extractAndPreFilter(
  videoPath: string,
  highlightId: string,
  durationSec: number,
): Promise<RawFrame[]> {
  const sharp = require('sharp');
  const frameDir = path.join(THUMB_BASE, highlightId, 'v8_frames');
  sikreDir(frameDir);

  // Calculate fps to target ~150 frames
  const targetFrames = Math.min(MAX_FRAMES, Math.max(60, Math.ceil(durationSec * 2)));
  const fps = (targetFrames / durationSec).toFixed(2);

  wLog('INFO', 'FRAME_EXTRACT_START', { durationSec, targetFrames, fps, frameDir });

  // Extract all frames in one ffmpeg call (much faster than individual calls)
  const framePattern = path.join(frameDir, 'f%04d.jpg');
  try {
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -vf "fps=${fps},scale=1280:720" -q:v 3 "${framePattern}"`,
      { timeout: 90_000, maxBuffer: 1024 * 1024 * 50 }
    );
  } catch (e: any) {
    wLog('WARN', 'FFMPEG_BATCH_FAIL', { err: e.message?.slice(0, 100) });
    // Fallback: sequential extraction at key percentages
    const pcts = Array.from({ length: 50 }, (_, i) => Math.round(5 + (90 / 50) * i));
    for (const pct of pcts) {
      const t = Math.max(0.5, (durationSec * pct) / 100);
      const fp = path.join(frameDir, `f${String(pct).padStart(4, '0')}.jpg`);
      await execAsync(`ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 3 "${fp}"`, { timeout: 10_000 }).catch(() => {});
    }
  }

  // Read all extracted frames
  const frameFiles = fs.readdirSync(frameDir)
    .filter(f => f.endsWith('.jpg'))
    .sort()
    .slice(0, MAX_FRAMES);

  if (frameFiles.length === 0) throw new Error('FRAME_EXTRACT: ingen frames hentet');

  wLog('INFO', 'FRAMES_EXTRACTED', { count: frameFiles.length });

  // Sharp pre-filter: score each frame on brightness + edges + saturation
  const scored: Array<{ frame: RawFrame; sharpScore: number; brightness: number }> = [];

  await Promise.all(frameFiles.map(async (file, idx) => {
    const framePath = path.join(frameDir, file);
    try {
      const buf = fs.readFileSync(framePath);
      if (buf.length < 4_000) return;

      const { data: grey } = await sharp(buf).resize(8, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
      const greyArr = Array.from(grey as Buffer) as number[];
      const brightness = greyArr.reduce((a, b) => a + b, 0) / greyArr.length;
      const contrast = Math.sqrt(greyArr.reduce((a, b) => a + (b - brightness) ** 2, 0) / greyArr.length);

      let edgeDensity = 0;
      try {
        const { data: edges } = await sharp(buf).resize(64, 36).greyscale()
          .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
          .raw().toBuffer({ resolveWithObject: true });
        const edgeArr = Array.from(edges as Buffer) as number[];
        edgeDensity = edgeArr.reduce((a: number, b: number) => a + Math.abs(b), 0) / edgeArr.length;
      } catch {}

      // Penalize extreme exposure
      const b = Math.min(100, brightness / 2.55);
      const exposurePenalty = (b < 12 || b > 96) ? 30 : (b < 20 || b > 90) ? 15 : 0;
      const sharpScore = Math.max(0, b * 0.10 + contrast * 1.2 + edgeDensity * 2.0 - exposurePenalty);

      const timeSec = (idx / frameFiles.length) * durationSec;
      scored.push({ frame: { buf, index: idx, timeSec }, sharpScore, brightness });
    } catch {}
  }));

  if (scored.length === 0) throw new Error('Sharp pre-filter: alle frames feilet');

  // Keep top PREFILTER_KEEP by sharpScore
  scored.sort((a, b) => b.sharpScore - a.sharpScore);
  const kept = scored.slice(0, PREFILTER_KEEP);

  wLog('INFO', 'SHARP_PREFILTER_DONE', {
    total: scored.length,
    kept: kept.length,
    topScores: kept.slice(0, 5).map(f => f.sharpScore.toFixed(1)),
  });

  return kept.map(f => f.frame);
}

// ── STEP 4: GEMINI BATCH SCORING ─────────────────────────────────────────────
//
// Score all PREFILTER_KEEP frames in batches of GEMINI_BATCH.
// Each frame gets 15+ signals: story, emotion, curiosity, action, quality,
// face, emotion_type, subject_bbox, ui_clutter, cinematic_score, ctr_score.

async function geminiScoreFrames(frames: RawFrame[], story: StoryAnalysis): Promise<ScoredFrame[]> {
  const sharp = require('sharp');
  const geminiKey = process.env.GEMINI_API_KEY;

  // Build initial ScoredFrame array with defaults
  const results: ScoredFrame[] = frames.map(f => ({
    ...f, storyScore: 50, emotionScore: 50, curiosityScore: 50,
    actionScore: 50, qualityScore: 60, faceDetected: false, emotionLabel: 'ingen',
    subjectBbox: null, uiClutter: 3, cinematicScore: 50, finalScore: 50,
    brightness: 128, sharpScore: 50,
  }));

  if (!geminiKey) return results;

  // Process in batches
  const batches: number[][] = [];
  for (let i = 0; i < frames.length; i += GEMINI_BATCH) {
    batches.push(frames.slice(i, i + GEMINI_BATCH).map((_, j) => i + j));
  }

  for (const batchIndices of batches) {
    const batchFrames = batchIndices.map(i => frames[i]);
    const N = batchFrames.length;
    const frameLabels = Array.from({ length: N }, (_, i) => `F${i + 1}`).join(', ');

    try {
      // Resize each to 640×360 JPEG for cost efficiency
      const thumbs = await Promise.all(
        batchFrames.map(f => sharp(f.buf).resize(640, 360).jpeg({ quality: 75 }).toBuffer().catch(() => f.buf))
      );

      const parts: any[] = [
        {
          text: `Du er en YouTube CTR-ekspert og vurderer gaming-frames for thumbnail-valg.

Story-kontekst for dette klippet:
Konflikt: "${story.conflict}"
Emosjonelt høydepunkt: "${story.emotionalPeak}"
Klikk-trigger: "${story.clickTrigger}"

Analyser ${N} frames (${frameLabels}). For hvert, svar med NØYAKTIG én linje:
F1: story=82 emos=75 kurv=70 aksj=80 kval=85 ansikt=ja emosjon=sjokk bbox=0.2,0.1,0.6,0.8 ui=2 cin=85 ctr=78

Felt-definisjonar:
story (0-100): Støtter bildet story-konteksten? Forteller det en åpenbar konflikt?
emos (0-100): Sterk menneskelig emosjon synlig?
kurv (0-100): Nysgjerrighet — vil en tilfeldig seer undre seg?
aksj (0-100): Bevegelse, konflikt, dramatikk, action?
kval (0-100): Teknisk bildekvalitet (lys, skarphet, kontrast, ikke over/undereksponert)?
ansikt: ja/nei
emosjon: ingen/nøytral/smil/latter/sjokk/sinne/frykt/overraskelse/gråt
bbox: x,y,w,h (normalisert 0-1) for HOVEDMOTIVET (karakter, objekt, hendelse)
ui (0-10): Forstyrrende HUD/UI? (0=rent, 10=massevis av UI)
cin (0-100): Cinematisk kvalitet (dramatisk lys, dybde, komposisjon)?
ctr (0-100): Totalt CTR-potensial som YouTube gaming thumbnail?

NB: Prioriter STORY og EMOSJON over teknisk kvalitet. En eksplosjon med ansikt > sylskarpt bilde av ingenting.
Svar KUN med score-linjene. Null forklaring.`,
        },
        ...thumbs.map(t => ({ inline_data: { mime_type: 'image/jpeg', data: t.toString('base64') } })),
      ];

      const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
      });

      if (res.status === 429) { wLog('WARN', 'GEMINI_RATE_LIMIT', { batch: batchIndices[0] }); continue; }
      if (!res.ok) throw new Error(`Gemini ${res.status}`);

      const json = await res.json() as any;
      const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => /^F\d+:/.test(l));

      for (const line of lines) {
        const idxMatch = line.match(/^F(\d+):/);
        if (!idxMatch) continue;
        const localIdx = parseInt(idxMatch[1], 10) - 1;
        const globalIdx = batchIndices[localIdx];
        if (globalIdx === undefined || globalIdx >= results.length) continue;

        const getN = (key: string): number => {
          const m = line.match(new RegExp(`${key}=(\\d+)`));
          return m ? Math.max(0, Math.min(100, parseInt(m[1], 10))) : 50;
        };
        const getS = (key: string): string => {
          const m = line.match(new RegExp(`${key}=([^\\s]+)`));
          return m ? m[1] : '';
        };
        const getBbox = (): [number, number, number, number] | null => {
          const m = line.match(/bbox=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/);
          if (!m) return null;
          return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
        };

        const sf = results[globalIdx];
        sf.storyScore     = getN('story');
        sf.emotionScore   = getN('emos');
        sf.curiosityScore = getN('kurv');
        sf.actionScore    = getN('aksj');
        sf.qualityScore   = getN('kval');
        sf.faceDetected   = getS('ansikt') === 'ja';
        sf.emotionLabel   = getS('emosjon') || 'ingen';
        sf.subjectBbox    = getBbox();
        sf.uiClutter      = Math.min(10, parseInt(getS('ui') || '3', 10));
        sf.cinematicScore = getN('cin');

        // Final score: Story 40% · Emotion 25% · Curiosity 15% · Action 10% · Quality 10%
        // Penalty for high UI clutter
        const uiPenalty = sf.uiClutter * 3;
        sf.finalScore = Math.max(0, Math.min(100,
          sf.storyScore     * 0.40 +
          sf.emotionScore   * 0.25 +
          sf.curiosityScore * 0.15 +
          sf.actionScore    * 0.10 +
          sf.qualityScore   * 0.10 -
          uiPenalty
        ));
      }

      wLog('INFO', 'GEMINI_BATCH_DONE', {
        batchStart: batchIndices[0],
        n: N,
        topCtr: results.slice(batchIndices[0], batchIndices[batchIndices.length - 1] + 1)
          .map(f => f.finalScore.toFixed(0)).slice(0, 5),
      });

    } catch (e: any) {
      wLog('WARN', 'GEMINI_BATCH_FAIL', { batchStart: batchIndices[0], err: e.message?.slice(0, 100) });
    }
  }

  // Sort by finalScore
  results.sort((a, b) => b.finalScore - a.finalScore);

  // Log each rejected frame
  for (const f of results.slice(DEEP_COMPARE_N)) {
    logEv('FRAME_REJECTED', `Frame ${f.index} avvist (score ${f.finalScore.toFixed(0)})`, {
      index: f.index, timeSec: f.timeSec, finalScore: f.finalScore,
      storyScore: f.storyScore, emotionScore: f.emotionScore, uiClutter: f.uiClutter,
    });
  }

  return results;
}

// ── STEP 5: DEEP COMPARISON ───────────────────────────────────────────────────
//
// Top 10 frames → Gemini compares them and explains WHY each is better/worse.
// Returns frames with comparisonRank and comparisonReason filled in.

async function deepCompareTopFrames(frames: ScoredFrame[]): Promise<ScoredFrame[]> {
  const sharp = require('sharp');
  const geminiKey = process.env.GEMINI_API_KEY;
  const top = frames.slice(0, DEEP_COMPARE_N);

  if (!geminiKey || top.length <= 1) {
    top.forEach((f, i) => { f.comparisonRank = i + 1; f.comparisonReason = 'Auto-ranked'; });
    return frames;
  }

  try {
    const thumbs = await Promise.all(
      top.map(f => sharp(f.buf).resize(320, 180).jpeg({ quality: 70 }).toBuffer().catch(() => f.buf))
    );

    const frameList = top.map((f, i) =>
      `F${i + 1}: story=${f.storyScore} emos=${f.emotionScore} face=${f.faceDetected} emosjon=${f.emotionLabel} ui=${f.uiClutter}`
    ).join('\n');

    const parts: any[] = [
      {
        text: `Du sammenligner ${top.length} kandidat-frames for en gaming YouTube thumbnail.

Pre-scores:
${frameList}

Ranger dem 1-${top.length} (1 = best CTR-potensial). For hvert, forklar HVORFOR på maks 10 ord.
Format:
RANK1: F4 — Ansikt med sjokk, politibil i bakgrunn
RANK2: F9 — Sterk action, men mangler ansikt
...og så videre for alle ${top.length} frames.

Prioriter: Story og emosjon over teknisk kvalitet.`,
      },
      ...thumbs.map(t => ({ inline_data: { mime_type: 'image/jpeg', data: t.toString('base64') } })),
    ];

    const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
      }),
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json() as any;
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

    let rank = 1;
    for (const line of text.split('\n')) {
      const m = line.match(/RANK\d+:\s*F(\d+)\s*[—–-]\s*(.+)/i);
      if (!m) continue;
      const frameIdx = parseInt(m[1], 10) - 1;
      const reason = m[2].trim();
      if (frameIdx >= 0 && frameIdx < top.length) {
        top[frameIdx].comparisonRank = rank++;
        top[frameIdx].comparisonReason = reason;
      }
    }

    // Fill any missed ranks
    top.forEach((f, i) => { if (!f.comparisonRank) { f.comparisonRank = i + 1; f.comparisonReason = 'Auto-ranked'; } });

    // Re-sort by comparison rank
    top.sort((a, b) => (a.comparisonRank ?? 99) - (b.comparisonRank ?? 99));

    wLog('INFO', 'DEEP_COMPARE_DONE', {
      winner: { index: top[0].index, rank: top[0].comparisonRank, reason: top[0].comparisonReason },
      top3: top.slice(0, 3).map(f => ({ index: f.index, rank: f.comparisonRank, reason: f.comparisonReason })),
    });

    for (const f of top) {
      logEv('FRAME_ANALYZED', `Frame ${f.index} deep-ranked #${f.comparisonRank}: ${f.comparisonReason}`, {
        index: f.index, timeSec: f.timeSec, comparisonRank: f.comparisonRank,
        comparisonReason: f.comparisonReason, finalScore: f.finalScore,
      });
    }

  } catch (e: any) {
    wLog('WARN', 'DEEP_COMPARE_FAIL', { err: e.message?.slice(0, 100) });
    top.forEach((f, i) => { f.comparisonRank = i + 1; f.comparisonReason = 'Auto-ranked (deep compare failed)'; });
  }

  // Merge back with remaining frames
  const rest = frames.slice(DEEP_COMPARE_N);
  return [...top, ...rest];
}

// ── STEP 6: SUBJECT PROCESSING ────────────────────────────────────────────────
//
// Subject isolation and treatment:
// - Zoom to subject (fills 60-80% of frame)
// - Background darkened (makes subject pop)
// - Subject brightened
// - Soft glow/outline around subject bbox
// - Rule of thirds placement

interface ProcessedFrame {
  buf: Buffer;
  subjectX: number;  // pixel coords of subject center (for text placement)
  subjectY: number;
  safeZones: Array<'left' | 'right' | 'top' | 'bottom'>; // where text can go
}

async function processSubject(frame: ScoredFrame, category: string): Promise<ProcessedFrame> {
  const sharp = require('sharp');
  const accent = accentColor(category);

  // Start with full-frame attention crop
  let base = await sharp(frame.buf)
    .resize(YT_W, YT_H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const bbox = frame.subjectBbox;
  let subjectPixX = YT_W / 2;
  let subjectPixY = YT_H / 2;
  const safeZones: Array<'left' | 'right' | 'top' | 'bottom'> = [];

  if (bbox && bbox[2] > 0.05 && bbox[3] > 0.05) {
    const [bx, by, bw, bh] = bbox;

    // Zoom: expand crop around subject so it fills 65-75% of frame
    const centerX = bx + bw / 2;
    const centerY = by + bh / 2;

    // Calculate zoom crop
    const targetFillRatio = 0.70; // subject should fill 70% of frame
    const currentFillRatio = Math.max(bw, bh);
    const zoomFactor = Math.min(2.5, Math.max(1.0, targetFillRatio / currentFillRatio));

    if (zoomFactor > 1.1) {
      const cropW = Math.round(YT_W / zoomFactor);
      const cropH = Math.round(YT_H / zoomFactor);
      const cropX = Math.max(0, Math.min(YT_W - cropW, Math.round((centerX * YT_W) - cropW / 2)));
      const cropY = Math.max(0, Math.min(YT_H - cropH, Math.round((centerY * YT_H) - cropH / 2)));

      base = await sharp(base)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(YT_W, YT_H, { fit: 'fill' })
        .toBuffer();
    }

    // After zoom, recalculate subject pixel position
    subjectPixX = Math.round(centerX * YT_W);
    subjectPixY = Math.round(centerY * YT_H);

    // Determine safe text zones (opposite side from subject)
    if (centerX < 0.45) { safeZones.push('right'); } else { safeZones.push('left'); }
    if (centerY > 0.55) { safeZones.push('top'); } else { safeZones.push('bottom'); }
  } else {
    safeZones.push('bottom', 'left');
  }

  // Background darkening: apply a radial vignette from subject position
  const vigW = YT_W;
  const vigH = YT_H;
  const vX = Math.round((subjectPixX / YT_W) * 100);
  const vY = Math.round((subjectPixY / YT_H) * 100);

  const vignetteSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vigW}" height="${vigH}">
  <defs>
    <radialGradient id="vg" cx="${vX}%" cy="${vY}%" r="65%" fx="${vX}%" fy="${vY}%">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="35%"  stop-color="black" stop-opacity="0.08"/>
      <stop offset="65%"  stop-color="black" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.82"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${vigW}" height="${vigH}" fill="url(#vg)"/>
</svg>`;

  // Subject glow: soft colored halo at subject position
  const glowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vigW}" height="${vigH}">
  <defs>
    <radialGradient id="gl" cx="${vX}%" cy="${vY}%" r="25%">
      <stop offset="0%"   stop-color="${accent}" stop-opacity="0.12"/>
      <stop offset="60%"  stop-color="${accent}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${vigW}" height="${vigH}" fill="url(#gl)"/>
</svg>`;

  base = await sharp(base)
    .composite([
      { input: Buffer.from(vignetteSvg), top: 0, left: 0 },
      { input: Buffer.from(glowSvg),     top: 0, left: 0 },
    ])
    .toBuffer();

  logEv('SUBJECT_ISOLATED', `Subject at (${vX}%,${vY}%), safe zones: ${safeZones.join(',')}`, {
    subjectPixX, subjectPixY, hasBbox: !!bbox, safeZones,
  });

  return { buf: base, subjectX: subjectPixX, subjectY: subjectPixY, safeZones };
}

// ── CINEMATIC COLOR GRADE ─────────────────────────────────────────────────────
//
// Multi-pass cinematic look:
// Phase 1: Dehaze + base enhancement
// Phase 2: S-curve contrast (midtones up, shadows down, highlights roll-off)
// Phase 3: Clarity (micro-contrast) + sharpen
// Phase 4: Vibrance (second saturation pass, selective)
// Phase 5: Slight warm midtone shift

async function cinematicGrade(buf: Buffer): Promise<Buffer> {
  const sharp = require('sharp');
  return sharp(buf)
    // Phase 1: Base lift + saturation
    .modulate({ brightness: 1.06, saturation: 1.45 })
    // Phase 2: Contrast curve (S-curve approximation)
    .linear(1.14, -10)
    // Phase 3: Gamma for midtone brightness (0.9 = brighter midtones)
    .gamma(0.92)
    // Phase 4: Clarity + sharpen
    .sharpen({ sigma: 1.4, m1: 0.9, m2: 4.5, x1: 2, y2: 14, y3: 18 })
    // Phase 5: Vibrance (final saturation pass)
    .modulate({ saturation: 1.08 })
    .toBuffer();
}

// ── STEP 7: HOOK ENGINE V3 ────────────────────────────────────────────────────
//
// Story-driven hooks. Transcript-first. No generics.
// Forbidden hooks NEVER allowed unless transcript literally uses the word.

const FORBIDDEN_ALWAYS = new Set(['WOW', 'LOL', 'SYKT', 'DETTE SKJEDDE', 'HERREGUD', 'HVA?!', 'VENT']);
const FORBIDDEN_UNLESS_TRANSCRIPT: Record<string, string[]> = {
  'JEG ANGRER': ['angrer', 'angret', 'angrar', 'beklager'],
  'EPISK': ['episk', 'episke'],
  'UTROLIG': ['utrolig'],
  'DET GIKK GALT': ['gikk galt', 'feilet', 'krasjet'],
};

function isForbiddenV3(hook: string, transcript: string | null): boolean {
  const base = hook.replace(/[!?]/g, '').trim().toUpperCase();
  if (FORBIDDEN_ALWAYS.has(base)) return true;
  for (const [forbidden, exceptions] of Object.entries(FORBIDDEN_UNLESS_TRANSCRIPT)) {
    if (!base.startsWith(forbidden)) continue;
    const t = (transcript ?? '').toLowerCase();
    return !exceptions.some(e => t.includes(e));
  }
  return false;
}

const _hookCacheV8 = new Map<string, HookV3[]>();

async function getHooksV3(
  highlightId: string,
  frameBuf: Buffer,
  story: StoryAnalysis,
  title: string,
  category: string,
  transcript: string | null,
): Promise<HookV3[]> {
  const cached = _hookCacheV8.get(highlightId);
  if (cached) { wLog('INFO', 'HOOKS_CACHED', { highlightId }); return cached; }

  const geminiKey = process.env.GEMINI_API_KEY;
  const candidates: HookV3[] = [];

  // First: use story-recommended hooks (already vetted)
  for (const h of (story.recommendedHooks ?? [])) {
    const clean = h.toUpperCase().replace(/[^A-ZÆØÅ0-9!? ]/g, '').trim();
    const words = clean.split(/\s+/).filter(Boolean).length;
    if (words < 2 || words > 4) continue;
    if (isForbiddenV3(clean, transcript)) continue;
    candidates.push({
      text: clean,
      specificityScore: 85,
      emotionScore: 80,
      curiosityScore: 75,
      conflictScore: 80,
      storyAlignment: 95,
      totalScore: 83,
      source: 'gemini_story',
    });
  }

  // Second: extract hooks directly from transcript (highest specificity)
  if (transcript && transcript.length > 50) {
    const directPhrases = extractTranscriptHooks(transcript);
    for (const phrase of directPhrases) {
      if (isForbiddenV3(phrase, transcript)) continue;
      candidates.push({
        text: phrase,
        specificityScore: 95,
        emotionScore: 75,
        curiosityScore: 80,
        conflictScore: 70,
        storyAlignment: 90,
        totalScore: 84,
        source: 'transcript_direct',
      });
    }
  }

  // Third: Gemini hook generation with full story context
  if (geminiKey && candidates.length < 5) {
    try {
      const sharp = require('sharp');
      const thumbBuf = await sharp(frameBuf).resize(640, 360).jpeg({ quality: 80 }).toBuffer().catch(() => frameBuf);
      const transcriptHint = transcript ? `Transkripsjon: "${transcript.slice(0, 500)}"` : '(ingen transkripsjon)';

      const prompt = [
        'Du er YouTube thumbnail-ekspert. Generer 10 norske hooks for dette klippet.',
        '',
        `Konflikt: "${story.conflict}"`,
        `Emosjonelt høydepunkt: "${story.emotionalPeak}"`,
        `Klikk-trigger: "${story.clickTrigger}"`,
        transcriptHint,
        '',
        'Regler:',
        '• 2-4 ord, VERSALER, norsk, avslutt med ! eller ?!',
        '• SPESIFIKT til dette klippet — ALDRI generiske fraser',
        '• FORBUDT: WOW / LOL / SYKT / DETTE SKJEDDE / HERREGUD / JEG ANGRER (om ikke transcript sier det)',
        '• Hook skal svare på: "Hva er det overraskende/dramatiske?"',
        '• Eksempel på bra hooks: "190 KM/T!" · "STOPP POLITIET!" · "HAN TOK ALT!" · "SISTE SJANSE!"',
        '',
        'Score hvert hook:',
        '  spes = spesifisitet (0-100)',
        '  emos = emosjonskraft (0-100)',
        '  kurv = nysgjerrighet (0-100)',
        '  konf = konflikt/drama (0-100)',
        '',
        'Format (én linje per hook):',
        'HOOK TEKST! | spes=90 | emos=85 | kurv=80 | konf=90',
        '',
        'Svar KUN med hook-linjene.',
      ].join('\n');

      const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: thumbBuf.toString('base64') } }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
        }),
      });

      if (res.ok) {
        const json = await res.json() as any;
        const rawText = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

        for (const line of rawText.split('\n')) {
          const parts = line.trim().split('|').map((s: string) => s.trim());
          if (parts.length < 5) continue;
          const text = parts[0].toUpperCase().replace(/[^A-ZÆØÅ0-9!? ]/g, '').trim();
          const words = text.split(/\s+/).filter(Boolean).length;
          if (words < 2 || words > 4 || text.length < 3) continue;
          if (isForbiddenV3(text, transcript)) { wLog('INFO', 'HOOK_FILTERED', { hook: text }); continue; }

          const getScore = (s: string): number => { const m = s.match(/\d+/); return m ? Math.min(100, parseInt(m[0], 10)) : 50; };
          const spes = getScore(parts[1]);
          const emos = getScore(parts[2]);
          const kurv = getScore(parts[3]);
          const konf = getScore(parts[4]);
          const total = spes * 0.30 + emos * 0.25 + kurv * 0.25 + konf * 0.20;

          candidates.push({ text, specificityScore: spes, emotionScore: emos, curiosityScore: kurv, conflictScore: konf, storyAlignment: Math.round((spes + konf) / 2), totalScore: total, source: 'gemini_story' });
        }
      }
    } catch (e: any) {
      wLog('WARN', 'HOOKS_GEMINI_FAIL', { err: e.message?.slice(0, 100) });
    }
  }

  // Fallback
  if (candidates.length === 0) {
    const fallback = buildFallbackHookV3(story, title, category);
    candidates.push(fallback);
  }

  // Deduplicate by first word, sort by totalScore
  const seen = new Set<string>();
  const sorted = candidates
    .sort((a, b) => b.totalScore - a.totalScore)
    .filter(h => { const key = h.text.split(' ')[0]; if (seen.has(key)) return false; seen.add(key); return true; });

  const top3 = sorted.slice(0, 3);
  while (top3.length < 3) top3.push(buildFallbackHookV3(story, title, category));

  _hookCacheV8.set(highlightId, top3);

  wLog('INFO', 'HOOKS_V3_DONE', {
    top3: top3.map(h => ({ text: h.text, score: h.totalScore.toFixed(0), source: h.source })),
  });

  return top3;
}

function extractTranscriptHooks(transcript: string): string[] {
  const hooks: string[] = [];
  const t = transcript.toLowerCase();

  // Detect numbers (speeds, amounts, counts) — very high specificity
  const speedMatch = t.match(/(\d{2,3})\s*km[\s/]t/);
  if (speedMatch) hooks.push(`${speedMatch[1]} KM/T!`);

  const moneyMatch = t.match(/(\d+[\s.,]\d+|tusen|million)\s*(kr|nok|dollar|euro)/i);
  if (moneyMatch) hooks.push('JEG MISTET ALT!');

  // Detect specific events from transcript
  if (t.includes('politi') || t.includes('stopp')) hooks.push('STOPP POLITIET!');
  if (t.includes('krasj') || t.includes('kollisjon')) hooks.push('NESTEN KRASJ!');
  if (t.includes('stjel') || t.includes('raner') || t.includes('ran')) hooks.push('HAN TOK ALT!');
  if (t.includes('boss') || t.includes('drap') && t.includes('siste')) hooks.push('SISTE SJANSE!');
  if (t.includes('røm') || t.includes('stikk') || t.includes('løp')) hooks.push('JEG RØM!');
  if (t.includes('vant') || t.includes('seier') || t.includes('vinner')) hooks.push('VI VANT!');
  if (t.includes('avslør') || t.includes('løy') || t.includes('løgn')) hooks.push('HAN LØY!');

  return hooks.filter((h, i, arr) => arr.indexOf(h) === i).slice(0, 3);
}

function buildFallbackHookV3(story: StoryAnalysis, title: string, category: string): HookV3 {
  const conflict = story.conflict.toLowerCase();
  let text = 'SE HVA SOM SKJEDDE!';

  if (conflict.includes('politi')) text = 'STOPP POLITIET!';
  else if (conflict.includes('krasj') || conflict.includes('kollis')) text = 'NESTEN KRASJ!';
  else if (conflict.includes('stjel') || conflict.includes('ran') || conflict.includes('røv')) text = 'HAN TOK ALT!';
  else if (conflict.includes('tap') || conflict.includes('mistet') || conflict.includes('dø')) text = 'JEG MISTET ALT!';
  else if (conflict.includes('seier') || conflict.includes('vann') || conflict.includes('vinner')) text = 'VI VANT!';
  else if (category === 'CLUTCH') text = 'I SISTE SEKUND!';
  else if (category === 'RAGE') text = 'DET VAR NOK!';
  else if (category === 'FAIL') text = 'DETTE GAR GALT!';
  else if (category === 'RP_MOMENT') text = 'POLITIET KOM!';

  return { text, specificityScore: 60, emotionScore: 65, curiosityScore: 60, conflictScore: 60, storyAlignment: 55, totalScore: 61, source: 'fallback' };
}

// ── TEXT RENDERING ─────────────────────────────────────────────────────────────

async function renderText(text: string, fontPath: string | null, color: string, maxW: number): Promise<Buffer> {
  const sharp = require('sharp');
  const desc = fontPath ? `Anton ${HEADLINE_PT}` : `DejaVu Sans Bold ${HEADLINE_PT}`;
  const markup = `<span font_desc="${desc}" foreground="${color}">${escapeXml(text)}</span>`;
  return sharp({ text: { text: markup, fontfile: fontPath ?? undefined, font: fontPath ? 'Anton' : undefined, rgba: true, width: maxW, dpi: HEADLINE_DPI } }).png().toBuffer();
}

function buildTextPosition(
  safeZones: Array<'left' | 'right' | 'top' | 'bottom'>,
  textW: number,
  textH: number,
): { x: number; y: number; label: string } {
  const MARGIN = 48;

  if (safeZones.includes('bottom') && safeZones.includes('left')) {
    return { x: MARGIN, y: Math.max(16, YT_H - MARGIN - textH), label: 'bottom-left' };
  }
  if (safeZones.includes('bottom') && safeZones.includes('right')) {
    return { x: Math.max(MARGIN, YT_W - MARGIN - textW), y: Math.max(16, YT_H - MARGIN - textH), label: 'bottom-right' };
  }
  if (safeZones.includes('top') && safeZones.includes('left')) {
    return { x: MARGIN, y: MARGIN, label: 'top-left' };
  }
  if (safeZones.includes('top')) {
    return { x: Math.max(0, Math.round((YT_W - textW) / 2)), y: MARGIN, label: 'top-center' };
  }
  return { x: MARGIN, y: Math.max(16, YT_H - MARGIN - textH), label: 'bottom-left' };
}

// Bottom stripe accent SVG
function accentStripe(color: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}"><rect x="0" y="${YT_H - 7}" width="${YT_W}" height="7" fill="${color}" opacity="0.90"/></svg>`);
}

// ── STEP 8: BUILD SINGLE-FRAME VARIANT ────────────────────────────────────────

async function buildSingleVariant(
  frame: ScoredFrame,
  hook: HookV3,
  category: string,
  fontPath: string | null,
  label: 'A' | 'B' | 'C',
  highlightId: string,
): Promise<Buffer> {
  const sharp = require('sharp');
  const primary = accentColor(category);

  // Process subject (zoom, vignette, glow)
  const processed = await processSubject(frame, category);

  // Cinematic grade
  const graded = await cinematicGrade(processed.buf);

  // Render text
  const [shadowBuf, mainBuf] = await Promise.all([
    renderText(hook.text, fontPath, '#000000', TEXT_ZONE_W),
    renderText(hook.text, fontPath, primary,   TEXT_ZONE_W),
  ]);
  const { width: tw = 600, height: th = 120 } = await sharp(mainBuf).metadata();
  const { x: textX, y: textY, label: posLabel } = buildTextPosition(processed.safeZones, tw, th);

  const out = await sharp(graded)
    .composite([
      { input: shadowBuf,        top: textY + 5,   left: textX + 5 },
      { input: mainBuf,          top: textY,        left: textX },
      { input: accentStripe(primary), top: 0,       left: 0 },
    ])
    .png({ compressionLevel: 7 })
    .toBuffer();

  logEv('THUMBNAIL_CROP_SELECTED', `Variant ${label}: subject at (${processed.subjectX},${processed.subjectY}), text ${posLabel}`, {
    highlightId, variantLabel: label, textPosition: posLabel, hook: hook.text,
    subjectX: processed.subjectX, subjectY: processed.subjectY, safeZones: processed.safeZones,
  });
  logEv('THUMBNAIL_VARIANT_GENERATED', `Variant ${label} generert: "${hook.text}" · ${posLabel}`, {
    highlightId, variantLabel: label, hook: hook.text, hookScore: hook.totalScore,
    hookSource: hook.source, storyAlignment: hook.storyAlignment, bytes: out.length,
  });

  return out;
}

// ── COMPOSITE VARIANT (MULTI-FRAME) ───────────────────────────────────────────
//
// When story.compositeRecommended = true, build a multi-frame composition:
// - Background: blurred/darkened frame1
// - Left panel: subject from frame1 (~58% width)
// - Right panel: subject from frame2 (~42% width)
// - Diagonal separator glow
// - Text: large, centered

async function buildCompositeVariant(
  frames: ScoredFrame[],
  hooks: HookV3[],
  category: string,
  fontPath: string | null,
  highlightId: string,
): Promise<Buffer> {
  const sharp = require('sharp');
  const primary = accentColor(category);

  const frame1 = frames[0];
  // Pick frame2 with different emotional tone for contrast
  const frame2 = frames.find(f => f !== frame1 && f.emotionLabel !== frame1.emotionLabel && f.index !== frame1.index) ?? frames[Math.min(2, frames.length - 1)];
  const hook   = hooks[0];

  wLog('INFO', 'COMPOSITE_BUILD', { frame1: frame1.index, frame2: frame2.index, hook: hook.text });

  // 1. Background: full-width blurred + darkened frame1
  const bg = await sharp(frame1.buf)
    .resize(YT_W, YT_H, { fit: 'cover', position: 'attention' })
    .blur(18)
    .modulate({ brightness: 0.35, saturation: 0.8 })
    .toBuffer();

  const LEFT_W  = Math.round(YT_W * 0.58);
  const RIGHT_W = YT_W - LEFT_W + 60; // slight overlap

  // 2. Left panel: frame1 subject, tall crop
  const leftBuf = await sharp(frame1.buf)
    .resize(LEFT_W, YT_H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const leftGraded = await cinematicGrade(leftBuf);

  // 3. Right panel: frame2, positioned right, slight offset down
  const rightBuf = await sharp(frame2.buf)
    .resize(RIGHT_W, YT_H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const rightGraded = await cinematicGrade(rightBuf);

  // 4. Diagonal separator: glowing vertical line with gradient
  const sepX = LEFT_W - 30;
  const separatorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${primary}" stop-opacity="0"/>
      <stop offset="30%"  stop-color="${primary}" stop-opacity="0.85"/>
      <stop offset="70%"  stop-color="${primary}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <rect x="${sepX}" y="0" width="4" height="${YT_H}" fill="url(#sg)"/>
  <rect x="${sepX - 2}" y="0" width="8" height="${YT_H}" fill="${primary}" opacity="0.3" filter="url(#glow)"/>
</svg>`;

  // 5. Dark gradient overlays for text readability
  const textGradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="50%"  stop-color="black" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.90"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#tg)"/>
</svg>`;

  // 6. Text: large, centered at bottom
  const [shadowBuf, mainBuf] = await Promise.all([
    renderText(hook.text, fontPath, '#000000', YT_W - 80),
    renderText(hook.text, fontPath, primary,   YT_W - 80),
  ]);
  const { width: tw = 800, height: th = 120 } = await sharp(mainBuf).metadata();
  const textX = Math.max(0, Math.round((YT_W - tw) / 2));
  const textY = Math.max(20, YT_H - 60 - th);

  const out = await sharp(bg)
    .composite([
      { input: leftGraded,                 top: 0, left: 0 },
      { input: rightGraded,                top: 0, left: YT_W - RIGHT_W },
      { input: Buffer.from(separatorSvg),  top: 0, left: 0 },
      { input: Buffer.from(textGradSvg),   top: 0, left: 0 },
      { input: shadowBuf,                  top: textY + 5, left: textX + 5 },
      { input: mainBuf,                    top: textY,     left: textX },
      { input: accentStripe(primary),      top: 0, left: 0 },
    ])
    .png({ compressionLevel: 7 })
    .toBuffer();

  logEv('THUMBNAIL_VARIANT_GENERATED', `Composite variant generert: "${hook.text}" · to frames (${frame1.index}, ${frame2.index})`, {
    highlightId, variantLabel: 'COMPOSITE', hook: hook.text,
    frame1Index: frame1.index, frame2Index: frame2.index, bytes: out.length,
  });

  return out;
}

// ── STEP 10: SELF-REVIEW LOOP ─────────────────────────────────────────────────
//
// Score the thumbnail 0-100. Reject if total < SELF_REVIEW_MIN.
// Retry up to SELF_REVIEW_MAX_ATTEMPTS times (different frames/hooks each time).
// Compare to top YouTubers to check if it "looks human-made".

async function selfReviewThumbnail(buf: Buffer, hook: HookV3, story: StoryAnalysis): Promise<SelfReviewScore> {
  const sharp = require('sharp');
  const geminiKey = process.env.GEMINI_API_KEY;

  const fallback: SelfReviewScore = {
    story: 70, emotion: 70, curiosity: 70, composition: 70,
    lighting: 70, professional: 70, ctr: 70, total: 70,
    verdict: 'RETRY', reason: 'Gemini ikke tilgjengelig',
  };

  if (!geminiKey) return fallback;

  try {
    const previewBuf = await sharp(buf).resize(640, 360).jpeg({ quality: 80 }).toBuffer();

    const benchmarks = BENCHMARK_CREATORS.join(', ');
    const prompt = `Du er YouTube thumbnail-direktør og vurderer om denne thumbnailen er klar til publisering.

Story-kontekst: "${story.conflict}"
Hook-tekst på thumbnail: "${hook.text}"
Sammenlign med: ${benchmarks}

Score på 7 dimensjoner (0-100 hver):
story:        Kommuniserer thumbnail en klar, interessant story?
emotion:      Viser den sterk, umiddelbar emosjon?
curiosity:    Vil en som scroller stoppe opp og undre seg?
composition:  Er layout og komposisjon profesjonell?
lighting:     Er lys, kontrast og farger bra?
professional: Ser den menneskeskapt ut (ikke auto-generert)?
ctr:          Estimert klikkfrekvens vs. YouTube gaming-gjennomsnitt?

Svar i NØYAKTIG dette formatet (ingen annen tekst):
story=82 emotion=85 curiosity=78 composition=80 lighting=77 professional=85 ctr=79
TOTAL=81
VERDICT: APPROVED
REASON: Sterk emosjon og hook, men noe mørkt i hjørnene.

Mulige verdicts:
- APPROVED (total >= ${SELF_REVIEW_MIN})
- RETRY (${SELF_REVIEW_MIN - 15}-${SELF_REVIEW_MIN - 1}: tryggbar med annet frame/hook)
- REJECT (< ${SELF_REVIEW_MIN - 15}: fundamentalt problem, prøv annet approach)

Vær STRENG. Ikke godkjenn noe du ikke ville klikket på selv.`;

    const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: previewBuf.toString('base64') } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
      }),
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json() as any;
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

    const getN = (key: string): number => {
      const m = text.match(new RegExp(`${key}=(\\d+)`));
      return m ? parseInt(m[1], 10) : 70;
    };
    const totalMatch = text.match(/TOTAL=(\d+)/i);
    const verdictMatch = text.match(/VERDICT:\s*(APPROVED|RETRY|REJECT)/i);
    const reasonMatch = text.match(/REASON:\s*(.+)/i);

    const total = totalMatch ? parseInt(totalMatch[1], 10) : Math.round((getN('story') + getN('emotion') + getN('curiosity') + getN('composition') + getN('lighting') + getN('professional') + getN('ctr')) / 7);
    const verdict = (verdictMatch?.[1]?.toUpperCase() as 'APPROVED' | 'RETRY' | 'REJECT') ?? (total >= SELF_REVIEW_MIN ? 'APPROVED' : total >= SELF_REVIEW_MIN - 15 ? 'RETRY' : 'REJECT');

    return {
      story:        getN('story'),
      emotion:      getN('emotion'),
      curiosity:    getN('curiosity'),
      composition:  getN('composition'),
      lighting:     getN('lighting'),
      professional: getN('professional'),
      ctr:          getN('ctr'),
      total,
      verdict,
      reason: reasonMatch?.[1]?.trim() ?? 'Ingen begrunnelse',
    };
  } catch (e: any) {
    wLog('WARN', 'SELF_REVIEW_FAIL', { err: e.message?.slice(0, 100) });
    return fallback;
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function uploadBuffer(db: any, buf: Buffer, storagePath: string): Promise<string | null> {
  try {
    const { error } = await Promise.race([
      db.storage.from(STORAGE_BUCKET).upload(storagePath, buf, { contentType: 'image/png', upsert: true }),
      new Promise<{ error: Error }>((_, reject) => setTimeout(() => reject(new Error('Upload timeout')), 45_000)),
    ]);
    if (error) throw error;
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return (data as any)?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'UPLOAD_FAIL', { storagePath, err: err.message?.slice(0, 200) });
    return null;
  }
}

// ── MAIN: buildThumbnailV8 ────────────────────────────────────────────────────

export async function buildThumbnailV8(highlightId: string, source?: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const thumbDir  = path.join(THUMB_BASE, highlightId);
  sikreDir(thumbDir);
  const videoPath = path.join(thumbDir, 'video_v8_tmp.mp4');

  wLog('INFO', 'V8_START', { highlightId, source });
  logEv('THUMBNAIL_V8_START', `Thumbnail V8 startet for ${highlightId}`, { highlightId, source: source ?? 'unknown', version: 'V8' });

  try {
    // ── Load highlight ────────────────────────────────────────────────────────
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,clip_url,vertical_clip_url,start_time,end_time')
      .eq('id', highlightId).single();

    if (!h) throw new Error('Highlight ikke funnet i DB');
    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url');

    await db.from('content_highlights').update({
      thumbnail_status: 'GENERATING', thumbnail_started_at: new Date().toISOString(), thumbnail_error: null,
    }).eq('id', highlightId);

    // ── Font ──────────────────────────────────────────────────────────────────
    const fontPath = await getFontPath();
    wLog('INFO', 'FONT_READY', { fontPath: fontPath ?? 'system' });

    // ── Transcript ────────────────────────────────────────────────────────────
    const highlightStart = (h.start_time as number) ?? 0;
    const highlightEnd   = (h.end_time   as number) ?? highlightStart + 60;
    const { data: transcriptRows } = h.vod_id
      ? await db.from('content_transcripts').select('start_time,text')
          .eq('vod_id', h.vod_id).gte('end_time', highlightStart).lte('start_time', highlightEnd)
          .order('start_time', { ascending: true }).limit(80)
      : { data: null };

    const transcript = (transcriptRows as any[] | null)?.length
      ? (transcriptRows as any[]).map((s: any) => s.text).join(' ').slice(0, 800)
      : null;

    // ── STEP 1: Story Analysis ────────────────────────────────────────────────
    wLog('INFO', 'STEP1_STORY_ANALYSIS', {});
    const story = await analyzeHighlightStory(h.title ?? '', h.category ?? '', transcript, highlightId);

    // ── Download video ────────────────────────────────────────────────────────
    if (!await downloadVideo(videoUrl, videoPath)) throw new Error('Video nedlasting feilet');
    const durationSec = await getVideoDuration(videoPath);
    wLog('INFO', 'VIDEO_READY', { bytes: fs.statSync(videoPath).size, durationSec });

    // ── STEP 2-3: Frame extraction + Sharp pre-filter ─────────────────────────
    wLog('INFO', 'STEP2_FRAME_EXTRACT', {});
    const rawFrames = await extractAndPreFilter(videoPath, highlightId, durationSec);

    // ── STEP 4: Gemini batch scoring ──────────────────────────────────────────
    wLog('INFO', 'STEP4_GEMINI_SCORE', { frames: rawFrames.length });
    const scoredFrames = await geminiScoreFrames(rawFrames, story);

    // ── STEP 5: Deep comparison of top 10 ────────────────────────────────────
    wLog('INFO', 'STEP5_DEEP_COMPARE', {});
    const rankedFrames = await deepCompareTopFrames(scoredFrames);
    const topFrame = rankedFrames[0];

    logEv('FRAME_SELECTED', `Frame ${topFrame.index} valgt (rank #${topFrame.comparisonRank}) — ${topFrame.comparisonReason}`, {
      highlightId, frameIndex: topFrame.index, timeSec: topFrame.timeSec,
      storyScore: topFrame.storyScore, emotionScore: topFrame.emotionScore,
      emotionLabel: topFrame.emotionLabel, finalScore: topFrame.finalScore,
      comparisonRank: topFrame.comparisonRank, comparisonReason: topFrame.comparisonReason,
      faceDetected: topFrame.faceDetected, uiClutter: topFrame.uiClutter,
    });

    // ── STEP 7: Hook Engine V3 ────────────────────────────────────────────────
    wLog('INFO', 'STEP7_HOOKS', {});
    const hooks = await getHooksV3(highlightId, topFrame.buf, story, h.title ?? '', h.category ?? '', transcript);

    logEv('HOOK_SELECTED', `Hook valgt: "${hooks[0].text}" (score ${hooks[0].totalScore.toFixed(0)}, source=${hooks[0].source})`, {
      highlightId,
      winner: { text: hooks[0].text, totalScore: hooks[0].totalScore, spes: hooks[0].specificityScore, emos: hooks[0].emotionScore, kurv: hooks[0].curiosityScore, konf: hooks[0].conflictScore, source: hooks[0].source, storyAlignment: hooks[0].storyAlignment },
      alternatives: hooks.slice(1).map(h => ({ text: h.text, score: h.totalScore.toFixed(0) })),
      storyConflict: story.conflict,
      compositeRecommended: story.compositeRecommended,
    });

    // ── STEP 8-9: Build variants with self-review loop ────────────────────────
    wLog('INFO', 'STEP8_VARIANTS', {});

    // Build variant A, B, C (fundamentally different frame + hook + composition)
    const frameA = rankedFrames[0];
    const frameB = rankedFrames[1] ?? rankedFrames[0];
    const frameC = rankedFrames[2] ?? rankedFrames[0];

    const variants: VariantV8[] = [];

    for (const [label, frame, hook] of [
      ['A', frameA, hooks[0]] as const,
      ['B', frameB, hooks[1]] as const,
      ['C', frameC, hooks[2]] as const,
    ]) {
      let attempts = 0;
      let approved = false;
      let finalBuf: Buffer | null = null;
      let lastReview: SelfReviewScore | null = null;

      while (attempts < SELF_REVIEW_MAX_ATTEMPTS && !approved) {
        attempts++;
        const useFrame = attempts <= 3 ? frame : rankedFrames[Math.min(attempts - 1, rankedFrames.length - 1)];
        const useHook  = attempts <= 1 ? hook  : hooks[Math.min(attempts - 1, hooks.length - 1)];

        try {
          const buf = await buildSingleVariant(useFrame, useHook, h.category ?? '', fontPath, label, highlightId);

          const review = await selfReviewThumbnail(buf, useHook, story);
          lastReview = review;

          logEv('SELF_REVIEW', `Variant ${label} forsøk ${attempts}: ${review.verdict} (total=${review.total}) — ${review.reason}`, {
            highlightId, variantLabel: label, attempt: attempts,
            scores: { story: review.story, emotion: review.emotion, curiosity: review.curiosity, composition: review.composition, lighting: review.lighting, professional: review.professional, ctr: review.ctr },
            total: review.total, verdict: review.verdict, reason: review.reason,
            hook: useHook.text, frameIndex: useFrame.index,
          });

          if (review.verdict === 'APPROVED' || (attempts >= SELF_REVIEW_MAX_ATTEMPTS && review.verdict !== 'REJECT')) {
            finalBuf = buf;
            approved = true;
          } else if (review.verdict === 'REJECT') {
            wLog('WARN', `VARIANT_${label}_REJECTED`, { attempts, score: review.total, reason: review.reason });
            break; // Fundamental problem — skip remaining attempts
          }
        } catch (e: any) {
          wLog('WARN', `VARIANT_${label}_BUILD_FAIL`, { attempt: attempts, err: e.message?.slice(0, 100) });
        }
      }

      if (!finalBuf) {
        wLog('WARN', `VARIANT_${label}_NO_APPROVED`, { attempts });
        // Accept best attempt even without approval (better than nothing)
        try { finalBuf = await buildSingleVariant(frame, hook, h.category ?? '', fontPath, label, highlightId); } catch {}
      }

      if (finalBuf) {
        variants.push({ buf: finalBuf, label, frame, hook, cropMode: 'v8_attention', textPos: 'auto', selfReview: lastReview, attempts });
      }
    }

    // Build composite variant if story recommends it
    if (story.compositeRecommended && rankedFrames.length >= 2) {
      try {
        const compositeBuf = await buildCompositeVariant(rankedFrames.slice(0, 5), hooks, h.category ?? '', fontPath, highlightId);
        const compositeReview = await selfReviewThumbnail(compositeBuf, hooks[0], story);
        logEv('SELF_REVIEW', `Composite variant: ${compositeReview.verdict} (total=${compositeReview.total})`, {
          highlightId, variantLabel: 'COMPOSITE', total: compositeReview.total, verdict: compositeReview.verdict, reason: compositeReview.reason,
        });
        variants.push({ buf: compositeBuf, label: 'COMPOSITE', frame: rankedFrames[0], hook: hooks[0], cropMode: 'composite', textPos: 'center-bottom', selfReview: compositeReview, attempts: 1 });
      } catch (e: any) {
        wLog('WARN', 'COMPOSITE_BUILD_FAIL', { err: e.message?.slice(0, 100) });
      }
    }

    if (variants.length === 0) {
      logEv('THUMBNAIL_V8_NO_QUALITY', 'Ingen thumbnail av tilstrekkelig kvalitet kunne genereres.', { highlightId, story: story.conflict, storyScore: story.storyScore });
      throw new Error('Ingen thumbnail av tilstrekkelig kvalitet kunne genereres. Logg: THUMBNAIL_V8_NO_QUALITY');
    }

    // ── Pick best variant ─────────────────────────────────────────────────────
    const best = variants.reduce((a, b) => {
      const sa = a.selfReview?.total ?? 60;
      const sb = b.selfReview?.total ?? 60;
      return sa >= sb ? a : b;
    });

    const allScores = Object.fromEntries(variants.map(v => [v.label, v.selfReview?.total ?? 0]));

    logEv('THUMBNAIL_VARIANT_CHOSEN', `Variant ${best.label} valgt — self-review ${best.selfReview?.total ?? 'N/A'} — "${best.hook.text}"`, {
      highlightId, chosenVariant: best.label,
      selfReviewScore: best.selfReview?.total,
      selfReviewVerdikt: best.selfReview?.verdict,
      selfReviewReason: best.selfReview?.reason,
      hook: best.hook.text, hookSource: best.hook.source,
      allScores, frameIndex: best.frame.index,
      storyConflict: story.conflict, storyScore: story.storyScore,
    });

    wLog('INFO', 'BEST_VARIANT', { label: best.label, score: best.selfReview?.total, hook: best.hook.text });

    // Debug dumps
    try { fs.writeFileSync('/tmp/v8-last-thumbnail.png', best.buf); } catch {}
    for (const v of variants) {
      try { fs.writeFileSync(`/tmp/v8-variant-${v.label}.png`, v.buf); } catch {}
    }

    // ── Upload ────────────────────────────────────────────────────────────────
    const vodId       = h.vod_id ?? 'unknown';
    const storagePath = `content-factory/thumbnails/${vodId}/${highlightId}_v8_yt.png`;
    const url         = await uploadBuffer(db, best.buf, storagePath);
    if (!url) throw new Error('Upload til Supabase storage feilet');

    // Alt uploads
    Promise.all(
      variants.filter(v => v.label !== best.label)
        .map(v => uploadBuffer(db, v.buf, `content-factory/thumbnails/${vodId}/${highlightId}_v8_${v.label}.png`))
    ).catch(() => {});

    // ── DB update ─────────────────────────────────────────────────────────────
    const ctrReason = [
      `V8 · variant:${best.label} · self-review:${best.selfReview?.total ?? 'N/A'}`,
      `hook:"${best.hook.text}" · hookSrc:${best.hook.source}`,
      `story:"${story.conflict.slice(0, 60)}"`,
      `frame:${best.frame.index} · emos:${best.frame.emotionLabel} · face:${best.frame.faceDetected}`,
      `allScores:${JSON.stringify(allScores)}`,
    ].join(' · ');

    const { error: dbErr } = await db.from('content_highlights').update({
      thumbnail_status:        'DONE',
      thumbnail_youtube_url:   url,
      thumbnail_headline:      best.hook.text,
      thumbnail_error:         null,
      thumbnail_ctr_reason:    ctrReason.slice(0, 500),
      thumbnail_reject_count:  0,
      thumbnail_generated_at:  new Date().toISOString(),
    }).eq('id', highlightId);

    if (dbErr) throw new Error(`DB update feilet: ${dbErr.message}`);

    logEv('THUMBNAIL_V8_RENDER_COMPLETE', `Thumbnail V8 ferdig — "${best.hook.text}" · review:${best.selfReview?.total}`, {
      highlightId, url, chosenVariant: best.label,
      selfReviewScore: best.selfReview?.total,
      selfReviewScores: best.selfReview,
      hook: best.hook.text, hookSource: best.hook.source,
      storyConflict: story.conflict, storyScore: story.storyScore,
      frameIndex: best.frame.index, emotionLabel: best.frame.emotionLabel,
      faceDetected: best.frame.faceDetected, uiClutter: best.frame.uiClutter,
      totalVariants: variants.length, outputBytes: best.buf.length, source: source ?? 'unknown',
    });
    // Phase 3: double-write to Creator State (logEv above unchanged)
    onContentPipelineUpdate({ status: 'THUMBNAIL_DONE', highlightId });

    wLog('INFO', 'V8_DONE', { highlightId, url: url.slice(-60), score: best.selfReview?.total, hook: best.hook.text });

  } catch (e: any) {
    const msg = e.message?.slice(0, 200) ?? 'Ukjent feil';
    wLog('ERROR', 'V8_FAILED', { highlightId, err: msg });

    logEv('THUMBNAIL_V8_FAILED', `Thumbnail V8 feilet: ${msg}`, { highlightId, source: source ?? 'unknown', reason: msg });
    // Phase 3: double-write to Creator State (logEv above unchanged)
    onContentPipelineUpdate({ status: 'THUMBNAIL_FAILED', highlightId });

    try {
      await db?.from('content_highlights').update({ thumbnail_status: 'FAILED', thumbnail_error: `V8: ${msg}` }).eq('id', highlightId);
    } catch {}

    throw e;
  } finally {
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
    try {
      const frameDir = path.join(THUMB_BASE, highlightId, 'v8_frames');
      if (fs.existsSync(frameDir)) fs.rmSync(frameDir, { recursive: true, force: true });
    } catch {}
  }
}
