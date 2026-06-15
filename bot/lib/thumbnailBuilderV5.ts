/**
 * Thumbnail Builder V5 – CTR-optimised Multi-Concept Engine
 *
 * Phase 1: Hook Discovery          (GPT-4o-mini, metadata)
 * Phase 2: CTR Frame Selection     (GPT-4o-mini Vision, all frames)
 * Phase 3: 5 Concepts              (GPT-4o-mini)
 * Phase 4: Pre-score → top 2      (GPT-4o-mini, text-only)
 * Phase 5: Generate 4 images       (gpt-image-1, parallel: YT+TT × 2)
 * Phase 6: CTR Judge               (GPT-4o Vision, compare YT variants)
 * Phase 7: Upload winner + save DB
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';

const execAsync = require('util').promisify(require('child_process').exec);

const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';
const THUMB_BASE     = path.join(process.cwd(), 'data', 'thumbnails');

// ── Utilities ──────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  const suffix = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[ThumbnailV5][${level}] ${event}${suffix}`);
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
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch { return false; }
}

async function lastOppBuffer(db: any, buf: Buffer, storageSti: string): Promise<string | null> {
  try {
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(storageSti, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) throw error;
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storageSti);
    return (data as any)?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'THUMB_UPLOAD_FAIL', { storageSti, err: err.message?.slice(0, 200) });
    return null;
  }
}

// ── Frame extraction ───────────────────────────────────────────────────────────

interface Frame { path: string; percent: number; }

async function hentVideoDuration(videoSti: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoSti}"`,
      { timeout: 15_000 }
    );
    return parseFloat((JSON.parse(stdout) as any)?.format?.duration ?? '0') || 30;
  } catch { return 30; }
}

async function hentFrames(videoSti: string, highlightId: string): Promise<Frame[]> {
  const durSek   = await hentVideoDuration(videoSti);
  const frameDir = path.join(THUMB_BASE, highlightId, 'frames');
  sikreDir(frameDir);

  const frames: Frame[] = [];
  for (const pct of [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95]) {
    const sek      = Math.min((durSek * pct) / 100, durSek - 0.5);
    const frameSti = path.join(frameDir, `frame_${String(pct).padStart(2, '0')}.jpg`);
    try {
      await execAsync(
        `ffmpeg -y -ss ${sek.toFixed(2)} -i "${videoSti}" -vf "scale=640:360" -frames:v 1 -q:v 3 "${frameSti}"`,
        { timeout: 20_000 }
      );
      if (fs.existsSync(frameSti) && fs.statSync(frameSti).size > 4_000) {
        frames.push({ path: frameSti, percent: pct });
      }
    } catch {}
  }
  return frames;
}

// ── Phase 1: Hook Discovery ────────────────────────────────────────────────────

interface HookData {
  hook: string;
  emotion: string;
  conflict: string;
  curiosity: string;
  thumbnail_text: string[];
}

async function hookDiscovery(
  client: OpenAI,
  highlight: any,
  vod: any,
  highlightId: string
): Promise<HookData> {
  const fallback: HookData = {
    hook: highlight.title ?? 'Epic gaming moment',
    emotion: 'excitement',
    conflict: 'high stakes',
    curiosity: 'what happens next',
    thumbnail_text: ['SJEKK DETTE', 'IKKE TRO', 'DETTE SKJEDDE'],
  };

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Du er ekspert på viral gaming-innhold. Analyser klippet og finn den sterkeste thumbnail-kroken.
Svar KUN med JSON:
{
  "hook": "kjernespenningen i én setning",
  "emotion": "primæremosjon (shock/curiosity/joy/rage/triumph/fear)",
  "conflict": "hva som står på spill",
  "curiosity": "hva seeren trenger å vite",
  "thumbnail_text": ["2-4 ORD CAPS", "ALTERNATIV 2", "ALTERNATIV 3"]
}
thumbnail_text: 2–4 ord, STORE BOKSTAVER, norsk, ærlig — reflekter klippets faktiske innhold.`,
      }, {
        role: 'user',
        content: [
          `Klipp: ${highlight.title ?? 'Ukjent'}`,
          `Kategori: ${highlight.category ?? 'Ukjent'}`,
          `Spill: ${vod?.category ?? vod?.title ?? 'Ukjent'}`,
          highlight.begrunnelse ? `Begrunnelse: ${highlight.begrunnelse}` : '',
        ].filter(Boolean).join('\n'),
      }],
      max_tokens: 220,
      temperature: 0.8,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as HookData;
  } catch (err: any) {
    wLog('WARN', 'HOOK_DISCOVERY_FAIL', { highlightId, err: err.message?.slice(0, 100) });
  }
  return fallback;
}

// ── Phase 2: CTR Frame Selection ──────────────────────────────────────────────

async function selectFrameForCTR(
  client: OpenAI,
  frames: Frame[],
  hook: HookData,
  highlightId: string
): Promise<{ frame: Frame; description: string }> {
  const fallback = [...frames].sort((a, b) => Math.abs(a.percent - 50) - Math.abs(b.percent - 50))[0] ?? frames[0];

  if (frames.length === 0) return { frame: fallback, description: '' };

  // Pick up to 6 frames spread evenly
  const step      = Math.max(1, Math.floor(frames.length / 6));
  const kandidater = frames.filter((_, i) => i % step === 0).slice(0, 6);

  try {
    const imageContent: any[] = kandidater.map(f => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f.path).toString('base64')}`, detail: 'low' },
    }));
    imageContent.push({
      type: 'text',
      text: `${kandidater.length} frames from a gaming clip (at ${kandidater.map(f => f.percent + '%').join(', ')} through the video).
Hook: "${hook.hook}" | Emotion: ${hook.emotion}

Score each frame for YouTube thumbnail CTR. Priority: face/reaction > shock moment > explosion/boss > intense action > loot > static.
Pick the single best frame.

Reply ONLY with JSON:
{"best": <1-${kandidater.length}>, "description": "<what's visible, 1-2 sentences>", "reason": "<why CTR-optimal>"}`,
    });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: imageContent }],
      max_tokens: 220,
      temperature: 0.2,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const p   = JSON.parse(match[0]) as { best?: number; description?: string };
      const idx = Math.max(0, (p.best ?? 1) - 1);
      return { frame: kandidater[idx] ?? fallback, description: p.description ?? '' };
    }
  } catch (err: any) {
    wLog('WARN', 'CTR_FRAME_SELECT_FAIL', { highlightId, err: err.message?.slice(0, 100) });
  }
  return { frame: fallback, description: '' };
}

// ── Phase 3: 5 Concepts ───────────────────────────────────────────────────────

interface Concept {
  type: 'drama' | 'shock' | 'curiosity' | 'comedy' | 'competitive';
  headline: string;
  subtext: string;
  style: string;
  imagePrompt: string;
}

async function generateConcepts(
  client: OpenAI,
  highlight: any,
  vod: any,
  hook: HookData,
  frameDescription: string,
  highlightId: string
): Promise<Concept[]> {
  const spill = vod?.category ?? vod?.title ?? 'gaming';

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Du er world-class YouTube thumbnail designer for gaming. Lag 5 thumbnail-konsepter — ett per emosjonell vinkel.

Svar KUN med JSON-array med 5 objekter:
[
  {
    "type": "drama|shock|curiosity|comedy|competitive",
    "headline": "2-4 ORD CAPS norsk",
    "subtext": "valgfri undertext maks 5 ord, kan være tom string",
    "style": "kort visuell stil-beskrivelse",
    "imagePrompt": "komplett engelsk prompt for gpt-image-1, maks 120 ord"
  }
]

imagePrompt-regler:
- Inkluder: "YouTube gaming thumbnail, 16:9, landscape"
- Beskriv scenen basert på frame og klipp-kontekst
- Inkluder: "with large bold white text '[HEADLINE]' in Impact font, dark stroke, placed in lower third"
- Stil: dark cinematic background, neon green (#00FF87) accent, high contrast, dramatic
- Representer innholdet ærlig — ingen clickbait som ikke stemmer med klippet`,
      }, {
        role: 'user',
        content: `Klipp: ${highlight.title ?? 'Ukjent'}
Kategori: ${highlight.category ?? 'Ukjent'}
Spill: ${spill}
Hook: ${hook.hook}
Emosjon: ${hook.emotion}
Konflikt: ${hook.conflict}
Foreslåtte tekster: ${hook.thumbnail_text.join(' / ')}
Frame-scene: ${frameDescription || 'intense gaming action'}
${highlight.begrunnelse ? `Begrunnelse: ${highlight.begrunnelse}` : ''}`,
      }],
      max_tokens: 1400,
      temperature: 0.9,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Concept[];
      if (Array.isArray(parsed) && parsed.length >= 3) return parsed.slice(0, 5);
    }
  } catch (err: any) {
    wLog('WARN', 'CONCEPTS_FAIL', { highlightId, err: err.message?.slice(0, 100) });
  }

  // Fallback: minimal concepts from hook texts
  return hook.thumbnail_text.slice(0, 3).map((txt, i) => ({
    type: (['drama', 'shock', 'curiosity'] as const)[i] ?? 'drama',
    headline: txt,
    subtext: '',
    style: 'Dark cinematic gaming thumbnail with neon green accents',
    imagePrompt: `YouTube gaming thumbnail, 16:9, landscape, ${spill}, ${frameDescription || 'intense action'}, with large bold white text '${txt}' in Impact font, dark stroke, placed in lower third, neon green (#00FF87) accent lighting, dark background, high contrast, cinematic, dramatic mood`,
  }));
}

// ── Phase 4: Pre-score → top 2 ────────────────────────────────────────────────

async function preScoreConcepts(
  client: OpenAI,
  concepts: Concept[],
  hook: HookData,
  highlightId: string
): Promise<[Concept, Concept]> {
  const fallback: [Concept, Concept] = [concepts[0], concepts[1] ?? concepts[0]];

  try {
    const list = concepts.map((c, i) =>
      `${i + 1}. [${c.type.toUpperCase()}] "${c.headline}"${c.subtext ? ` / "${c.subtext}"` : ''} — ${c.style}`
    ).join('\n');

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Du er CTR-ekspert på gaming thumbnails. Ranger disse konseptene basert på tekst og stil alene.
Hook: "${hook.hook}" | Emosjon: ${hook.emotion}

Score basert på: emosjonelt trykk, nysgjerrighet, tekststyrke, mobillesbarhet.
Svar KUN med JSON: {"ranked": [<1-5>, <1-5>, <1-5>, <1-5>, <1-5>], "reason": "begrunnelse for topp 2"}
ranked = numre fra best til dårligst.`,
      }, {
        role: 'user',
        content: list,
      }],
      max_tokens: 160,
      temperature: 0.3,
    });

    const text  = res.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const p      = JSON.parse(match[0]) as { ranked?: number[]; reason?: string };
      const ranked = (p.ranked ?? []).map(n => n - 1);
      const top1   = concepts[ranked[0]] ?? concepts[0];
      const top2   = concepts[ranked[1]] ?? concepts[1] ?? concepts[0];
      logSystemEvent({
        source: 'thumbnail_worker', event_type: 'THUMBNAIL_CONCEPTS_PRESCORED',
        title: `Topp 2: ${top1.type} + ${top2.type}`,
        severity: 'info',
        metadata: { highlightId, top1: top1.type, top2: top2.type, reason: p.reason },
      });
      return [top1, top2];
    }
  } catch (err: any) {
    wLog('WARN', 'PRESCORE_FAIL', { highlightId, err: err.message?.slice(0, 100) });
  }
  return fallback;
}

// ── Phase 5: Generate images (gpt-image-1) ────────────────────────────────────

interface GeneratedVariant {
  ytBuffer: Buffer | null;
  ttBuffer: Buffer | null;
  concept:  Concept;
}

async function generateVariant(
  client: OpenAI,
  concept: Concept,
  highlightId: string,
  label: string
): Promise<GeneratedVariant> {
  const ytPrompt = `${concept.imagePrompt} Landscape 16:9 format for YouTube. Text in lower third.`;
  const ttPrompt = `${concept.imagePrompt} Vertical 9:16 format for TikTok/Shorts. Text centered, 10% safe-zone margins.`.replace('16:9, landscape', '9:16, vertical');

  let ytBuffer: Buffer | null = null;
  let ttBuffer: Buffer | null = null;

  const [ytRes, ttRes] = await Promise.allSettled([
    client.images.generate({
      model: 'gpt-image-1' as any,
      prompt: ytPrompt,
      n: 1,
      size: '1536x1024' as any,
    }),
    client.images.generate({
      model: 'gpt-image-1' as any,
      prompt: ttPrompt,
      n: 1,
      size: '1024x1536' as any,
    }),
  ]);

  if (ytRes.status === 'fulfilled') {
    const b64 = (ytRes.value.data?.[0] as any)?.b64_json as string | undefined;
    if (b64) ytBuffer = Buffer.from(b64, 'base64');
  } else {
    wLog('WARN', `V5_YT_GENERATE_FAIL_${label}`, { highlightId, err: (ytRes.reason as any)?.message?.slice(0, 150) });
  }

  if (ttRes.status === 'fulfilled') {
    const b64 = (ttRes.value.data?.[0] as any)?.b64_json as string | undefined;
    if (b64) ttBuffer = Buffer.from(b64, 'base64');
  } else {
    wLog('WARN', `V5_TT_GENERATE_FAIL_${label}`, { highlightId, err: (ttRes.reason as any)?.message?.slice(0, 150) });
  }

  return { ytBuffer, ttBuffer, concept };
}

// ── Phase 6: CTR Judge ─────────────────────────────────────────────────────────

interface JudgeResult { winnerIdx: 0 | 1; ctrScore: number; reason: string; }

async function ctrJudge(
  client: OpenAI,
  variantA: GeneratedVariant,
  variantB: GeneratedVariant,
  hook: HookData,
  highlightId: string
): Promise<JudgeResult> {
  const fallback: JudgeResult = { winnerIdx: 0, ctrScore: 55, reason: 'CTR judge fallback – valgte konsept A' };

  const images: { buffer: Buffer; label: string; idx: 0 | 1 }[] = [];
  if (variantA.ytBuffer) images.push({ buffer: variantA.ytBuffer, label: 'A', idx: 0 });
  if (variantB.ytBuffer) images.push({ buffer: variantB.ytBuffer, label: 'B', idx: 1 });

  if (images.length === 0) return fallback;

  const scorePrompt = `Rate this YouTube gaming thumbnail for CTR potential.
Hook: "${hook.hook}"

Score each category (0-max points):
- Curiosity trigger:   /20
- Emotional impact:    /20
- Visual contrast:     /10
- Subject clarity:     /20
- Text impact:         /20
- Mobile readability:  /10
Total: /100

Reply ONLY with JSON: {"ctr_score": <0-100>, "reason": "<1-2 sentences>"}`;

  if (images.length === 1) {
    try {
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${images[0].buffer.toString('base64')}`, detail: 'low' } },
          { type: 'text', text: scorePrompt },
        ] }],
        max_tokens: 140,
        temperature: 0.2,
      });
      const match = (res.choices[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]) as { ctr_score?: number; reason?: string };
        return { winnerIdx: images[0].idx, ctrScore: Math.min(100, Math.max(0, p.ctr_score ?? 55)), reason: p.reason ?? '' };
      }
    } catch (err: any) {
      wLog('WARN', 'CTR_JUDGE_SINGLE_FAIL', { highlightId, err: err.message?.slice(0, 100) });
    }
    return { winnerIdx: images[0].idx, ctrScore: 55, reason: 'Scoring fallback' };
  }

  // Compare A vs B
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${images[0].buffer.toString('base64')}`, detail: 'low' } },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${images[1].buffer.toString('base64')}`, detail: 'low' } },
        { type: 'text', text: `These are 2 YouTube gaming thumbnail variants (A=left, B=right).
Hook: "${hook.hook}" | Emotion: ${hook.emotion}

For each, score: Curiosity/20 + Emotion/20 + Contrast/10 + SubjectClarity/20 + TextImpact/20 + Mobile/10 = /100

Pick the winner. Reply ONLY with JSON:
{"winner": "A" or "B", "score_a": <0-100>, "score_b": <0-100>, "ctr_score": <winner score>, "reason": "<1-2 sentences>"}` },
      ] }],
      max_tokens: 200,
      temperature: 0.2,
    });

    const match = (res.choices[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
    if (match) {
      const p      = JSON.parse(match[0]) as { winner?: string; ctr_score?: number; reason?: string };
      const wLabel = (p.winner ?? 'A').toUpperCase();
      const wImg   = images.find(i => i.label === wLabel) ?? images[0];
      return { winnerIdx: wImg.idx, ctrScore: Math.min(100, Math.max(0, p.ctr_score ?? 55)), reason: p.reason ?? '' };
    }
  } catch (err: any) {
    wLog('WARN', 'CTR_JUDGE_COMPARE_FAIL', { highlightId, err: err.message?.slice(0, 100) });
  }

  return fallback;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function buildThumbnailV5(highlightId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Ingen DB-tilkobling');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  const client   = new OpenAI({ apiKey });
  const thumbDir = path.join(THUMB_BASE, highlightId);
  const videoSti = path.join(thumbDir, 'video_tmp.mp4');

  sikreDir(thumbDir);

  try {
    wLog('INFO', 'THUMBNAIL_V5_STARTED', { highlightId });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V5_STARTED',
      title: `Thumbnail V5 startet for ${highlightId}`, severity: 'info',
      metadata: { highlightId },
    });

    // Load highlight + VOD
    const { data: h } = await db.from('content_highlights')
      .select('id,vod_id,title,category,begrunnelse,clip_url,vertical_clip_url')
      .eq('id', highlightId).single();
    if (!h) throw new Error('Highlight ikke funnet');

    const videoUrl = h.clip_url ?? h.vertical_clip_url;
    if (!videoUrl) {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error: 'Ingen clip_url',
      }).eq('id', highlightId);
      return;
    }

    const { data: vod } = await db.from('content_vods')
      .select('id,title,category').eq('id', h.vod_id).single();

    // Download video
    if (!await lastNedFil(videoUrl, videoSti)) throw new Error('Kunne ikke laste ned video');

    // Extract frames
    const frames = await hentFrames(videoSti, highlightId);
    if (frames.length === 0) throw new Error('Ingen frames ekstrahert');

    // Phase 1: Hook Discovery
    const hook = await hookDiscovery(client, h, vod, highlightId);
    wLog('INFO', 'THUMBNAIL_HOOK_DISCOVERED', { highlightId, emotion: hook.emotion });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_HOOK_DISCOVERED',
      title: `Hook: ${hook.hook}`, severity: 'info',
      metadata: { highlightId, hook: hook.hook, emotion: hook.emotion },
    });

    // Phase 2: CTR Frame Selection
    const { frame: bestFrame, description: frameDescription } = await selectFrameForCTR(client, frames, hook, highlightId);
    wLog('INFO', 'THUMBNAIL_FRAME_SELECTED', { highlightId, percent: bestFrame.percent });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_FRAME_SELECTED',
      title: `Frame valgt: ${bestFrame.percent}%`, severity: 'info',
      metadata: { highlightId, percent: bestFrame.percent, description: frameDescription.slice(0, 100) },
    });

    // Phase 3: 5 Concepts
    const concepts = await generateConcepts(client, h, vod, hook, frameDescription, highlightId);
    wLog('INFO', 'THUMBNAIL_CONCEPTS_CREATED', { highlightId, antall: concepts.length });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_CONCEPTS_CREATED',
      title: `${concepts.length} konsepter generert`, severity: 'info',
      metadata: { highlightId, antall: concepts.length, typer: concepts.map(c => c.type) },
    });

    // Phase 4: Pre-score → top 2
    const [top1, top2] = await preScoreConcepts(client, concepts, hook, highlightId);
    wLog('INFO', 'THUMBNAIL_CONCEPTS_PRESCORED', { highlightId, top1: top1.type, top2: top2.type });

    // Phase 5: Generate images (gpt-image-1, parallel)
    wLog('INFO', 'THUMBNAIL_VARIANTS_GENERATING', { highlightId, konsepter: [top1.type, top2.type] });
    const [variantA, variantB] = await Promise.all([
      generateVariant(client, top1, highlightId, 'A'),
      generateVariant(client, top2, highlightId, 'B'),
    ]);

    const variantsGenerated =
      (variantA.ytBuffer ? 1 : 0) + (variantA.ttBuffer ? 1 : 0) +
      (variantB.ytBuffer ? 1 : 0) + (variantB.ttBuffer ? 1 : 0);
    wLog('INFO', 'THUMBNAIL_VARIANTS_GENERATED', { highlightId, antall: variantsGenerated });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_VARIANTS_GENERATED',
      title: `${variantsGenerated}/4 varianter generert`, severity: variantsGenerated < 2 ? 'warning' : 'info',
      metadata: { highlightId, antall: variantsGenerated },
    });

    if (!variantA.ytBuffer && !variantB.ytBuffer) {
      throw new Error('Alle billedgenereringer feilet');
    }

    // Phase 6: CTR Judge
    const judge  = await ctrJudge(client, variantA, variantB, hook, highlightId);
    const winner = judge.winnerIdx === 0 ? variantA : variantB;
    wLog('INFO', 'THUMBNAIL_CTR_JUDGED', { highlightId, score: judge.ctrScore, vinner: winner.concept.type, reason: judge.reason });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_CTR_JUDGED',
      title: `CTR-score: ${judge.ctrScore}/100 — Vinner: ${winner.concept.type}`, severity: judge.ctrScore < 60 ? 'warning' : 'info',
      metadata: { highlightId, ctrScore: judge.ctrScore, vinner: winner.concept.type, reason: judge.reason },
    });

    if (judge.ctrScore < 60) {
      wLog('WARN', 'THUMBNAIL_LOW_CTR_WARNING', { highlightId, score: judge.ctrScore });
      logSystemEvent({
        source: 'thumbnail_worker', event_type: 'THUMBNAIL_LOW_CTR_WARNING',
        title: `Lav CTR-score: ${judge.ctrScore}/100`, severity: 'warning',
        metadata: { highlightId, ctrScore: judge.ctrScore, reason: judge.reason },
      });
    }

    // Phase 7: Upload winner + save
    const vodId = h.vod_id ?? 'unknown';
    const [ytUrl, ttUrl] = await Promise.all([
      winner.ytBuffer
        ? lastOppBuffer(db, winner.ytBuffer, `content-factory/thumbnails/${vodId}/${highlightId}_youtube_v5.png`)
        : Promise.resolve(null),
      winner.ttBuffer
        ? lastOppBuffer(db, winner.ttBuffer, `content-factory/thumbnails/${vodId}/${highlightId}_tiktok_v5.png`)
        : Promise.resolve(null),
    ]);

    if (!ytUrl && !ttUrl) throw new Error('Opplasting av vinner-thumbnails feilet');

    await db.from('content_highlights').update({
      thumbnail_status:       'DONE',
      thumbnail_youtube_url:  ytUrl,
      thumbnail_tiktok_url:   ttUrl,
      thumbnail_headline:     winner.concept.headline,
      thumbnail_subheadline:  winner.concept.subtext || null,
      thumbnail_prompt:       winner.concept.imagePrompt.slice(0, 500),
      thumbnail_generated_at: new Date().toISOString(),
      thumbnail_error:        null,
      thumbnail_ctr_score:    judge.ctrScore,
      thumbnail_concept:      winner.concept.type,
      thumbnail_hook:         hook,
    }).eq('id', highlightId);

    wLog('INFO', 'THUMBNAIL_V5_DONE', { highlightId, score: judge.ctrScore, headline: winner.concept.headline });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V5_DONE',
      title: `Thumbnail V5 ferdig — CTR ${judge.ctrScore}/100`, severity: 'info',
      metadata: { highlightId, ctrScore: judge.ctrScore, concept: winner.concept.type, headline: winner.concept.headline, harYoutube: !!ytUrl, harTikTok: !!ttUrl },
    });

  } catch (err: any) {
    const msg = err.message?.slice(0, 300) ?? 'Ukjent feil';
    wLog('ERROR', 'THUMBNAIL_V5_FAILED', { highlightId, err: msg });
    logSystemEvent({
      source: 'thumbnail_worker', event_type: 'THUMBNAIL_V5_FAILED',
      title: `Thumbnail V5 feilet: ${msg}`, severity: 'error',
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
    ryddFiler(videoSti);
    ryddDir(path.join(THUMB_BASE, highlightId, 'frames'));
  }
}
