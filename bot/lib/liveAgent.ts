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
import { getAppAccessToken } from '@/lib/twitch';

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
      .select('memory_type, content, summary, occurrence_count')
      .eq('workspace_id', ws)
      .order('occurrence_count', { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return '';
    return data.map(m =>
      `[${m.memory_type}] ${String(m.summary ?? m.content).slice(0, 180)} (observert ${m.occurrence_count}x)`
    ).join('\n');
  } catch {
    return '';
  }
}

// ─── Module: Stream History ────────────────────────────────────────────────────

async function getStreamHistorySummary(ws: string): Promise<string> {
  try {
    const db = getBotDb();
    if (!db) return '';
    const { data } = await db
      .from('stream_history')
      .select('title, game, peak_viewers, avg_viewers, ended_at, chat_messages, retention_pct')
      .eq('workspace_id', ws)
      .order('ended_at', { ascending: false })
      .limit(5);
    if (!data || data.length === 0) return '';
    return data.map(s => {
      const date = new Date(s.ended_at).toLocaleDateString('no-NO');
      const ret  = s.retention_pct != null ? `, ${Math.round(s.retention_pct)}% retention` : '';
      return `${date}: ${s.game} — topp ${s.peak_viewers ?? 0} seere, snitt ${s.avg_viewers ?? 0}, ${s.chat_messages ?? 0} chat${ret}`;
    }).join('\n');
  } catch {
    return '';
  }
}

// ─── Module: Game Pattern Analyser ────────────────────────────────────────────
// All comparisons computed here. GPT may only reference numbers returned by this function.

async function getGamePatterns(
  ws: string,
  currentGame: string | null,
  currentViewers: number | null,
): Promise<string> {
  try {
    const db = getBotDb();
    if (!db) return '';
    const { data } = await db
      .from('stream_history')
      .select('game, peak_viewers, avg_viewers, chat_messages, retention_pct')
      .eq('workspace_id', ws)
      .order('ended_at', { ascending: false })
      .limit(20);
    if (!data || data.length < 3) return '(for lite data — under 3 streams totalt, Confidence: lav)';

    const byGame: Record<string, { peaks: number[]; avgs: number[]; chats: number[]; retentions: number[] }> = {};
    for (const s of data) {
      const g = s.game ?? 'Ukjent';
      if (!byGame[g]) byGame[g] = { peaks: [], avgs: [], chats: [], retentions: [] };
      if (s.peak_viewers)          byGame[g].peaks.push(s.peak_viewers);
      if (s.avg_viewers)           byGame[g].avgs.push(s.avg_viewers);
      if (s.chat_messages)         byGame[g].chats.push(s.chat_messages);
      if (s.retention_pct != null) byGame[g].retentions.push(s.retention_pct);
    }

    const avgOf = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const conf = (n: number) => n >= 5 ? 'høy' : n >= 3 ? 'middels' : 'lav';

    const lines: string[] = [];
    lines.push('=== BEREGNET SPILLSTATISTIKK — BRUK BARE DISSE TALLENE, ALDRI EGNE ===');

    // Per-game rows
    const games = Object.entries(byGame)
      .filter(([, v]) => v.avgs.length >= 2)
      .sort(([, a], [, b]) => b.avgs.length - a.avgs.length);

    for (const [game, v] of games) {
      const retStr = v.retentions.length >= 2
        ? `, ${avgOf(v.retentions)}% retention`
        : ', retention: for lite data';
      lines.push(
        `${game} (${v.avgs.length} streams, tillit: ${conf(v.avgs.length)}): snitt ${avgOf(v.avgs)} seere, ${avgOf(v.chats)} chat/stream${retStr}`,
      );
    }

    // Best-of — only include facts with sufficient data
    lines.push('');
    lines.push('BESTE SPILL (beregnet i kode):');
    const bestRet = games
      .filter(([, v]) => v.retentions.length >= 3)
      .sort(([, a], [, b]) => avgOf(b.retentions) - avgOf(a.retentions))[0];
    if (bestRet) {
      const [g, v] = bestRet;
      lines.push(`  Høyest retention: ${g} — ${avgOf(v.retentions)}% (${v.retentions.length} streams, tillit: ${conf(v.retentions.length)})`);
    } else {
      lines.push('  Høyest retention: for lite data (min 3 streams per spill)');
    }

    const bestView = games.sort(([, a], [, b]) => avgOf(b.avgs) - avgOf(a.avgs))[0];
    if (bestView) {
      const [g, v] = bestView;
      lines.push(`  Flest seere: ${g} — snitt ${avgOf(v.avgs)} (${v.avgs.length} streams, tillit: ${conf(v.avgs.length)})`);
    }

    const bestChat = games.sort(([, a], [, b]) => avgOf(b.chats) - avgOf(a.chats))[0];
    if (bestChat) {
      const [g, v] = bestChat;
      lines.push(`  Mest chat: ${g} — snitt ${avgOf(v.chats)} meldinger/stream (${v.chats.length} streams)`);
    }

    // Cross-game retention diff — only when we have 2+ games with enough retention data
    const withRet = games.filter(([, v]) => v.retentions.length >= 2);
    if (withRet.length >= 2) {
      const sorted = [...withRet].sort(([, a], [, b]) => avgOf(b.retentions) - avgOf(a.retentions));
      const [bestG, bestV] = sorted[0];
      const [worstG, worstV] = sorted[sorted.length - 1];
      const diff = avgOf(bestV.retentions) - avgOf(worstV.retentions);
      lines.push(`  ${bestG} gir ${diff}% høyere retention enn ${worstG} (${avgOf(bestV.retentions)}% vs ${avgOf(worstV.retentions)}%) — beregnet`);
    }

    // Current game vs historical average — most important comparison
    lines.push('');
    if (currentGame && byGame[currentGame] && byGame[currentGame].avgs.length >= 2) {
      const hist = byGame[currentGame];
      const histAvg = avgOf(hist.avgs);
      const diff    = currentViewers != null ? currentViewers - histAvg : null;
      const sign    = diff != null ? (diff >= 0 ? '+' : '') : '';
      const pctStr  = diff != null && histAvg > 0
        ? ` (${sign}${Math.round((diff / histAvg) * 100)}% fra snitt)`
        : '';
      lines.push(`NÅVÆRENDE vs. HISTORISK (${currentGame}):`);
      if (diff != null) {
        lines.push(`  Seere nå: ${currentViewers} — historisk snitt: ${histAvg} → ${sign}${diff}${pctStr}`);
      } else {
        lines.push(`  Historisk snitt for ${currentGame}: ${histAvg} seere`);
      }
      if (hist.retentions.length >= 2) {
        lines.push(`  Historisk retention for ${currentGame}: ${avgOf(hist.retentions)}% snitt`);
      }
    } else if (currentGame) {
      lines.push(`${currentGame}: for lite data for direkte sammenligning (min 2 streams kreves)`);
    }

    lines.push('');
    lines.push('REGEL: Presenter IKKE tall eller prosenter som ikke er oppgitt ovenfor.');
    lines.push('Hvis tillit er "lav" — bruk "for lite historikk" og "Confidence: lav" i reasoning-feltet.');
    lines.push('=== SLUTT STATISTIKK ===');

    return lines.join('\n');
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

interface LastTickContext {
  viewerCount: number;
  chatRate: number;
  tipCategory: string | null;
  tipMessage: string | null;
  sentAt: number;
}

async function runAiAnalysis(
  ws: string, streamId: string,
  state: ReturnType<typeof getCreatorState>,
  chatLines: string[],
  msgsPerMin: number,
  aiMemory: string,
  streamHistory: string,
  lastCtx: LastTickContext | null,
): Promise<TipPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const { game, title, viewerCount, viewerPeak, durationMin, phase } = state.stream;

  // Pre-compute game patterns here so we can pass current context
  const gamePatterns = await getGamePatterns(ws, game ?? null, viewerCount ?? null).catch(() => '');

  // ── Self-evaluation block — all deltas computed in code, not by GPT ──────────
  const minutesSinceLast = lastCtx
    ? Math.round((Date.now() - lastCtx.sentAt) / 60_000) : 0;
  const viewerNow    = viewerCount ?? 0;
  const viewerDelta  = lastCtx ? viewerNow - lastCtx.viewerCount : 0;
  const viewerPct    = lastCtx && lastCtx.viewerCount > 0
    ? Math.round((viewerDelta / lastCtx.viewerCount) * 100) : 0;
  const chatDelta    = lastCtx ? msgsPerMin - lastCtx.chatRate : 0;
  const chatPct      = lastCtx && lastCtx.chatRate > 0
    ? Math.round((chatDelta / lastCtx.chatRate) * 100) : null;
  const vSign        = viewerDelta >= 0 ? '+' : '';
  const cSign        = chatDelta   >= 0 ? '+' : '';

  const indication = !lastCtx?.tipMessage ? null :
    viewerPct >  5  ? 'KLAR POSITIV EFFEKT — seertallet økte merkbart' :
    viewerPct < -10 ? 'NEGATIV EFFEKT — seertallet falt, vurder å endre fokus' :
    chatPct != null && chatPct >  30 ? 'KLAR POSITIV EFFEKT — chat-aktiviteten økte markant' :
    chatPct != null && chatPct < -30 ? 'NØYTRAL/NEGATIV — chat-aktiviteten falt' :
    'USIKKER EFFEKT — for lite endring til å konkludere';

  const selfEval = !lastCtx?.tipMessage
    ? '(første analyse denne streamen)'
    : [
        `Forrige råd (${minutesSinceLast} min siden): "${lastCtx.tipMessage}" [${lastCtx.tipCategory}]`,
        `Seere: ${lastCtx.viewerCount} → ${viewerNow} (${vSign}${viewerDelta}, ${vSign}${viewerPct}%)`,
        `Chat: ${lastCtx.chatRate} → ${msgsPerMin} msgs/min (${cSign}${chatDelta}${chatPct != null ? `, ${cSign}${chatPct}%` : ''})`,
        `Konklusjon: ${indication}`,
      ].join('\n');

  const systemPrompt = `Du er GLENVEX AI-produsent — en senior streaming-konsulent som kjenner kanalen til bunns.

DIN ROLLE:
Du er en mentor, ikke en notis-generator. Du tenker, velger og forklarer.

VIKTIG — DATATILLIT:
Du har KUN LOV til å bruke tall og prosentandeler som er oppgitt i BEREGNET STATISTIKK nedenfor.
Finn ALDRI opp prosentandeler, snitt, retention-tall eller effektvurderinger som ikke er eksplisitt oppgitt.
Hvis statistikken sier "for lite data" eller "tillit: lav" — bruk ALLTID "for lite historikk" og "Confidence: lav" i reasoning.
Bruk aldri fraser som "X% bedre" eller "økte med Y%" med egne beregnede tall.

REGLER:
1. EVALUER forrige anbefaling eksplisitt — se self-eval-blokken, bruk kun tallene der
2. TREKK TILBAKE råd hvis Konklusjon er NEGATIV EFFEKT eller USIKKER EFFEKT
3. BRUK personlig stemme: "Du pleier å...", "For deg fungerer...", "Basert på dine X streams..."
4. UTFORDRE ANTAKELSER hvis statistikken viser noe overraskende
5. VÆR ÆRLIG: skriv "Confidence: lav" i reasoning hvis datagrunnlaget er tynt
6. PRIORITER langsiktig kanalvekst, ikke kortsiktige tall
7. MAKSIMALT ${MAX_TIPS_PER_TICK} råd

FORMAT (JSON kun):
{"tips":[
  {
    "category":"chat|viewers|promotion|raid|sponsor|content|general",
    "message":"Personlig råd maks 140 tegn — bruk 'du', ikke 'man'",
    "reasoning":"Hva data viser + self-eval av forrige råd + confidence-nivå + forventet effekt",
    "priority":75
  }
]}`;

  const userPrompt = `SITUASJON NÅ:
Spill: ${game ?? 'ukjent'} | Tittel: ${title ?? 'ukjent'}
Seere: ${viewerNow} (topp: ${viewerPeak ?? 0}) | Varighet: ${durationMin ?? 0} min | Fase: ${phase ?? 'ukjent'}
Chat: ${msgsPerMin} meldinger/min

SELF-EVALUATION (forrige anbefaling — tall beregnet i kode):
${selfEval}

SISTE CHAT (20 linjer):
${chatLines.slice(-20).join('\n') || '(ingen chat-aktivitet)'}

KANALENS PERSONLIGE HISTORIKK (AI Memory):
${aiMemory || '(ingen historikk ennå — mark confidence som lav)'}

${gamePatterns || 'SPILLSTATISTIKK: (ingen data ennå)'}

SISTE STREAMS:
${streamHistory || '(ingen)'}

Generer ${MAX_TIPS_PER_TICK} råd. Bruk alltid personlig stemme. Evaluer forrige råd eksplisitt. Bruk BARE tall fra statistikken ovenfor.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      temperature: 0.65,
    });

    const raw    = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const tips: any[] = parsed.tips ?? [];

    let pushed     = 0;
    let firstTip: TipPayload | null = null;
    for (const tip of tips.slice(0, MAX_TIPS_PER_TICK)) {
      if (!tip.message) continue;
      if (await tipAlreadySentRecently(ws, streamId, tip.category ?? 'general')) continue;
      const payload: TipPayload = {
        category:  tip.category ?? 'general',
        message:   String(tip.message).slice(0, 200),
        reasoning: tip.reasoning ? String(tip.reasoning).slice(0, 500) : undefined,
        priority:  typeof tip.priority === 'number' ? Math.min(100, Math.max(0, tip.priority)) : 60,
        ttlMs:     8 * 60_000,
      };
      await pushTip(ws, streamId, payload);
      if (!firstTip) firstTip = payload;
      pushed++;
    }

    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'AI_TICK_COMPLETED',
      title: `AI-analyse: ${pushed} tips (${game}, ${viewerCount ?? 0} seere, self-eval: ${selfEval.split('\n')[3]?.slice(13, 40) ?? 'n/a'})`,
      severity: 'info',
      metadata: { streamId, pushed, game, viewerCount, durationMin, phase, msgsPerMin, selfEvalIndication: selfEval.split('\n')[3] ?? null },
    });

    return firstTip;

  } catch (err: any) {
    logSystemEvent({
      workspaceId: ws, source: 'live_agent', event_type: 'AI_TICK_FAILED',
      title: `AI-analyse feilet: ${err.message?.slice(0, 100)}`,
      severity: 'error', metadata: { streamId, error: err.message },
    });
    return null;
  }
}

// ─── Module: Raid Evaluator ───────────────────────────────────────────────────

async function runRaidEvaluator(
  ws: string, streamId: string,
  twitchLogin: string, game: string | null, currentViewers: number,
): Promise<void> {
  if (!game || currentViewers <= 0) return;

  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return;

  try {
    // Use app access token (client credentials) — never expires during a stream session
    const accessToken = await getAppAccessToken();

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
      // Fallback: international streams in same game
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

  // Self-evaluation context — updated after each successful AI tick
  private lastAiCtx: LastTickContext | null = null;

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
      const capturedCtx = this.lastAiCtx;
      const [aiMemory, streamHistory] = await Promise.all([
        getAiMemorySummary(ws).catch(() => ''),
        getStreamHistorySummary(ws).catch(() => ''),
      ]);
      // Run directly (not through runSafe) to capture the returned tip for self-evaluation
      try {
        const firstTip = await runAiAnalysis(
          ws, streamId, state, chatLines, msgsPerMin,
          aiMemory, streamHistory, capturedCtx
        );
        this.errorCounts['ai_analysis'] = 0;
        if (firstTip) {
          this.lastAiCtx = {
            viewerCount:  viewerCount,
            chatRate:     msgsPerMin,
            tipCategory:  firstTip.category,
            tipMessage:   firstTip.message,
            sentAt:       now,
          };
        }
      } catch (err: any) {
        const count = (this.errorCounts['ai_analysis'] ?? 0) + 1;
        this.errorCounts['ai_analysis'] = count;
        console.error('[LiveAgent:ai_analysis] feil:', err?.message);
        if (count === 1 || count % 5 === 0) {
          logSystemEvent({
            workspaceId: ws, source: 'live_agent', event_type: 'LIVE_AGENT_MODULE_ERROR',
            title: `Live Agent modul feilet: ai_analysis (x${count})`,
            severity: count >= 5 ? 'error' : 'warning',
            metadata: { module: 'ai_analysis', errorCount: count, error: err?.message?.slice(0, 200), streamId },
          });
        }
      }
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
