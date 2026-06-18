/**
 * Thumbnail Builder V7.5 — CTR-optimized pipeline
 *
 * Pipeline:
 *  1. Font test
 *  2. Transcript fetch
 *  3. Download video
 *  4. FRAME_SCORER V2: 18 Sharp candidates → top 6 → Gemini vision (face/emotion/action/ctr)
 *  5. HOOK ENGINE V2: Gemini 10 candidates with per-hook scores (spes/emos/kurv/konf)
 *  6. Build 3 variants (frame × hook × crop × text position)
 *  7. AI CTR SCORING: all 3 variants → Gemini scores → pick best
 *  8. Upload winner + alternates async
 *  9. DB update
 *
 * Events logged (with WHY, not just WHAT):
 *   THUMBNAIL_FRAME_SELECTED, THUMBNAIL_HOOK_SELECTED,
 *   THUMBNAIL_CROP_SELECTED, THUMBNAIL_VARIANT_GENERATED,
 *   THUMBNAIL_CTR_SCORE, THUMBNAIL_VARIANT_CHOSEN, THUMBNAIL_V75_RENDER_COMPLETE
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

const YT_W         = 1280;
const YT_H         = 720;
const GEMINI_URL   = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

const TEXT_MARGIN  = 60;
const HEADLINE_PT  = 108;
const HEADLINE_DPI = 72;
const SHADOW_OFFSET = 5;
const TEXT_ZONE_W  = 700;

// ── Caches ────────────────────────────────────────────────────────────────────

let _fontTestCache: { passed: boolean; fontPath: string | null } | null = null;

interface HookWithScores {
  text: string;
  specificityScore: number;
  emotionScore: number;
  curiosityScore: number;
  conflictScore: number;
  totalScore: number;
  source: 'gemini' | 'fallback';
}

const _hookCache = new Map<string, HookWithScores[]>(); // highlightId → top-3

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

// ── Video ─────────────────────────────────────────────────────────────────────

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

// ── FRAME_SCORER V2 ───────────────────────────────────────────────────────────
//
// Step A: extract 18 frames → Sharp pixel scoring (brightness/contrast/edges/sat)
// Step B: top 6 → Gemini vision (face_detected, face_pct, emotion, action, ctr_score)
// Step C: final_score = 0.30 * sharp_score + 0.70 * gemini_ctr_score
//         + emotion_bonus (shock/anger/surprise = +10, laugh = +8)
//         + face_size_bonus (face_pct > 30 = +5)

interface SharpFrameScore {
  buf: Buffer;
  pct: number;
  sharpScore: number;
  brightness: number;
  contrast: number;
  edgeDensity: number;
  saturation: number;
}

interface GeminiFrameScore {
  faceDetected: boolean;
  facePct: number;
  emotion: string;
  hasAction: boolean;
  ctrScore: number;
}

export interface ScoredFrame {
  buf: Buffer;
  pct: number;
  finalScore: number;
  sharpScore: number;
  geminiCtrScore: number | null;
  faceDetected: boolean;
  facePct: number;
  emotion: string;
  hasAction: boolean;
  scoringReason: string;
}

async function sharpScoreFrame(buf: Buffer): Promise<Omit<SharpFrameScore, 'buf' | 'pct'>> {
  const sharp = require('sharp');

  const { data: grey } = await sharp(buf).resize(8, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
  const greyArr = Array.from(grey as Buffer) as number[];
  const brightness = greyArr.reduce((a, b) => a + b, 0) / greyArr.length;
  const contrast   = Math.sqrt(greyArr.reduce((a, b) => a + (b - brightness) ** 2, 0) / greyArr.length);

  let edgeDensity = 0;
  try {
    const { data: edges } = await sharp(buf)
      .resize(64, 36).greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .raw().toBuffer({ resolveWithObject: true });
    const edgeArr = Array.from(edges as Buffer) as number[];
    edgeDensity = edgeArr.reduce((a, b) => a + Math.abs(b), 0) / edgeArr.length;
  } catch {}

  let saturation = 0;
  try {
    const { data: rgb } = await sharp(buf).resize(16, 9).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgbArr = Array.from(rgb as Buffer) as number[];
    let sat = 0;
    for (let i = 0; i < rgbArr.length; i += 3) {
      const mx = Math.max(rgbArr[i], rgbArr[i+1], rgbArr[i+2]);
      const mn = Math.min(rgbArr[i], rgbArr[i+1], rgbArr[i+2]);
      sat += mx > 0 ? (mx - mn) / mx : 0;
    }
    saturation = sat / (rgbArr.length / 3);
  } catch {}

  const b = Math.min(100, brightness / 2.55);
  const c = Math.min(100, contrast * 1.5);
  const e = Math.min(100, edgeDensity * 2.5);
  const s = Math.min(100, saturation * 120);
  const exposurePenalty = (b < 15 || b > 95) ? 20 : 0;

  const sharpScore = Math.max(0, b * 0.15 + c * 0.20 + e * 0.40 + s * 0.25 - exposurePenalty);
  return { sharpScore, brightness, contrast, edgeDensity, saturation };
}

async function reScoreFramesWithGemini(frames: SharpFrameScore[]): Promise<GeminiFrameScore[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || frames.length === 0) return frames.map(() => ({ faceDetected: false, facePct: 0, emotion: 'ukjent', hasAction: false, ctrScore: 50 }));

  const sharp = require('sharp');

  try {
    // Resize each frame to 640×360 JPEG for cost efficiency (vision quality preserved)
    const thumbs = await Promise.all(
      frames.map(f => sharp(f.buf).resize(640, 360).jpeg({ quality: 80 }).toBuffer())
    );

    const N = frames.length;
    const frameTags = Array.from({ length: N }, (_, i) => `F${i + 1}`).join(', ');

    const parts: any[] = [
      {
        text: [
          `Du analyserer ${N} kandidat-frames fra et gaming-klipp for YouTube thumbnail-valg.`,
          '',
          `For hvert bilde (${frameTags}), svar med NØYAKTIG én linje i dette formatet:`,
          'F1: ansikt=ja pst=45 emosjon=sjokk handling=ja ctr=88',
          '',
          'Verdier:',
          '- ansikt: ja/nei (er det et synlig ansikt i bildet?)',
          '- pst: 0-100 (prosent av bildet ansiktet dekker; 0 hvis ingen ansikt)',
          '- emosjon: ingen/nøytral/smil/latter/sjokk/sinne/frykt/overraskelse',
          '- handling: ja/nei (skjer det noe aktivt — bevegelse, konflikt, dramatisk øyeblikk?)',
          '- ctr: 0-100 (CTR-potensial som YouTube gaming thumbnail)',
          '',
          'Faktorer for høy CTR: ansikt med sterk emosjon, action, bevegelse, konflikt, kontrast.',
          'Lav CTR: folk som bare sitter stille, mørke frames, generisk bakgrunn.',
          '',
          'Svar KUN med score-linjene. Ingen forklaring.',
        ].join('\n'),
      },
      ...thumbs.map((t) => ({
        inline_data: { mime_type: 'image/jpeg', data: t.toString('base64') },
      })),
    ];

    const res = await fetch(
      `${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
        }),
      }
    );

    if (res.status === 429) { wLog('WARN', 'GEMINI_FRAME_RATE_LIMITED', {}); throw new Error('429'); }
    if (!res.ok) throw new Error(`Gemini ${res.status}`);

    const json = await res.json() as any;
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => /^F\d+:/.test(l));

    const results: GeminiFrameScore[] = frames.map(() => ({ faceDetected: false, facePct: 0, emotion: 'ingen', hasAction: false, ctrScore: 50 }));

    for (const line of lines) {
      const idxMatch = line.match(/^F(\d+):/);
      if (!idxMatch) continue;
      const idx = parseInt(idxMatch[1], 10) - 1;
      if (idx < 0 || idx >= N) continue;

      const get = (key: string): string => {
        const m = line.match(new RegExp(`${key}=([^\\s]+)`));
        return m ? m[1] : '';
      };

      results[idx] = {
        faceDetected: get('ansikt') === 'ja',
        facePct:      parseInt(get('pst'), 10) || 0,
        emotion:      get('emosjon') || 'ingen',
        hasAction:    get('handling') === 'ja',
        ctrScore:     parseInt(get('ctr'), 10) || 50,
      };
    }

    wLog('INFO', 'GEMINI_FRAME_SCORES', { scores: results.map((r, i) => ({ frame: `F${i+1}`, ctr: r.ctrScore, face: r.faceDetected, emotion: r.emotion })) });
    return results;

  } catch (e: any) {
    wLog('WARN', 'GEMINI_FRAME_SCORE_FAIL', { err: e.message?.slice(0, 100) });
    return frames.map(() => ({ faceDetected: false, facePct: 0, emotion: 'ukjent', hasAction: false, ctrScore: 50 }));
  }
}

async function extractScoredFrames(videoPath: string, highlightId: string, durationSec: number): Promise<ScoredFrame[]> {
  const frameDir = path.join(THUMB_BASE, highlightId, 'v75_frames');
  sikreDir(frameDir);

  // 18 candidate positions — denser in 20–80% where action typically peaks
  const percentages = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const MIN_BRIGHTNESS = 25;

  const extracted: Array<{ buf: Buffer; pct: number }> = [];

  // Extract in batches of 6 to avoid overloading ffmpeg
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

  if (extracted.length === 0) throw new Error('FRAME_SCORER: ffmpeg feilet, ingen frames hentet');

  // Step A: Sharp scoring
  const sharpScored: SharpFrameScore[] = await Promise.all(
    extracted.map(async ({ buf, pct }) => {
      const scores = await sharpScoreFrame(buf);
      return { buf, pct, ...scores };
    })
  );

  // Filter very dark frames, sort by Sharp score, take top 6 for Gemini
  const usable = sharpScored.filter(f => f.brightness >= MIN_BRIGHTNESS);
  const sharpTop6 = (usable.length > 0 ? usable : sharpScored)
    .sort((a, b) => b.sharpScore - a.sharpScore)
    .slice(0, 6);

  wLog('INFO', 'SHARP_TOP6', { pcts: sharpTop6.map(f => f.pct), scores: sharpTop6.map(f => f.sharpScore.toFixed(1)) });

  // Step B: Gemini vision scoring for top 6
  const geminiScores = await reScoreFramesWithGemini(sharpTop6);

  // Step C: Combine scores
  const EMOTION_BONUS: Record<string, number> = {
    sjokk: 10, sinne: 10, overraskelse: 10, frykt: 8, latter: 8, smil: 4,
  };

  const finalScored: ScoredFrame[] = sharpTop6.map((sf, i) => {
    const g = geminiScores[i];
    const emotionBonus = EMOTION_BONUS[g.emotion] ?? 0;
    const faceSizeBonus = g.facePct >= 30 ? 5 : g.facePct >= 15 ? 2 : 0;
    const actionBonus = g.hasAction ? 5 : 0;

    const finalScore = Math.min(100,
      sf.sharpScore * 0.30 +
      g.ctrScore    * 0.70 +
      emotionBonus  +
      faceSizeBonus +
      actionBonus
    );

    const reasons: string[] = [];
    if (g.faceDetected) reasons.push(`ansikt(${g.facePct}%)`);
    if (g.emotion !== 'ingen') reasons.push(`emosjon:${g.emotion}`);
    if (g.hasAction) reasons.push('handling');
    if (emotionBonus > 0) reasons.push(`emosjonskraft:+${emotionBonus}`);
    const scoringReason = reasons.length > 0 ? reasons.join(', ') : 'høy visuell kompleksitet';

    return {
      buf: sf.buf,
      pct: sf.pct,
      finalScore,
      sharpScore: sf.sharpScore,
      geminiCtrScore: g.ctrScore,
      faceDetected: g.faceDetected,
      facePct: g.facePct,
      emotion: g.emotion,
      hasAction: g.hasAction,
      scoringReason,
    };
  });

  finalScored.sort((a, b) => b.finalScore - a.finalScore);

  wLog('INFO', 'FRAME_SCORER_DONE', {
    total: extracted.length,
    geminiScored: sharpTop6.length,
    winner: { pct: finalScored[0].pct, finalScore: finalScored[0].finalScore.toFixed(1), emotion: finalScored[0].emotion, face: finalScored[0].faceDetected },
  });

  return finalScored;
}

// ── HOOK ENGINE V2 ────────────────────────────────────────────────────────────
//
// ONE Gemini call → 10 hooks with per-hook scores (spes/emos/kurv/konf).
// Forbidden generics are filtered UNLESS transcript explicitly contains the
// keyword that makes them specific (e.g. "gikk galt" in transcript → allows "ALT GIKK GALT!").
// Returns top-3 HookWithScores sorted by totalScore.

const FORBIDDEN_GENERICS: Record<string, string[]> = {
  'DET GIKK GALT': ['gikk galt', 'feilet', 'ødela', 'krasjet', 'mistet'],
  'SYKT':          ['sykt', 'vanvittig', 'utrolig'],
  'WOW':           [],   // always forbidden — pure filler
  'LOL':           [],   // always forbidden
  'EPISK':         ['episk', 'episke'],
  'UTROLIG':       ['utrolig', 'ufattelig'],
};

function isForbiddenHook(hook: string, transcript: string | null): boolean {
  const base = hook.replace(/[!?]/g, '').trim();
  for (const [forbidden, exceptions] of Object.entries(FORBIDDEN_GENERICS)) {
    if (!base.startsWith(forbidden) && base !== forbidden) continue;
    if (exceptions.length === 0) return true; // always forbidden
    const t = (transcript ?? '').toLowerCase();
    // Allow if transcript explicitly contains one of the exception keywords
    if (exceptions.some(e => t.includes(e))) return false;
    return true;
  }
  return false;
}

function parsePipedHookLine(line: string): HookWithScores | null {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 5) return null;

  const text = parts[0].toUpperCase().replace(/[^A-ZÆØÅ0-9!? ]/g, '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 2 || words > 4 || text.length < 3) return null;

  const parseScore = (s: string): number => {
    const m = s.match(/\d+/);
    return m ? Math.max(0, Math.min(100, parseInt(m[0], 10))) : 50;
  };

  const specificityScore = parseScore(parts[1]);
  const emotionScore     = parseScore(parts[2]);
  const curiosityScore   = parseScore(parts[3]);
  const conflictScore    = parseScore(parts[4]);

  const totalScore = specificityScore * 0.30 + emotionScore * 0.25 + curiosityScore * 0.25 + conflictScore * 0.20;

  return { text, specificityScore, emotionScore, curiosityScore, conflictScore, totalScore, source: 'gemini' };
}

function makeFallbackHook(title: string, category: string, transcript: string | null): HookWithScores {
  const t = `${title} ${transcript ?? ''}`.toLowerCase();
  let text = 'SE HVA SOM SKJEDDE!';

  if      (t.includes('løy') || t.includes('løgn'))              text = 'HUN LØY!';
  else if (t.includes('scam') || t.includes('lurt') || t.includes('svindel')) text = 'VI BLE LURT!';
  else if (t.includes('politi') || t.includes('arrestert'))      text = 'POLITIET KOM!';
  else if (t.includes('vant') || t.includes('vinner') || t.includes('seier')) text = 'VI VANT!';
  else if (t.includes('angrer') || t.includes('beklager'))       text = 'JEG ANGRER!';
  else {
    const categoryMap: Record<string, string> = {
      RAGE: 'JEG ANGRER!', CLUTCH: 'I SISTE SEKUND!', FUNNY: 'INGEN FORVENTET DETTE!',
      RP_MOMENT: 'POLITIET KOM!', FAIL: 'JEG ANGRER!', TACTICAL: 'PERFEKT PLAN!',
    };
    text = categoryMap[category] ?? 'SE HVA SOM SKJEDDE!';
  }

  return { text, specificityScore: 60, emotionScore: 60, curiosityScore: 55, conflictScore: 55, totalScore: 57.5, source: 'fallback' };
}

async function getHooksV2(
  highlightId: string,
  frameBuf: Buffer,
  title: string,
  category: string,
  transcript: string | null,
): Promise<HookWithScores[]> {
  const cached = _hookCache.get(highlightId);
  if (cached) {
    wLog('INFO', 'HOOKS_CACHED', { highlightId, hooks: cached.map(h => h.text) });
    return cached;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const candidates: HookWithScores[] = [];

  if (geminiKey) {
    try {
      const transcriptHint = transcript
        ? `Transkripsjon: "${transcript.slice(0, 400)}"`
        : '(ingen transkripsjon)';

      const prompt = [
        'Du er YouTube CTR-ekspert for gaming-innhold. Oppgave: generer 10 norske hooks.',
        '',
        `Tittel: ${title}`,
        `Kategori: ${category}`,
        transcriptHint,
        '',
        'Instruksjoner:',
        '• Hvert hook: 2-4 ORD, VERSALER, norsk, avslutt med ! eller ?!',
        '• Hook MÅ referere noe spesifikt fra klippet — IKKE generiske fraser',
        '• FORBUDT: DET GIKK GALT / SYKT / WOW / LOL / EPISK / UTROLIG (med mindre transcript sier det eksplisitt)',
        '• Finn: løgn, svindel, overraskelse, konflikt, feil, seier, sjokk fra transkriptet',
        '',
        'Score hvert hook på fire dimensjoner (0-100 hver):',
        '  spes = spesifisitet (er det spesifikt til DETTE klippet?)',
        '  emos = emosjonskraft (skaper det følelse?)',
        '  kurv = nysgjerrighet (vil folk klikke?)',
        '  konf = konflikt/drama (antyder det noe dramatisk?)',
        '',
        'Svar i NØYAKTIG dette formatet (én linje per hook, ingen annen tekst):',
        'HOOK TEKST HER! | spes=85 | emos=90 | kurv=80 | konf=75',
        '',
        'Eksempler:',
        'HUN LØY! | spes=90 | emos=85 | kurv=80 | konf=90',
        'JEG BLE LURT! | spes=80 | emos=75 | kurv=85 | konf=80',
        'HVEM HAR RETT?! | spes=75 | emos=70 | kurv=90 | konf=85',
      ].join('\n');

      // Resize frame to 640×360 for cost efficiency
      const sharp = require('sharp');
      const thumbBuf = await sharp(frameBuf).resize(640, 360).jpeg({ quality: 80 }).toBuffer().catch(() => frameBuf);

      const res = await fetch(
        `${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/jpeg', data: thumbBuf.toString('base64') } },
              ],
            }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
          }),
        }
      );

      if (res.status === 429) { wLog('WARN', 'HOOKS_RATE_LIMITED', { highlightId }); }
      else if (res.ok) {
        const json = await res.json() as any;
        const rawText = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

        for (const line of rawText.split('\n')) {
          const parsed = parsePipedHookLine(line.trim());
          if (!parsed) continue;
          if (isForbiddenHook(parsed.text, transcript)) {
            wLog('INFO', 'HOOK_FORBIDDEN_FILTERED', { hook: parsed.text });
            continue;
          }
          candidates.push(parsed);
        }

        wLog('INFO', 'HOOKS_GEMINI_PARSED', { count: candidates.length, examples: candidates.slice(0, 3).map(h => `${h.text}(${h.totalScore.toFixed(0)})`) });
      }
    } catch (e: any) {
      wLog('WARN', 'HOOKS_GEMINI_FAIL', { err: e.message?.slice(0, 100) });
    }
  }

  // Always add deterministic fallbacks (scored manually)
  candidates.push(makeFallbackHook(title, category, transcript));

  // Deduplicate by first word, sort by totalScore
  const seen = new Set<string>();
  const sorted = candidates
    .sort((a, b) => b.totalScore - a.totalScore)
    .filter(h => {
      const key = h.text.split(' ')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Ensure exactly 3
  const top3 = sorted.slice(0, 3);
  while (top3.length < 3) top3.push(makeFallbackHook(title, category, transcript));

  _hookCache.set(highlightId, top3);

  wLog('INFO', 'HOOKS_FINAL', {
    highlightId,
    top3: top3.map(h => ({ text: h.text, score: h.totalScore.toFixed(1), spes: h.specificityScore, emos: h.emotionScore, source: h.source })),
  });

  return top3;
}

// ── CROP ENGINE ───────────────────────────────────────────────────────────────
//
// attention: Sharp built-in face/entropy gravity (best general-purpose)
// face-zone: crops upper-center 80%×80% then re-resizes (face zoom approx)
// entropy:   Sharp entropy gravity (picks most visually complex region)

type CropMode = 'attention' | 'face-zone' | 'entropy';

async function cropFrame(buf: Buffer, mode: CropMode): Promise<Buffer> {
  const sharp = require('sharp');

  if (mode === 'face-zone') {
    const base = await sharp(buf).resize(YT_W, YT_H, { fit: 'cover', position: 'attention' }).toBuffer();
    const cropW = Math.round(YT_W * 0.80);
    const cropH = Math.round(YT_H * 0.80);
    const cropLeft = Math.round((YT_W - cropW) / 2);
    return sharp(base)
      .extract({ left: cropLeft, top: 0, width: cropW, height: cropH })
      .resize(YT_W, YT_H, { fit: 'fill' })
      .toBuffer();
  }

  return sharp(buf)
    .resize(YT_W, YT_H, { fit: 'cover', position: mode === 'entropy' ? 'entropy' : 'attention' })
    .toBuffer();
}

// ── COLOR ENGINE ──────────────────────────────────────────────────────────────
//
// 3-pass enhancement: base boost → adaptive sharpen → vibrance pass.
// Not a cartoon or HDR effect — just "better than raw frame".

async function gradeColors(buf: Buffer): Promise<Buffer> {
  const sharp = require('sharp');
  return sharp(buf)
    .modulate({ brightness: 1.10, saturation: 1.65 })
    .linear(1.12, -10)
    .sharpen({ sigma: 1.3, m1: 0.9, m2: 4.5, x1: 2, y2: 14, y3: 18 })
    .modulate({ saturation: 1.12 })
    .toBuffer();
}

// ── FOCUS MASK ────────────────────────────────────────────────────────────────

type TextPosition = 'bottom-left' | 'top-left' | 'bottom-center';

function buildGradientSvg(textPosition: TextPosition): string {
  if (textPosition === 'top-left') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0.85"/>
      <stop offset="40%"  stop-color="black" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.62"/>
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
      <stop offset="100%" stop-color="black" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gb)"/>
</svg>`;
  }

  // bottom-left (default)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.90"/>
      <stop offset="58%"  stop-color="black" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="42%"  stop-color="black" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gl)"/>
  <rect x="0" y="${Math.round(YT_H * 0.30)}" width="${YT_W}" height="${Math.round(YT_H * 0.70)}" fill="url(#gb)"/>
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

interface VariantOpts {
  highlightId: string;
  variantLabel: 'A' | 'B' | 'C';
  rawFrame: Buffer;
  hook: HookWithScores;
  cropMode: CropMode;
  textPosition: TextPosition;
  category: string;
  fontPath: string | null;
}

async function buildVariant(opts: VariantOpts): Promise<Buffer> {
  const sharp = require('sharp');
  const { highlightId, variantLabel, rawFrame, hook, cropMode, textPosition, category, fontPath } = opts;
  const primary = accentColor(category);

  // 1. Crop
  const cropped = await cropFrame(rawFrame, cropMode);

  logSystemEvent({
    source: 'thumbnail_worker',
    event_type: 'THUMBNAIL_CROP_SELECTED',
    title: `Crop variant ${variantLabel}: mode=${cropMode}`,
    severity: 'info',
    metadata: {
      highlightId, variantLabel, cropMode, textPosition,
      reason: cropMode === 'attention' ? 'Sharp attention gravity (best for subject focus)' :
              cropMode === 'face-zone' ? 'Upper-center 80% crop (face zoom approximation)' :
              'Entropy gravity (most visually complex region)',
    },
  });

  // 2. Color grade
  const graded = await gradeColors(cropped);

  // 3. Gradient overlay
  const gradientSvg = buildGradientSvg(textPosition);

  // 4. Text
  const [shadowBuf, mainBuf] = await Promise.all([
    renderPangoText(hook.text, fontPath, '#000000', TEXT_ZONE_W, HEADLINE_PT),
    renderPangoText(hook.text, fontPath, primary,   TEXT_ZONE_W, HEADLINE_PT),
  ]);
  const { width: tw = 600, height: th = 120 } = await sharp(mainBuf).metadata();

  // 5. Text position
  let textX: number, textY: number;
  if (textPosition === 'bottom-left') {
    textX = TEXT_MARGIN; textY = Math.max(20, YT_H - 82 - th);
  } else if (textPosition === 'top-left') {
    textX = TEXT_MARGIN; textY = TEXT_MARGIN;
  } else {
    textX = Math.max(0, Math.round((YT_W - tw) / 2));
    textY = Math.max(20, YT_H - 92 - th);
  }

  // 6. Accent stripe
  const stripeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <rect x="0" y="${YT_H - 8}" width="${YT_W}" height="8" fill="${primary}" opacity="0.93"/>
</svg>`;

  const out = await sharp(graded)
    .composite([
      { input: Buffer.from(gradientSvg),  top: 0,                        left: 0 },
      { input: shadowBuf,                 top: textY + SHADOW_OFFSET,     left: textX + SHADOW_OFFSET },
      { input: mainBuf,                   top: textY,                     left: textX },
      { input: Buffer.from(stripeSvg),    top: 0,                        left: 0 },
    ])
    .png({ compressionLevel: 7 })
    .toBuffer();

  logSystemEvent({
    source: 'thumbnail_worker',
    event_type: 'THUMBNAIL_VARIANT_GENERATED',
    title: `Variant ${variantLabel} generert: "${hook.text}" · ${cropMode} · ${textPosition}`,
    severity: 'info',
    metadata: {
      highlightId, variantLabel,
      hook: hook.text,
      hookScore: hook.totalScore,
      hookScores: { spes: hook.specificityScore, emos: hook.emotionScore, kurv: hook.curiosityScore, konf: hook.conflictScore },
      hookSource: hook.source,
      cropMode, textPosition,
      outputBytes: out.length,
    },
  });

  return out;
}

// ── AI CTR SCORING ────────────────────────────────────────────────────────────
//
// Single Gemini call with all 3 variants as images.
// Returns [scoreA, scoreB, scoreC] (0-100).

async function scoreCtrVariants(variants: Buffer[], hooks: HookWithScores[]): Promise<number[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || variants.length === 0) return variants.map(() => 60);

  try {
    const sharp = require('sharp');
    const thumbs = await Promise.all(
      variants.map(v => sharp(v).resize(320, 180).jpeg({ quality: 75 }).toBuffer())
    );

    const hookDescriptions = hooks.map((h, i) =>
      `Variant ${String.fromCharCode(65 + i)}: hook="${h.text}" (spes=${h.specificityScore} emos=${h.emotionScore} kurv=${h.curiosityScore} konf=${h.conflictScore})`
    ).join('\n');

    const parts: any[] = [
      {
        text: [
          `Du er YouTube CTR-ekspert. Score disse ${variants.length} thumbnail-varianter (0-100 totalt).`,
          '',
          'Kriterier per variant:',
          '• Lesbarhet (0-20): er teksten lesbar på mobil i 3 sekunder?',
          '• Emosjon og ansikt (0-20): viser det sterk emosjon?',
          '• Kontrast og pop (0-20): skiller den seg ut i YouTube-feed?',
          '• Nysgjerrighet (0-20): vil en tilfeldig seer klikke?',
          '• Mobilvisning (0-20): fungerer den i lite format?',
          '',
          hookDescriptions,
          '',
          'Svar KUN med tallene — én per linje (ingen tekst, ingen forklaring):',
          `${variants.length} tall totalt, ett per variant.`,
        ].join('\n'),
      },
      ...thumbs.map(t => ({ inline_data: { mime_type: 'image/jpeg', data: t.toString('base64') } })),
    ];

    const res = await fetch(
      `${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 30 },
        }),
      }
    );

    if (!res.ok) return variants.map(() => 60);

    const json = await res.json() as any;
    const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const scores = text.split('\n')
      .map((l: string) => parseInt(l.trim(), 10))
      .filter((n: number) => !isNaN(n) && n >= 0 && n <= 100);

    while (scores.length < variants.length) scores.push(60);
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
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,clip_url,vertical_clip_url,start_time,end_time')
      .eq('id', highlightId).single();

    if (!h) throw new Error('Highlight ikke funnet i DB');
    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url eller vertical_clip_url');

    wLog('INFO', 'LOADED', { title: h.title, category: h.category, videoUrl: videoUrl.slice(0, 80) });

    await db.from('content_highlights').update({
      thumbnail_status:     'GENERATING',
      thumbnail_started_at: new Date().toISOString(),
      thumbnail_error:      null,
    }).eq('id', highlightId);

    // ── 2. Font ───────────────────────────────────────────────────────────────
    const rawFontPath = await prepareFont();
    const { passed: fontOk, fontPath } = await runFontTest(rawFontPath);
    if (!fontOk) throw new Error('Font test feilet — tekst kan ikke garanteres lesbar');
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
      ? (transcriptRows as any[]).map((s: any) => s.text).join(' ').slice(0, 600)
      : null;

    wLog('INFO', 'TRANSCRIPT', { chars: transcript?.length ?? 0, preview: transcript?.slice(0, 100) ?? 'ingen' });

    // ── 4. Download video ─────────────────────────────────────────────────────
    if (!await downloadVideo(videoUrl, videoPath)) throw new Error('Video nedlasting feilet');
    const durationSec = await getVideoDuration(videoPath);
    wLog('INFO', 'VIDEO_READY', { bytes: fs.statSync(videoPath).size, durationSec });

    // ── 5. FRAME_SCORER V2 ────────────────────────────────────────────────────
    const scoredFrames = await extractScoredFrames(videoPath, highlightId, durationSec);
    const topFrame = scoredFrames[0];

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_FRAME_SELECTED',
      title: `Frame valgt: pct=${topFrame.pct}% finalScore=${topFrame.finalScore.toFixed(1)} — ${topFrame.scoringReason}`,
      severity: 'info',
      metadata: {
        highlightId,
        framePct:        topFrame.pct,
        finalScore:      topFrame.finalScore,
        sharpScore:      topFrame.sharpScore,
        geminiCtrScore:  topFrame.geminiCtrScore,
        faceDetected:    topFrame.faceDetected,
        facePct:         topFrame.facePct,
        emotion:         topFrame.emotion,
        hasAction:       topFrame.hasAction,
        scoringReason:   topFrame.scoringReason,
        allFrames:       scoredFrames.map(f => ({ pct: f.pct, score: f.finalScore.toFixed(1), face: f.faceDetected, emotion: f.emotion })),
      },
    });

    // ── 6. HOOK ENGINE V2 ─────────────────────────────────────────────────────
    const hooks = await getHooksV2(highlightId, topFrame.buf, h.title ?? '', h.category ?? '', transcript);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_HOOK_SELECTED',
      title: `Hook valgt: "${hooks[0].text}" (score=${hooks[0].totalScore.toFixed(0)}, source=${hooks[0].source})`,
      severity: 'info',
      metadata: {
        highlightId,
        winner:       { text: hooks[0].text, totalScore: hooks[0].totalScore, spes: hooks[0].specificityScore, emos: hooks[0].emotionScore, kurv: hooks[0].curiosityScore, konf: hooks[0].conflictScore, source: hooks[0].source },
        alternatives: hooks.slice(1).map(h => ({ text: h.text, score: h.totalScore.toFixed(0) })),
        hasTranscript: !!transcript,
        transcriptPreview: transcript?.slice(0, 100) ?? null,
        forbiddenFilterActive: true,
      },
    });

    // ── 7. BUILD 3 VARIANTS ───────────────────────────────────────────────────
    //
    // A: best frame  + hook[0] + attention crop  + bottom-left text
    // B: 2nd frame   + hook[1] + face-zone crop  + top-left text
    // C: best frame  + hook[2] + entropy crop    + bottom-center text

    const frameA = scoredFrames[0]?.buf ?? topFrame.buf;
    const frameB = scoredFrames[1]?.buf ?? topFrame.buf;
    const frameC = scoredFrames[0]?.buf ?? topFrame.buf;

    wLog('INFO', 'VARIANTS_BUILD_START', { hooks: hooks.map(h => h.text) });

    const [varA, varB, varC] = await Promise.all([
      buildVariant({ highlightId, variantLabel: 'A', rawFrame: frameA, hook: hooks[0], cropMode: 'attention',  textPosition: 'bottom-left',   category: h.category ?? '', fontPath }),
      buildVariant({ highlightId, variantLabel: 'B', rawFrame: frameB, hook: hooks[1], cropMode: 'face-zone',  textPosition: 'top-left',     category: h.category ?? '', fontPath }),
      buildVariant({ highlightId, variantLabel: 'C', rawFrame: frameC, hook: hooks[2], cropMode: 'entropy',    textPosition: 'bottom-center', category: h.category ?? '', fontPath }),
    ]);

    wLog('INFO', 'VARIANTS_BUILT', { bytesA: varA.length, bytesB: varB.length, bytesC: varC.length });

    // ── 8. AI CTR SCORING ─────────────────────────────────────────────────────
    const [scoreA, scoreB, scoreC] = await scoreCtrVariants([varA, varB, varC], hooks);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_CTR_SCORE',
      title: `CTR scorer: A=${scoreA} B=${scoreB} C=${scoreC}`,
      severity: 'info',
      metadata: {
        highlightId,
        scores: { A: scoreA, B: scoreB, C: scoreC },
        hooks: { A: hooks[0].text, B: hooks[1].text, C: hooks[2].text },
        allAbove80: [scoreA, scoreB, scoreC].filter(s => s >= 80).length,
      },
    });

    const variants = [
      { buf: varA, score: scoreA, label: 'A' as const, hook: hooks[0], cropMode: 'attention',  textPosition: 'bottom-left' },
      { buf: varB, score: scoreB, label: 'B' as const, hook: hooks[1], cropMode: 'face-zone',  textPosition: 'top-left' },
      { buf: varC, score: scoreC, label: 'C' as const, hook: hooks[2], cropMode: 'entropy',    textPosition: 'bottom-center' },
    ];
    const best = variants.reduce((a, b) => a.score >= b.score ? a : b);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'THUMBNAIL_VARIANT_CHOSEN',
      title: `Variant ${best.label} valgt — CTR score: ${best.score}, hook: "${best.hook.text}"`,
      severity: 'info',
      metadata: {
        highlightId,
        chosenVariant:  best.label,
        ctrScore:       best.score,
        hook:           best.hook.text,
        hookScore:      best.hook.totalScore,
        hookSource:     best.hook.source,
        cropMode:       best.cropMode,
        textPosition:   best.textPosition,
        allScores:      { A: scoreA, B: scoreB, C: scoreC },
        winner_reason:  `Høyeste CTR score (${best.score}) av tre varianter`,
      },
    });

    wLog('INFO', 'VARIANT_CHOSEN', { variant: best.label, score: best.score, hook: best.hook.text });

    // Debug: dump all variants to /tmp
    try { fs.writeFileSync('/tmp/v75-last-thumbnail.png', best.buf); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantA.png', varA); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantB.png', varB); } catch {}
    try { fs.writeFileSync('/tmp/v75-variantC.png', varC); } catch {}

    // ── 9. Upload ─────────────────────────────────────────────────────────────
    const vodId        = h.vod_id ?? 'unknown';
    const storagePath  = `content-factory/thumbnails/${vodId}/${highlightId}_v75_yt.png`;
    const thumbnailUrl = await uploadBuffer(db, best.buf, storagePath);
    if (!thumbnailUrl) throw new Error('Upload til Supabase storage feilet');

    // Alt uploads (async, non-blocking)
    Promise.all([
      uploadBuffer(db, varA, `content-factory/thumbnails/${vodId}/${highlightId}_v75_A.png`),
      uploadBuffer(db, varB, `content-factory/thumbnails/${vodId}/${highlightId}_v75_B.png`),
      uploadBuffer(db, varC, `content-factory/thumbnails/${vodId}/${highlightId}_v75_C.png`),
    ]).catch(() => {});

    wLog('INFO', 'UPLOADED', { url: thumbnailUrl.slice(-60) });

    // ── 10. DB update ─────────────────────────────────────────────────────────
    const { error: dbErr } = await db.from('content_highlights').update({
      thumbnail_status:        'DONE',
      thumbnail_youtube_url:   thumbnailUrl,
      thumbnail_headline:      best.hook.text,
      thumbnail_error:         null,
      thumbnail_ctr_reason:    `V7.5 · variant:${best.label} · ctr:${best.score} · crop:${best.cropMode} · hook:${best.hook.text} · hookScore:${best.hook.totalScore.toFixed(0)} · face:${topFrame.faceDetected ? `ja(${topFrame.facePct}%)` : 'nei'} · emosjon:${topFrame.emotion}`,
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
      title: `Thumbnail V7.5 ferdig — "${best.hook.text}" · score:${best.score} · ${best.buf.length} bytes`,
      severity: 'info',
      metadata: {
        highlightId,
        thumbnailUrl,
        chosenVariant:  best.label,
        ctrScore:       best.score,
        hook:           best.hook.text,
        hookScores:     { spes: best.hook.specificityScore, emos: best.hook.emotionScore, kurv: best.hook.curiosityScore, konf: best.hook.conflictScore },
        hookSource:     best.hook.source,
        cropMode:       best.cropMode,
        framePct:       topFrame.pct,
        frameScore:     topFrame.finalScore,
        faceDetected:   topFrame.faceDetected,
        facePct:        topFrame.facePct,
        emotion:        topFrame.emotion,
        outputBytes:    best.buf.length,
        source:         source ?? 'unknown',
      },
    });

    wLog('INFO', 'DONE', { highlightId, url: thumbnailUrl, score: best.score, hook: best.hook.text, face: topFrame.faceDetected, emotion: topFrame.emotion });

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
