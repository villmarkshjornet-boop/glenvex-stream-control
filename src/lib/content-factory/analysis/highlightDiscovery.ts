/**
 * Highlight Discovery V2 — multi-pass full-transcript analysis.
 *
 * Philosophy: 5 exceptional clips beats 25 mediocre ones.
 * We send the ENTIRE transcript to GPT-4o (128k context) so it can
 * understand the narrative arc before picking moments.
 *
 * Pass 1  — GPT-4o reads full transcript, nominates 8–12 candidates
 * Pass 2  — Boundary refinement: find natural sentence start/end, add 3–5s buffer
 * Pass 3  — Story arc + quality scoring (entertainment, emotion, surprise, viral)
 * Pass 4  — Quality filter: keep ≤5 clips, score ≥ 65
 * Pass 5  — Persist + log CLIP_SELECTED / CLIP_REJECTED per candidate
 */

import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';
import { hentTranskripsjon } from '../transcripts/whisperService';
import { logPipeline } from '../jobs/pipelineLogger';
import { logSystemEvent } from '@/lib/systemEvents';
import type { ContentHighlight, HighlightSignal, HighlightCategory } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
}

interface Candidate {
  rough_start: number;
  rough_end: number;
  category: string;
  title: string;
  begrunnelse: string;
  quality: {
    entertainment: number;  // 1–10
    emotion: number;        // 1–10
    surprise: number;       // 1–10
    viral_potential: number;// 1–10
    story_arc: boolean;     // has setup → buildup → climax → payoff
  };
  score: number;            // 0–100 composite
}

interface RefinedCandidate extends Candidate {
  start_time: number;
  end_time: number;
  context_text: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CLIP_SECONDS = 15;
const MAX_CLIP_SECONDS = 120;
const MIN_QUALITY_SCORE = 65;
const MAX_CLIPS = 5;
const PRE_BUFFER_S = 4;   // seconds before the highlight moment
const POST_BUFFER_S = 4;  // seconds after the reaction/payoff

// ── Pass 2: Boundary refinement ───────────────────────────────────────────────

function refineBoundaries(
  candidate: Omit<Candidate, 'score'> & { rough_start: number; rough_end: number },
  segments: TranscriptSegment[]
): { start_time: number; end_time: number; context_text: string } {
  // Find segments that overlap with the rough window
  const window = segments.filter(
    s => s.endTime >= candidate.rough_start - 15 && s.startTime <= candidate.rough_end + 15
  );

  if (window.length === 0) {
    return {
      start_time: Math.max(0, candidate.rough_start - PRE_BUFFER_S),
      end_time: candidate.rough_end + POST_BUFFER_S,
      context_text: '',
    };
  }

  // Walk backward from rough_start to find a natural sentence boundary
  // (segment that doesn't end mid-sentence relative to what follows)
  const firstInWindow = window[0];
  const lastInWindow  = window[window.length - 1];

  // Apply buffer, clamped to available transcript range
  const totalDuration = segments[segments.length - 1]?.endTime ?? 0;
  const startWithBuffer = Math.max(0, firstInWindow.startTime - PRE_BUFFER_S);
  const endWithBuffer   = Math.min(totalDuration, lastInWindow.endTime + POST_BUFFER_S);

  // Enforce min/max clip length
  const rawDuration = endWithBuffer - startWithBuffer;
  let finalStart = startWithBuffer;
  let finalEnd   = endWithBuffer;

  if (rawDuration < MIN_CLIP_SECONDS) {
    const pad = (MIN_CLIP_SECONDS - rawDuration) / 2;
    finalStart = Math.max(0, startWithBuffer - pad);
    finalEnd   = Math.min(totalDuration, endWithBuffer + pad);
  } else if (rawDuration > MAX_CLIP_SECONDS) {
    // Center the window around the midpoint of the rough range
    const mid = (candidate.rough_start + candidate.rough_end) / 2;
    finalStart = Math.max(0, mid - MAX_CLIP_SECONDS / 2);
    finalEnd   = finalStart + MAX_CLIP_SECONDS;
  }

  const context_text = window.map(s => s.text).join(' ');
  return { start_time: Math.round(finalStart), end_time: Math.round(finalEnd), context_text };
}

// ── Pass 1 + 3: GPT-4o full transcript analysis ──────────────────────────────

async function analyzeFullTranscript(
  segments: TranscriptSegment[],
  streamData?: { raids?: any[]; chatSpikes?: any[] },
  creatorContext?: string
): Promise<Candidate[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || segments.length === 0) return [];

  const openai = new OpenAI({ apiKey });

  // Format full transcript — include timestamps for reference
  const transcriptText = segments
    .map(s => `[${Math.round(s.startTime)}s] ${s.text}`)
    .join('\n');

  // Encode external signals as context
  const externalSignals: string[] = [];
  for (const raid of streamData?.raids ?? []) {
    if (raid.timestamp) {
      const raidSec = typeof raid.timestamp === 'number'
        ? raid.timestamp
        : (Date.now() - new Date(raid.timestamp).getTime()) / -1000;
      externalSignals.push(`Raid fra ${raid.username} med ${raid.viewers} seere ved ~${Math.round(Math.abs(raidSec))}s`);
    }
  }
  for (const spike of streamData?.chatSpikes ?? []) {
    if (spike.intensity > 70) {
      externalSignals.push(`Høy chat-aktivitet (${spike.intensity}%) ved ~${Math.round(spike.timestamp)}s`);
    }
  }

  const signalContext = externalSignals.length > 0
    ? `\nEksternal kontekst:\n${externalSignals.join('\n')}`
    : '';

  const prompt = `Du er en profesjonell video editor og innholdsstrateg for en norsk Twitch-streamer.

Din jobb: Les HELE denne transskripsjonen og finn de ${MAX_CLIPS + 3} beste øyeblikkene for korte klipp.
${creatorContext ?? ''}${signalContext}

KATEGORIER du skal velge mellom:
- CLUTCH: Nervepirrende øyeblikk, nesten-seier/tap
- WIN: Klar seier, mestring, triumf
- FAIL: Morsom/dramatisk feil
- SURPRISE: Uventet skjer
- LAUGH: Genuint latterfylt øyeblikk
- RAGE: Sinne/frustrasjon (som entertainment)
- CHAT_REACTION: Chat-eksplosjon + streamer-reaksjon
- HYPE: Høy energi, dominans
- DIALOGUE: Interessant samtale/fortelling
- KEY_MOMENT: Viktig hendelse i storyline
- REACTION: Sterk emosjonell reaksjon
- RP_MOMENT: Viktig rollespill-øyeblikk

HVA GJØR ET GODT KLIPP:
- Har en naturlig begynnelse (kontekst/oppbygging)
- Har et klart høydepunkt
- Har en avslutning (reaksjon, payoff)
- Føles komplett uten å se resten av streamen
- Kan publiseres direkte på TikTok/YouTube Shorts/Reels

SCORE-GUIDE (0–100):
- 0–64: Ikke godt nok (hopp over)
- 65–79: Bra klipp
- 80–89: Veldig bra
- 90–100: Eksepsjonelt – dette går viralt

Returner KUN JSON:
{
  "highlights": [
    {
      "rough_start": 123,
      "rough_end": 178,
      "category": "CLUTCH",
      "title": "Tittel (maks 8 ord, norsk)",
      "begrunnelse": "Hvorfor dette er et godt klipp (maks 20 ord)",
      "quality": {
        "entertainment": 8,
        "emotion": 7,
        "surprise": 9,
        "viral_potential": 8,
        "story_arc": true
      },
      "score": 82
    }
  ]
}

TRANSKRIPSJON (timestamps i sekunder):
${transcriptText}`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 3000,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  try {
    const { sikreJsonParse } = await import('../utils/retry');
    const data = sikreJsonParse(res.choices[0]?.message?.content ?? '{}', { highlights: [] });
    return (data.highlights ?? []) as Candidate[];
  } catch {
    return [];
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function oppdagHighlights(
  vodId: string,
  streamData?: { raids?: any[]; subs?: any[]; chatSpikes?: { timestamp: number; intensity: number }[] }
): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  const start = Date.now();
  await logPipeline({ vodId, step: 'DISCOVER', status: 'STARTED' });

  const transkripter = await hentTranskripsjon(vodId);
  if (transkripter.length === 0) throw new Error('Ingen transkripsjon funnet for VOD ' + vodId);

  // Creator context for better AI understanding
  let creatorCtx: string | undefined;
  try {
    const { getCreatorContext, buildContextPrompt } = await import('@/lib/ai/creatorContext');
    const knowledge = await getCreatorContext({ limit: 10 });
    if (knowledge && (knowledge.streamCount > 0 || knowledge.runningJokes.length > 0)) {
      creatorCtx = buildContextPrompt(knowledge);
    }
  } catch { /* run without history */ }

  // ── Pass 1+3: GPT-4o reads the full transcript ───────────────────────────
  const rawCandidates = await analyzeFullTranscript(transkripter, streamData, creatorCtx);

  // ── Pass 2: Boundary refinement for each candidate ───────────────────────
  const refined: RefinedCandidate[] = rawCandidates.map(c => {
    const boundaries = refineBoundaries(c, transkripter);
    return { ...c, ...boundaries };
  });

  // ── Pass 4: Quality filter — keep ≤MAX_CLIPS with score ≥ MIN_QUALITY_SCORE ──
  const passing = refined
    .filter(c => (c.score ?? 0) >= MIN_QUALITY_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CLIPS);

  const rejected = refined.filter(c => !passing.includes(c));

  // ── Pass 5: Persist to DB + log observability events ─────────────────────
  const highlights: ContentHighlight[] = [];

  for (const c of passing) {
    const duration = c.end_time - c.start_time;
    if (duration < MIN_CLIP_SECONDS) continue;

    const signals: HighlightSignal[] = [];
    for (const raid of streamData?.raids ?? []) {
      const raidTs = typeof raid.timestamp === 'number' ? raid.timestamp : 0;
      if (raidTs >= c.start_time - 30 && raidTs <= c.end_time + 30) {
        signals.push({ type: 'raid', timestamp: raidTs, intensity: Math.min(raid.viewers / 10, 100), description: `Raid: ${raid.username} (${raid.viewers})` });
      }
    }
    for (const spike of streamData?.chatSpikes ?? []) {
      if (spike.timestamp >= c.start_time - 10 && spike.timestamp <= c.end_time + 10) {
        signals.push({ type: 'chat_spike', timestamp: spike.timestamp, intensity: spike.intensity, description: 'Chat-eksplosjon' });
      }
    }

    const { data } = await db
      .from('content_highlights')
      .insert({
        vod_id:      vodId,
        start_time:  c.start_time,
        end_time:    c.end_time,
        score:       Math.min(100, Math.max(0, Math.round(c.score))),
        category:    c.category,
        title:       c.title,
        begrunnelse: c.begrunnelse,
        signals,
        status:      'PENDING',
        clip_quality_score: c.score,
        clip_quality_entertainment: c.quality?.entertainment ?? null,
        clip_quality_emotion:       c.quality?.emotion       ?? null,
        clip_quality_surprise:      c.quality?.surprise      ?? null,
        clip_quality_viral:         c.quality?.viral_potential ?? null,
        clip_quality_story_arc:     c.quality?.story_arc     ?? false,
      })
      .select()
      .single();

    if (data) {
      highlights.push({
        id:          data.id,
        vodId,
        startTime:   c.start_time,
        endTime:     c.end_time,
        score:       c.score,
        category:    c.category as HighlightCategory,
        title:       c.title,
        begrunnelse: c.begrunnelse,
        signals:     signals.map(s => s.description),
        status:      'PENDING',
      });

      await logSystemEvent({
        source:     'content_factory',
        event_type: 'CLIP_SELECTED',
        title:      `Klipp valgt: "${c.title}" (score ${c.score})`,
        severity:   'info',
        metadata:   {
          vodId, highlightId: data.id, score: c.score, category: c.category,
          duration: c.end_time - c.start_time,
          quality: c.quality,
        },
      });
    }
  }

  // Log rejected candidates
  for (const c of rejected) {
    await logSystemEvent({
      source:     'content_factory',
      event_type: 'CLIP_REJECTED',
      title:      `Klipp forkastet: "${c.title ?? 'ukjent'}" (score ${c.score ?? 0} < ${MIN_QUALITY_SCORE})`,
      severity:   'info',
      metadata:   {
        vodId, score: c.score ?? 0, category: c.category,
        rough_start: c.rough_start, rough_end: c.rough_end,
        reason: (c.score ?? 0) < MIN_QUALITY_SCORE ? 'score_below_threshold' : 'quality_filter',
      },
    });
  }

  const durationMs = Date.now() - start;
  const scores = highlights.map(h => h.score);

  await logPipeline({
    vodId,
    step:        'DISCOVER',
    status:      'COMPLETE',
    durationMs,
    outputCount: highlights.length,
    message:     `${highlights.length} klipp valgt, ${rejected.length} forkastet. GPT-4o full-transskript analyse (${transkripter.length} segmenter).`,
  });

  await logSystemEvent({
    source:     'content_factory',
    event_type: 'HIGHLIGHTS_DISCOVERED',
    title:      `${highlights.length} highlights oppdaget for VOD ${vodId}`,
    severity:   'info',
    metadata:   {
      vodId,
      segmenterAnalysert: transkripter.length,
      highlightsFunnet:   highlights.length,
      forkastet:          rejected.length,
      avgScore:           scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      topScore:           scores.length > 0 ? Math.max(...scores) : 0,
      executionTime:      durationMs,
      model:              'gpt-4o',
    },
  });

  return highlights;
}

export async function hentHighlights(vodId: string): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from('content_highlights')
    .select('*')
    .eq('vod_id', vodId)
    .order('score', { ascending: false });
  return (data ?? []).map(r => ({
    id:           r.id,
    vodId:        r.vod_id,
    vod_id:       r.vod_id,
    startTime:    parseFloat(r.start_time) || 0,
    start_time:   parseFloat(r.start_time) || 0,
    endTime:      parseFloat(r.end_time) || 0,
    end_time:     parseFloat(r.end_time) || 0,
    score:        parseInt(r.score) || 0,
    category:     r.category,
    title:        r.title,
    begrunnelse:  r.begrunnelse,
    signals:      r.signals ?? [],
    rank:         r.rank,
    status:       r.status,
    clip_status:  r.clip_status ?? 'READY_FOR_CLIP',
    clip_url:     r.clip_url ?? null,
    vertical_clip_url: r.vertical_clip_url ?? null,
    clip_finished_at:  r.clip_finished_at ?? null,
    clip_error:        r.clip_error ?? null,
    clip_quality_score:         r.clip_quality_score ?? null,
    clip_quality_entertainment: r.clip_quality_entertainment ?? null,
    clip_quality_emotion:       r.clip_quality_emotion ?? null,
    clip_quality_surprise:      r.clip_quality_surprise ?? null,
    clip_quality_viral:         r.clip_quality_viral ?? null,
    clip_quality_story_arc:     r.clip_quality_story_arc ?? null,
  }));
}
