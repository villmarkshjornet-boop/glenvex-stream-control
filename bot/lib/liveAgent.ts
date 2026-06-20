/**
 * Live Agent V2 — Continuous AI producer loop
 *
 * Starts when stream goes LIVE, stops when stream ends.
 * Runs in three tiers:
 *   - DATA_TICK  (30s): lightweight data collection + heuristic tips
 *   - AI_TICK    (3min): GPT-4o analysis → rich tips
 *   - RAID_TICK  (5min): Twitch API + rank raid candidates
 *
 * All tips are written to live_agent_tips table (dashboard polls it).
 * All decisions are logged to system_events for full observability.
 * Each module is independently fail-safe — one crash never stops the loop.
 */

import OpenAI from 'openai';
import { getBotDb, WORKSPACE_ID } from './supabase';
import { logSystemEvent } from './systemEvents';
import { getCreatorState } from './creatorState';
import { getRecentChatLines, getChatMsgsLastMinute } from './twitchBot';
import { getStreamInfo } from '@/lib/twitch';

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA_TICK_MS      = 30_000;   // 30 seconds
const AI_TICK_MS        = 3 * 60_000; // 3 minutes
const RAID_TICK_MS      = 5 * 60_000; // 5 minutes
const TIP_TTL_MS        = 10 * 60_000; // tips expire after 10 minutes
const MAX_TIPS_PER_TICK = 2;
const CHAT_SILENT_THRESHOLD_MS = 2 * 60_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TipPayload {
  category: 'chat' | 'viewers' | 'promotion' | 'raid' | 'sponsor' | 'content' | 'general';
  message: string;
  reasoning?: string;
  priority?: number;        // 0-100
  ttlMs?: number;           // overrides default TTL
}

// ─── Module: Tip Writer ───────────────────────────────────────────────────────

async function pushTip(ws: string, streamId: string, tip: TipPayload): Promise<void> {
  const db = getBotDb();
  if (!db) return;
  const expiresAt = new Date(Date.now() + (tip.ttlMs ?? TIP_TTL_MS)).toISOString();
  const { error } = await db.from('live_agent_tips').insert({
    workspace_id: ws,
    stream_id:    streamId,
    category:     tip.category,
    message:      tip.message,
    reasoning:    tip.reasoning ?? null,
    priority:     tip.priority ?? 50,
    expires_at:   expiresAt,
    source:       'live_agent',
  });
  if (error) console.error('[LiveAgent] pushTip error:', error.message);
}

// ─── Module: AI Memory Reader ─────────────────────────────────────────────────

async function getAiMemorySummary(ws: string): Promise<string> {
  try {
    const db = getBotDb();
    if (!db) return '';
    const { data } = await db
      .from('ai_agent_memory')
      .select('memory_type, content, occurrence_count')
      .eq('workspace_id', ws)
      .order('occurrence_count', { ascending: false })
      .limit(8);
    if (!data || data.length === 0) return '';
    return data.map(m => `[${m.memory_type}] ${String(m.content).slice(0, 150)}`).join('\n');
  } catch {
    return '';
  }
}

// ─── Module: Recent Stream History ────────────────────────────────────────────

async function getStreamHistorySummary(ws: string): Promise<string> {
  try {
    const db = getBotDb();
    if (!db) return '';
    const { data } = await db
      .from('stream_history')
      .select('title, game, peak_viewers, avg_viewers, ended_at, chat_messages')
      .eq('workspace_id', ws)
      .order('ended_at', { ascending: false })
      .limit(3);
    if (!data || data.length === 0) return '';
    return data.map(s =>
      `${new Date(s.ended_at).toLocaleDateString('no-NO')}: ${s.game} — topp ${s.peak_viewers} seere, snitt ${s.avg_viewers}, ${s.chat_messages} chat-meldinger`
    ).join('\n');
  } catch {
    return '';
  }
}

// ─── Module: Duplicate Suppressor ─────────────────────────────────────────────

async function tipAlreadySentRecently(ws: string, streamId: string, category: string): Promise<boolean> {
  try {
    const db = getBotDb();
    if (!db) return false;
    const since = new Date(Date.now() - TIP_TTL_MS).toISOString();
    const { data } = await db
      .from('live_agent_tips')
      .select('id')
      .eq('workspace_id', ws)
      .eq('stream_id', streamId)
      .eq('category', category)
      .gte('created_at', since)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── Module: Heuristic Chat Check ────────────────────────────────────────────

async function runChatModule(
  ws: string, streamId: string,
  chatLines: string[], msgsPerMin: number,
  chatSilentSince: number | null,
): Promise<void> {
  const now = Date.now();

  // Silent chat: no messages for >2 minutes
  if (chatSilentSince !== null && (now - chatSilentSince) > CHAT_SILENT_THRESHOLD_MS) {
    const silentMin = Math.round((now - chatSilentSince) / 60_000);
    if (!await tipAlreadySentRecently(ws, streamId, 'chat')) {
      await pushTip(ws, streamId, {
        category: 'chat',
        message: `Chatten har vært stille i ${silentMin} min. Still et spørsmål til seerne!`,
        reasoning: `chat_silent_${silentMin}min`,
        priority: 80,
        ttlMs: 5 * 60_000,
      });
    }
    return;
  }

  // Very high chat activity — positive signal
  if (msgsPerMin > 20 && chatLines.length > 0) {
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'CHAT_SPIKE_DETECTED',
      title: `Chat-spike: ${msgsPerMin} meldinger/min`,
      severity: 'info', metadata: { msgsPerMin, streamId },
    });
  }
}

// ─── Module: Heuristic Viewer Check ──────────────────────────────────────────

async function runViewerModule(
  ws: string, streamId: string,
  current: number, previous: number,
): Promise<void> {
  if (previous <= 0 || current <= 0) return;
  const changePct = ((current - previous) / previous) * 100;

  if (changePct <= -15) {
    const drop = Math.abs(Math.round(changePct));
    if (!await tipAlreadySentRecently(ws, streamId, 'viewers')) {
      await pushTip(ws, streamId, {
        category: 'viewers',
        message: `Seertallet falt ${drop}% (${previous}→${current}). Vurder å bytte aktivitet eller snakk til chat.`,
        reasoning: `viewer_drop_${drop}pct`,
        priority: 85,
        ttlMs: 6 * 60_000,
      });
    }
  } else if (changePct >= 20) {
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'VIEWERS_GROWING',
      title: `Seere vokser: +${Math.round(changePct)}% (${previous}→${current})`,
      severity: 'info', metadata: { current, previous, changePct, streamId },
    });
  }
}

// ─── Module: Duration-based tips ─────────────────────────────────────────────

async function runDurationModule(
  ws: string, streamId: string, durationMin: number,
): Promise<void> {
  // Sponsor reminder at 45 min mark
  if (durationMin >= 43 && durationMin <= 47) {
    if (!await tipAlreadySentRecently(ws, streamId, 'sponsor')) {
      await pushTip(ws, streamId, {
        category: 'sponsor',
        message: 'Husk sponsoromtale de neste 5 minuttene (45-minutters punkt).',
        reasoning: 'duration_45min_sponsor_reminder',
        priority: 75,
        ttlMs: 8 * 60_000,
      });
    }
  }

  // Raid prep: 90 minutes in, start thinking about raid
  if (durationMin >= 88 && durationMin <= 92) {
    if (!await tipAlreadySentRecently(ws, streamId, 'raid')) {
      await pushTip(ws, streamId, {
        category: 'raid',
        message: 'Raid-vinduet nærmer seg. Sjekk Raid Manager for gode kandidater.',
        reasoning: 'duration_90min_raid_prep',
        priority: 70,
        ttlMs: 15 * 60_000,
      });
    }
  }
}

// ─── Module: AI Analysis ──────────────────────────────────────────────────────

async function runAiAnalysis(
  ws: string, streamId: string,
  state: ReturnType<typeof getCreatorState>,
  chatLines: string[],
  msgsPerMin: number,
  aiMemory: string,
  streamHistory: string,
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const openai = new OpenAI({ apiKey });
  const { game, title, viewerCount, viewerPeak, durationMin, phase } = state.stream;

  const systemPrompt = `Du er GLENVEX AI-produsent. Du hjelper en live-streamer i sanntid.
Analyser situasjonen og generer ${MAX_TIPS_PER_TICK} konkrete og handlingsklare råd.
Hvert råd skal være på norsk, maks 120 tegn, og direkte nyttig akkurat NÅ.
Fokuser på hva streameren bør gjøre neste 5-10 minutter.
Svar alltid i dette JSON-formatet:
{"tips":[{"category":"chat|viewers|promotion|raid|sponsor|content|general","message":"Rådet her","reasoning":"Kort intern begrunnelse","priority":70}]}`;

  const userPrompt = `STREAM-STATUS:
Spill: ${game ?? 'ukjent'}
Tittel: ${title ?? 'ukjent'}
Seere nå: ${viewerCount ?? 0} (topp: ${viewerPeak ?? 0})
Varighet: ${durationMin ?? 0} min (fase: ${phase ?? 'ukjent'})
Chat-aktivitet: ${msgsPerMin} meldinger/min

SISTE CHAT (siste 20 linjer):
${chatLines.slice(-20).join('\n') || '(ingen)'}

AI HUKOMMELSE (pattern fra tidligere streams):
${aiMemory || '(ingen)'}

SISTE STREAMS:
${streamHistory || '(ingen)'}

Generer ${MAX_TIPS_PER_TICK} råd basert på denne konteksten.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.7,
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const tips: any[] = parsed.tips ?? [];

    let pushed = 0;
    for (const tip of tips.slice(0, MAX_TIPS_PER_TICK)) {
      if (!tip.message) continue;
      if (await tipAlreadySentRecently(ws, streamId, tip.category ?? 'general')) continue;
      await pushTip(ws, streamId, {
        category: tip.category ?? 'general',
        message:  String(tip.message).slice(0, 200),
        reasoning: tip.reasoning ?? null,
        priority: typeof tip.priority === 'number' ? Math.min(100, Math.max(0, tip.priority)) : 60,
        ttlMs: 8 * 60_000,
      });
      pushed++;
    }

    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'AI_TICK_COMPLETED',
      title: `AI-analyse: ${pushed} tips generert (${game}, ${viewerCount ?? 0} seere)`,
      severity: 'info',
      metadata: { streamId, pushed, game, viewerCount, durationMin, phase, msgsPerMin },
    });

  } catch (err: any) {
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'AI_TICK_FAILED',
      title: `AI-analyse feilet: ${err.message?.slice(0, 100)}`,
      severity: 'error', metadata: { streamId, error: err.message },
    });
  }
}

// ─── Module: Raid Evaluator ───────────────────────────────────────────────────

async function runRaidEvaluator(
  ws: string, streamId: string,
  twitchLogin: string, game: string | null, currentViewers: number,
): Promise<void> {
  if (!game || currentViewers <= 0) return;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const accessToken = process.env.TWITCH_ACCESS_TOKEN;
  if (!clientId || !accessToken) return;

  try {
    // Fetch streams in same game
    const gameRes = await fetch(
      `https://api.twitch.tv/helix/games?name=${encodeURIComponent(game)}`,
      { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${accessToken}` } }
    );
    const gameData = await gameRes.json() as any;
    const gameId = gameData.data?.[0]?.id;
    if (!gameId) return;

    const streamsRes = await fetch(
      `https://api.twitch.tv/helix/streams?game_id=${gameId}&first=20&language=no`,
      { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${accessToken}` } }
    );
    const streamsData = await streamsRes.json() as any;
    const candidates: any[] = (streamsData.data ?? [])
      .filter((s: any) =>
        s.user_login?.toLowerCase() !== twitchLogin.toLowerCase() &&
        s.viewer_count >= currentViewers * 0.1 &&
        s.viewer_count <= currentViewers * 6
      )
      .sort((a: any, b: any) => b.viewer_count - a.viewer_count)
      .slice(0, 5);

    if (candidates.length === 0) {
      // Fallback: English streams
      const fallbackRes = await fetch(
        `https://api.twitch.tv/helix/streams?game_id=${gameId}&first=20`,
        { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${accessToken}` } }
      );
      const fallback = await fallbackRes.json() as any;
      const intl = (fallback.data ?? [])
        .filter((s: any) =>
          s.user_login?.toLowerCase() !== twitchLogin.toLowerCase() &&
          s.viewer_count >= currentViewers * 0.2 &&
          s.viewer_count <= currentViewers * 5
        )
        .sort((a: any, b: any) => b.viewer_count - a.viewer_count)
        .slice(0, 3);
      candidates.push(...intl);
    }

    if (candidates.length === 0) return;

    const best = candidates[0];
    const already = await tipAlreadySentRecently(ws, streamId, 'raid');

    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'RAID_EVALUATION_COMPLETED',
      title: `Raid: ${candidates.length} kandidater funnet — beste: ${best.user_name} (${best.viewer_count} seere)`,
      severity: 'info',
      metadata: { streamId, candidateCount: candidates.length, bestCandidate: best.user_name, bestViewers: best.viewer_count, game },
    });

    if (!already) {
      await pushTip(ws, streamId, {
        category: 'raid',
        message: `Raid-kandidat: ${best.user_name} (${best.viewer_count} seere, ${game}). ${candidates.length} alternativer klare.`,
        reasoning: `raid_eval_${candidates.length}_candidates`,
        priority: 65,
        ttlMs: 15 * 60_000,
      });
    }

  } catch (err: any) {
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'RAID_EVALUATION_FAILED',
      title: `Raid-evaluering feilet: ${err.message?.slice(0, 80)}`,
      severity: 'warning', metadata: { streamId, error: err.message },
    });
  }
}

// ─── Live Agent Class ─────────────────────────────────────────────────────────

export class LiveAgent {
  private ws: string;
  private streamId: string;
  private twitchLogin: string;

  private stopped = false;
  private dataTickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAiTickAt = 0;
  private lastRaidTickAt = 0;

  // Viewer history for trend detection
  private viewerHistory: number[] = [];

  // Chat silence tracking
  private lastChatMsgAt: number = Date.now();
  private lastChatCount  = 0;

  // Error counters for fail-safe logging
  private errorCounts: Record<string, number> = {};

  constructor(streamId: string, twitchLogin: string, workspaceId?: string) {
    this.streamId    = streamId;
    this.twitchLogin = twitchLogin;
    this.ws          = workspaceId ?? WORKSPACE_ID;
  }

  start(): void {
    if (!this.stopped) this.scheduleNextTick();

    logSystemEvent({
      workspaceId: this.ws, source: 'live_agent', event_type: 'LIVE_AGENT_STARTED',
      title: `Live Agent V2 startet for stream ${this.streamId}`,
      severity: 'info', metadata: { streamId: this.streamId, twitchLogin: this.twitchLogin },
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.dataTickTimer) clearTimeout(this.dataTickTimer);
    this.dataTickTimer = null;

    logSystemEvent({
      workspaceId: this.ws, source: 'live_agent', event_type: 'LIVE_AGENT_STOPPED',
      title: `Live Agent V2 stoppet`,
      severity: 'info', metadata: { streamId: this.streamId },
    });
  }

  private scheduleNextTick(): void {
    if (this.stopped) return;
    this.dataTickTimer = setTimeout(() => {
      this.tick().catch(err => {
        console.error('[LiveAgent] tick error:', err?.message);
      }).finally(() => {
        if (!this.stopped) this.scheduleNextTick();
      });
    }, DATA_TICK_MS);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    const ws       = this.ws;
    const streamId = this.streamId;
    const now      = Date.now();

    // ── Collect data ──────────────────────────────────────────────────────────
    const state     = getCreatorState(ws);
    if (!state.stream.isLive) {
      // Stream ended externally — self-stop
      this.stop();
      return;
    }

    const chatLines   = getRecentChatLines();
    const msgsPerMin  = getChatMsgsLastMinute();
    const viewerCount = state.stream.viewerCount ?? 0;
    const prevViewers = this.viewerHistory[this.viewerHistory.length - 1] ?? 0;

    // Update viewer history (keep last 10 readings)
    this.viewerHistory.push(viewerCount);
    if (this.viewerHistory.length > 10) this.viewerHistory.shift();

    // Track chat silence
    if (msgsPerMin > 0 || chatLines.length > this.lastChatCount) {
      this.lastChatMsgAt = now;
    }
    this.lastChatCount = chatLines.length;

    const chatSilentSince = msgsPerMin === 0 ? this.lastChatMsgAt : null;

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'LIVE_AGENT_HEARTBEAT',
      title: `Live Agent tick — ${viewerCount} seere, ${msgsPerMin} msgs/min`,
      severity: 'info',
      metadata: {
        streamId, viewerCount, msgsPerMin, chatLines: chatLines.length,
        durationMin: state.stream.durationMin, phase: state.stream.phase,
      },
    });

    // ── Module: Chat ──────────────────────────────────────────────────────────
    await this.runSafe('chat', () =>
      runChatModule(ws, streamId, chatLines, msgsPerMin, chatSilentSince)
    );

    // ── Module: Viewers ────────────────────────────────────────────────────────
    await this.runSafe('viewers', () =>
      runViewerModule(ws, streamId, viewerCount, prevViewers)
    );

    // ── Module: Duration-based tips ────────────────────────────────────────────
    const durationMin = state.stream.durationMin ?? 0;
    await this.runSafe('duration', () =>
      runDurationModule(ws, streamId, durationMin)
    );

    // ── Module: AI Analysis (every 3 min) ─────────────────────────────────────
    if (now - this.lastAiTickAt >= AI_TICK_MS) {
      this.lastAiTickAt = now;
      const [aiMemory, streamHistory] = await Promise.all([
        getAiMemorySummary(ws).catch(() => ''),
        getStreamHistorySummary(ws).catch(() => ''),
      ]);
      await this.runSafe('ai_analysis', () =>
        runAiAnalysis(ws, streamId, state, chatLines, msgsPerMin, aiMemory, streamHistory)
      );
    }

    // ── Module: Raid Evaluator (every 5 min) ──────────────────────────────────
    if (now - this.lastRaidTickAt >= RAID_TICK_MS) {
      this.lastRaidTickAt = now;
      await this.runSafe('raid', () =>
        runRaidEvaluator(ws, streamId, this.twitchLogin, state.stream.game, viewerCount)
      );
    }
  }

  // Wraps any module in fail-safe: logs error, never throws, counts failures
  private async runSafe(module: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.errorCounts[module] = 0;
    } catch (err: any) {
      const count = (this.errorCounts[module] ?? 0) + 1;
      this.errorCounts[module] = count;
      console.error(`[LiveAgent:${module}] feil (x${count}):`, err?.message);
      if (count === 1 || count % 5 === 0) {
        logSystemEvent({
          workspaceId: this.ws, source: 'live_agent',
          event_type: 'LIVE_AGENT_MODULE_ERROR',
          title: `Live Agent modul feilet: ${module} (x${count})`,
          severity: count >= 5 ? 'error' : 'warning',
          metadata: { module, errorCount: count, error: err?.message?.slice(0, 200), streamId: this.streamId },
        });
      }
    }
  }
}

// ─── Singleton manager ────────────────────────────────────────────────────────
// Ensures only one agent runs per workspace. Safe to call multiple times.

let _activeAgent: LiveAgent | null = null;

export function startLiveAgent(streamId: string, twitchLogin: string, workspaceId?: string): void {
  if (_activeAgent) {
    _activeAgent.stop();
    _activeAgent = null;
  }
  _activeAgent = new LiveAgent(streamId, twitchLogin, workspaceId);
  _activeAgent.start();
}

export function stopLiveAgent(): void {
  if (_activeAgent) {
    _activeAgent.stop();
    _activeAgent = null;
  }
}
