/**
 * Thumbnail Builder V7 — Pango Direct Text
 *
 * Text is rendered via Sharp's built-in pango text API (sharp({ text: {...} })).
 * This bypasses librsvg entirely — no SVG @font-face, no url() references,
 * no document base URI issues. Custom font is loaded directly into pango.
 *
 * Pipeline:
 *  1. Font download + text render test ("HELLO ÆØÅ" must pass)
 *  2. Extract best frame from clip (3 candidates, pick brightest)
 *  3. Hook engine: Gemini first, then deterministic category fallback
 *  4. Composite: enhanced frame + gradient (SVG shapes only) + pango shadow + pango headline
 *  5. Upload + DB update
 *
 * Template: IMPACT_DRAMA — left-side headline, dark gradient, accent stripe
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
const TEXT_ZONE_W = 760;   // max text width in pixels
const TEXT_X      = 64;    // text left margin
const HEADLINE_PT = 110;   // pango point size (at dpi=72 → ~110px line height)
const HEADLINE_DPI = 72;   // 1pt = 1px at this DPI
const SHADOW_OFFSET = 4;   // drop shadow offset in px

// Per-process font test cache — avoids re-testing on every thumbnail
let fontTestCache: { passed: boolean; fontPath: string | null } | null = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  console.log(`[ThumbnailV7][${level}] ${event}${data ? ' ' + JSON.stringify(data) : ''}`);
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

const CATEGORY_HOOKS: Record<string, string[]> = {
  RAGE:        ['DET GIKK GALT!', 'JEG ANGRER!', 'ALDRI MER!', 'FULLSTENDIG KAOS!'],
  CLUTCH:      ['UTROLIG REDNING!', 'INGEN TRODDE DET!', 'I SISTE SEKUND!', 'UMULIG REDNING!'],
  FUNNY:       ['INGEN TRODDE DETTE!', 'JEG DØR!', 'DETTE SKJEDDE!', 'DE GADD IKKE!'],
  RP_MOMENT:   ['POLITIET KOM!', 'VI BLE TATT!', 'HUN LØY!', 'DET GIKK GALT!'],
  EDUCATIONAL: ['SLIK GJØR DU DET!', 'HEMMELIG METODE!', 'INGEN VISSTE!'],
  FAIL:        ['DET GIKK GALT!', 'TOTALT FAIL!', 'JEG ANGRER!', 'ALDRI IGJEN!'],
  TACTICAL:    ['PERFEKT PLAN!', 'SLIK VINNER DU!', 'INGEN VISSTE!'],
};

function categoryFallbackHook(category: string, title: string): string {
  const hooks = CATEGORY_HOOKS[category] ?? ['DET GIKK GALT!', 'SE HVA SOM SKJEDDE!', 'INGEN TRODDE DETTE!'];
  const up = title.toUpperCase();
  if (up.includes('POLITI') || up.includes('ARRESTERT') || up.includes('TATT')) return 'POLITIET KOM!';
  if (up.includes('LØY') || up.includes('LØGN')) return 'HUN LØY!';
  if (up.includes('SCAM') || up.includes('SVINDEL') || up.includes('LURT')) return 'VI BLE LURT!';
  if (up.includes('ANGRER') || up.includes('BEKLAGER')) return 'JEG ANGRER!';
  return hooks[0];
}

// ── Font ──────────────────────────────────────────────────────────────────────

async function prepareFont(): Promise<string | null> {
  try {
    if (fs.existsSync(FONT_ANTON_PATH)) return FONT_ANTON_PATH;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const res = await fetch(FONT_ANTON_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { wLog('WARN', 'FONT_DOWNLOAD_FAIL', { status: res.status }); return null; }
    fs.writeFileSync(FONT_ANTON_PATH, Buffer.from(await res.arrayBuffer()));
    wLog('INFO', 'FONT_DOWNLOADED', { path: FONT_ANTON_PATH, size: fs.statSync(FONT_ANTON_PATH).size });
    return FONT_ANTON_PATH;
  } catch (e: any) {
    wLog('WARN', 'FONT_PREP_FAIL', { err: e.message?.slice(0, 100) });
    return null;
  }
}

async function runFontTest(fontPath: string | null): Promise<{ passed: boolean; fontPath: string | null }> {
  if (fontTestCache !== null) return fontTestCache;

  const sharp = require('sharp');
  const TEST_TEXT = 'HELLO ÆØÅ';
  // Each character at 110pt should be at least 40px wide; 9 chars → min 360px
  const MIN_WIDTH = 200;

  async function testWith(fp: string | null): Promise<boolean> {
    try {
      const desc = fp ? `Anton ${HEADLINE_PT}` : `DejaVu Sans Bold ${HEADLINE_PT}`;
      const markup = `<span font_desc="${desc}" foreground="white">${escapeXml(TEST_TEXT)}</span>`;
      const buf = await sharp({
        text: {
          text: markup,
          fontfile: fp ?? undefined,
          font: fp ? 'Anton' : undefined,
          rgba: true,
          width: 1200,
          dpi: HEADLINE_DPI,
        }
      }).png().toBuffer();

      const { width, height } = await sharp(buf).metadata();
      const ok = (width ?? 0) >= MIN_WIDTH && (height ?? 0) >= 40;
      wLog(ok ? 'INFO' : 'WARN', ok ? 'FONT_TEST_PASS' : 'FONT_TEST_NARROW', {
        font: fp ? 'Anton' : 'system',
        width, height, minWidth: MIN_WIDTH,
      });
      if (ok) {
        try { fs.writeFileSync('/tmp/v7-font-test.png', buf); } catch {}
      }
      return ok;
    } catch (e: any) {
      wLog('WARN', 'FONT_TEST_ERROR', { font: fp ? 'Anton' : 'system', err: e.message?.slice(0, 80) });
      return false;
    }
  }

  // Try Anton first, then system font
  if (fontPath && await testWith(fontPath)) {
    fontTestCache = { passed: true, fontPath };
    return fontTestCache;
  }
  if (await testWith(null)) {
    wLog('WARN', 'FONT_FALLBACK_TO_SYSTEM', { reason: 'Anton test failed, using system font' });
    fontTestCache = { passed: true, fontPath: null };
    return fontTestCache;
  }

  wLog('ERROR', 'FONT_TEST_ALL_FAILED', {});
  fontTestCache = { passed: false, fontPath: null };
  return fontTestCache;
}

// ── Video utilities ───────────────────────────────────────────────────────────

async function downloadVideo(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch { return false; }
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { timeout: 15_000 }
    );
    return parseFloat((JSON.parse(stdout) as any)?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

async function extractBestFrame(videoPath: string, highlightId: string, durationSec: number): Promise<Buffer> {
  const sharp = require('sharp');
  const frameDir = path.join(THUMB_BASE, highlightId, 'v7_frames');
  sikreDir(frameDir);

  const percentages = [20, 50, 80];
  const frames: Array<{ buf: Buffer; brightness: number; pct: number }> = [];

  for (const pct of percentages) {
    const t = Math.max(0.5, (durationSec * pct) / 100);
    const framePath = path.join(frameDir, `f${pct}.jpg`);
    try {
      await execAsync(
        `ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale=1280:720" "${framePath}"`,
        { timeout: 15_000 }
      );
      if (!fs.existsSync(framePath) || fs.statSync(framePath).size < 4_000) continue;
      const buf = fs.readFileSync(framePath);
      const { data } = await sharp(buf).resize(8, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
      const brightness = (Array.from(data as Buffer) as number[]).reduce((a, b) => a + b, 0) / data.length;
      frames.push({ buf, brightness, pct });
    } catch {}
  }

  if (frames.length === 0) throw new Error('Ingen frames kunne ekstraheres fra video (ffmpeg feilet)');

  // Prefer frames above minimum brightness (avoid nearly-black frames)
  const MIN_BRIGHTNESS = 30;
  const bright = frames.filter(f => f.brightness >= MIN_BRIGHTNESS);
  const best = bright.length > 0
    ? bright.reduce((a, b) => a.brightness > b.brightness ? a : b)
    : frames[Math.floor(frames.length / 2)];

  wLog('INFO', 'BEST_FRAME', { highlightId, pct: best.pct, brightness: best.brightness.toFixed(1) });
  return best.buf;
}

// ── Hook Engine ───────────────────────────────────────────────────────────────

async function getHook(
  frameBuf: Buffer,
  title: string,
  category: string,
  transcript: string | null,
): Promise<{ headline: string; hookSource: string }> {
  const geminiKey = process.env.GEMINI_API_KEY;

  if (geminiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = [
        'Du er YouTube gaming thumbnail-ekspert. Gi ÉN hook (2-4 ORD) på norsk for dette klippet.',
        `Tittel: ${title}`,
        `Kategori: ${category}`,
        transcript ? `Transkripsjon: ${transcript.slice(0, 200)}` : '',
        '',
        'Krav: VERSALER · 2-4 ord · dramatisk · norsk · avslutt med !',
        'Eksempler: POLITIET KOM! | VI BLE TATT! | DET GIKK GALT! | JEG ANGRER!',
        '',
        'Svar KUN med hook-teksten. Ingenting annet.',
      ].filter(Boolean).join('\n');

      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: frameBuf.toString('base64') } },
      ]);

      const raw  = result.response.text().trim();
      const hook = raw.toUpperCase().replace(/[^A-ZÆØÅ0-9!? ]/g, '').trim();
      const words = hook.split(/\s+/).filter(Boolean).length;

      if (hook.length >= 3 && hook.length <= 35 && words >= 2 && words <= 5) {
        wLog('INFO', 'HOOK_GEMINI', { hook, words });
        return { headline: hook, hookSource: 'gemini' };
      }
      wLog('WARN', 'HOOK_GEMINI_INVALID', { raw: raw.slice(0, 60), hook });
    } catch (e: any) {
      wLog('WARN', 'HOOK_GEMINI_FAIL', { err: e.message?.slice(0, 100) });
    }
  }

  const headline = categoryFallbackHook(category, title);
  return { headline, hookSource: 'category_fallback' };
}

// ── Pango text render ─────────────────────────────────────────────────────────

async function renderPangoText(
  text: string,
  fontPath: string | null,
  colorHex: string,
  maxWidthPx: number,
  ptSize: number,
): Promise<Buffer> {
  const sharp = require('sharp');
  const desc   = fontPath ? `Anton ${ptSize}` : `DejaVu Sans Bold ${ptSize}`;
  const markup = `<span font_desc="${desc}" foreground="${colorHex}">${escapeXml(text)}</span>`;

  return sharp({
    text: {
      text: markup,
      fontfile: fontPath ?? undefined,
      font: fontPath ? 'Anton' : undefined,
      rgba: true,
      width: maxWidthPx,
      dpi: HEADLINE_DPI,
    },
  }).png().toBuffer();
}

// ── Storage ───────────────────────────────────────────────────────────────────

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

// ── Composite builder ─────────────────────────────────────────────────────────

async function buildCompositeV7(
  frameBuf: Buffer,
  headline: string,
  category: string,
  fontPath: string | null,
): Promise<Buffer> {
  const sharp   = require('sharp');
  const primary = accentColor(category);

  // 1. Enhance frame: crop to 16:9, sharpen, boost saturation + contrast
  const enhanced = await sharp(frameBuf)
    .resize(YT_W, YT_H, { fit: 'cover', position: 'entropy' })
    .sharpen({ sigma: 0.9, m1: 0.5, m2: 3.5 })
    .modulate({ brightness: 1.08, saturation: 1.55 })
    .linear(1.07, -10)
    .toBuffer();

  // 2. Dark gradient — pure SVG shapes, NO @font-face, NO url() → safe as Buffer
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <defs>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="black" stop-opacity="0.85"/>
      <stop offset="55%"  stop-color="black" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="45%"  stop-color="black" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${YT_W}" height="${YT_H}" fill="url(#gl)"/>
  <rect x="0" y="${Math.round(YT_H * 0.35)}" width="${YT_W}" height="${Math.round(YT_H * 0.65)}" fill="url(#gb)"/>
</svg>`;

  // 3. Render headline via pango — drop shadow (black) + main (accent color)
  const [shadowBuf, mainBuf] = await Promise.all([
    renderPangoText(headline, fontPath, '#000000', TEXT_ZONE_W, HEADLINE_PT),
    renderPangoText(headline, fontPath, primary,   TEXT_ZONE_W, HEADLINE_PT),
  ]);

  const { width: tw = 600, height: th = 120 } = await sharp(mainBuf).metadata();

  // Position text: left-aligned, anchored 75px above the bottom edge
  const textX = TEXT_X;
  const textY = Math.max(20, YT_H - 75 - th);

  // 4. Accent stripe — pure SVG shapes, safe as Buffer
  const stripeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YT_W}" height="${YT_H}">
  <rect x="0" y="${YT_H - 7}" width="${YT_W}" height="7" fill="${primary}" opacity="0.90"/>
</svg>`;

  // 5. Composite all layers: frame → gradient → shadow → headline → stripe
  return sharp(enhanced)
    .composite([
      { input: Buffer.from(gradientSvg), top: 0,                         left: 0 },
      { input: shadowBuf,                top: textY + SHADOW_OFFSET,      left: textX + SHADOW_OFFSET },
      { input: mainBuf,                  top: textY,                      left: textX },
      { input: Buffer.from(stripeSvg),   top: 0,                         left: 0 },
    ])
    .png({ compressionLevel: 7 })
    .toBuffer();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildThumbnailV7(highlightId: string, source?: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const thumbDir  = path.join(THUMB_BASE, highlightId);
  sikreDir(thumbDir);
  const videoPath = path.join(thumbDir, 'video_v7_tmp.mp4');

  wLog('INFO', 'PIPELINE_START', { highlightId, source });
  logSystemEvent({
    source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_START',
    title: `Thumbnail V7 startet for ${highlightId}`,
    severity: 'info',
    metadata: { highlightId, source: source ?? 'unknown', thumbnailVersion: 'V7', renderer: 'sharp-pango-text-api' },
  });

  try {
    // ── 1. Load highlight ─────────────────────────────────────────────────────
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url,start_time,end_time')
      .eq('id', highlightId).single();
    if (!h) throw new Error('Highlight ikke funnet i DB');

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) throw new Error('Ingen clip_url — kan ikke generere thumbnail');

    // ── 2. Font + text test ───────────────────────────────────────────────────
    const rawFontPath = await prepareFont();
    const { passed: fontTestPassed, fontPath } = await runFontTest(rawFontPath);
    const fontUsed = fontPath ? 'Anton' : 'system';

    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_TEXT_TEST',
      title: `Font test: ${fontTestPassed ? 'BESTÅTT' : 'FEILET'} — bruker ${fontUsed}`,
      severity: fontTestPassed ? 'info' : 'warning',
      metadata: {
        highlightId,
        fontTestPassed,
        fontPath: fontPath ?? 'null',
        fontUsed,
        renderer: 'sharp-pango-text-api',
        testImage: '/tmp/v7-font-test.png',
      },
    });

    if (!fontTestPassed) {
      throw new Error('Font test feilet for alle fonter — kan ikke garantere lesbar tekst');
    }

    // ── 3. Transcript (optional, for hook engine) ─────────────────────────────
    const highlightStart = (h.start_time as number) ?? 0;
    const highlightEnd   = (h.end_time   as number) ?? highlightStart + 60;
    const { data: transcriptRows } = h.vod_id
      ? await db.from('content_transcripts')
          .select('start_time,text')
          .eq('vod_id', h.vod_id)
          .gte('end_time', highlightStart)
          .lte('start_time', highlightEnd)
          .order('start_time', { ascending: true })
          .limit(40)
      : { data: null };

    const transcript = (transcriptRows as any[] | null)?.length
      ? (transcriptRows as any[]).map((s: any) => s.text).join(' ').slice(0, 400)
      : null;

    // ── 4. Download video + extract best frame ────────────────────────────────
    if (!await downloadVideo(videoUrl, videoPath)) {
      throw new Error('Videofil kunne ikke lastes ned');
    }
    const durationSec = await getVideoDuration(videoPath);
    const bestFrame   = await extractBestFrame(videoPath, highlightId, durationSec);

    // ── 5. Hook engine ────────────────────────────────────────────────────────
    const { headline, hookSource } = await getHook(bestFrame, h.title ?? '', h.category ?? '', transcript);

    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_HOOK_SELECTED',
      title: `Hook valgt: "${headline}" (${hookSource})`,
      severity: 'info',
      metadata: {
        highlightId,
        headline,
        hookSource,
        category: h.category,
        hasTranscript: !!transcript,
      },
    });

    // ── 6. Render ─────────────────────────────────────────────────────────────
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_RENDER_START',
      title: `Thumbnail V7 render starter — "${headline}" · ${fontUsed}`,
      severity: 'info',
      metadata: {
        highlightId,
        headline,
        fontUsed,
        fontTestPassed,
        renderer: 'sharp-pango-text-api',
        templateUsed: 'IMPACT_DRAMA',
        category: h.category,
      },
    });

    const ytBuf = await buildCompositeV7(bestFrame, headline, h.category ?? '', fontPath);

    // Debug: always write last thumbnail to /tmp so we can inspect it
    try { fs.writeFileSync('/tmp/v7-last-thumbnail.png', ytBuf); } catch {}

    // ── 7. Upload ─────────────────────────────────────────────────────────────
    const vodId       = h.vod_id ?? 'unknown';
    const storagePath = `content-factory/thumbnails/${vodId}/${highlightId}_v7_yt.png`;
    const thumbnailUrl = await uploadBuffer(db, ytBuf, storagePath);
    if (!thumbnailUrl) throw new Error('Opplasting til storage feilet');

    // ── 8. DB update ──────────────────────────────────────────────────────────
    await db.from('content_highlights').update({
      thumbnail_status:          'DONE',
      thumbnail_youtube_url:     thumbnailUrl,
      thumbnail_headline:        headline,
      thumbnail_error:           null,
      thumbnail_ctr_reason:      `V7 · hook:${hookSource} · font:${fontUsed}`,
      thumbnail_reject_count:    0,
      // Clear old V5/V6 fields so UI shows fresh V7 output
      thumbnail_tiktok_url:      null,
      thumbnail_variant_b_url:   null,
      thumbnail_variant_c_url:   null,
      updated_at:                new Date().toISOString(),
    }).eq('id', highlightId);

    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_RENDER_COMPLETE',
      title: `Thumbnail V7 ferdig — "${headline}" · ${ytBuf.length} bytes`,
      severity: 'info',
      metadata: {
        highlightId,
        thumbnailUrl,
        headline,
        hookSource,
        fontUsed,
        fontTestPassed,
        renderer: 'sharp-pango-text-api',
        templateUsed: 'IMPACT_DRAMA',
        outputBytes: ytBuf.length,
        source: source ?? 'unknown',
      },
    });

    wLog('INFO', 'DONE', { highlightId, url: thumbnailUrl, bytes: ytBuf.length, fontUsed });

  } catch (e: any) {
    const msg = e.message?.slice(0, 200) ?? 'Ukjent feil';
    wLog('ERROR', 'FAILED', { highlightId, err: msg });

    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V7_FAILED',
      title: `Thumbnail V7 feilet: ${msg}`,
      severity: 'error',
      metadata: { highlightId, source: source ?? 'unknown', reason: msg },
    });

    try {
      await db?.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  `V7: ${msg}`,
      }).eq('id', highlightId);
    } catch {}

    // Upload debug copy if we have one
    try {
      if (fs.existsSync('/tmp/v7-last-thumbnail.png') && db) {
        const debugBuf = fs.readFileSync('/tmp/v7-last-thumbnail.png');
        await uploadBuffer(db, debugBuf, `content-factory/thumbnails/debug/${highlightId}_v7_debug.png`);
      }
    } catch {}

    throw e;

  } finally {
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
  }
}
