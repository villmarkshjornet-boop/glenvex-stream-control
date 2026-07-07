/**
 * 15-minutters batch-aggregering — V2
 *
 * Leser siste hendelser → ett GPT-kall (10-kategori-analyse) → oppdaterer
 * ai_agent_memory (med memory_category) + ai_agent_insights.
 * Kjøres hvert 15. min via setInterval.
 *
 * V2-forbedringer:
 * - 10 lærings-kategorier i GPT-prompt (COMMUNITY, INTERESTS, STREAM, CREATOR,
 *   DISCORD, TWITCH, ECONOMY, PARTNER, HUMOR, GENERAL)
 * - memory_category satt på alle upserts
 * - Bedre kryss-plattform-matching: exact username (0.75), linked_account (0.98),
 *   similar_username edit-distance ≤ 2 (0.45)
 * - Decay-pass hvert 6. kjøring (~90 min): reduserer strength, sletter utdaterte minner
 * - LEARNING_CYCLE_COMPLETED event etter hver kjøring
 */

import { upsertBotMemory } from './agentLogger';
import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';
let lastRun = 0;
let lastFeedbackRun = 0;
let aggrRunCount = 0;

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GptObservation {
  key?: string;
  observation?: string;
  confidence?: number;
  source?: string;
}

interface GptSeer {
  username?: string;
  hvorfor?: string;
  source?: string;
}

interface GptInnsikt {
  tittel?: string;
  sammendrag?: string;
  confidence?: number;
}

interface GptAnalyse {
  COMMUNITY?: GptObservation[];
  INTERESTS?: GptObservation[];
  STREAM?: GptObservation[];
  CREATOR?: GptObservation[];
  DISCORD?: GptObservation[];
  TWITCH?: GptObservation[];
  ECONOMY?: GptObservation[];
  PARTNER?: GptObservation[];
  HUMOR?: GptObservation[];
  GENERAL?: GptObservation[];
  aktiveSeere?: GptSeer[];
  innsikter?: GptInnsikt[];
}

interface CrossPlatformCandidate {
  twitchUsername: string;
  discordUsername: string;
  confidence: number;
  matchMethod: string;
  twitchUserId?: string;
  discordUserId?: string;
}

const ANALYSIS_CATEGORIES = [
  'COMMUNITY', 'INTERESTS', 'STREAM', 'CREATOR',
  'DISCORD', 'TWITCH', 'ECONOMY', 'PARTNER', 'HUMOR', 'GENERAL',
] as const;
type AnalysisCategory = typeof ANALYSIS_CATEGORIES[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Levenshtein edit distance for similar-username matching. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Maps a GPT analysis category to the memory_category column value. */
function categoryToMemoryCategory(cat: AnalysisCategory): string {
  const MAP: Record<AnalysisCategory, string> = {
    COMMUNITY: 'community',
    INTERESTS: 'interests',
    STREAM:    'stream',
    CREATOR:   'stream',
    DISCORD:   'discord',
    TWITCH:    'twitch',
    ECONOMY:   'economy',
    PARTNER:   'partner',
    HUMOR:     'humor',
    GENERAL:   'general',
  };
  return MAP[cat];
}

/** Maps a GPT analysis category + source to agent_type and memory_type. */
function categoryToTypes(cat: AnalysisCategory, source: string): { agent_type: string; memory_type: string } {
  const isDiscord = source === 'discord' || cat === 'DISCORD';
  const agent_type = isDiscord ? 'discord' : 'twitch';
  const MEMORY_TYPE_MAP: Record<AnalysisCategory, string> = {
    COMMUNITY: 'viewer',
    INTERESTS: 'topic',
    STREAM:    'stream_pattern',
    CREATOR:   'creator_insight',
    DISCORD:   'channel_pattern',
    TWITCH:    'stream_event',
    ECONOMY:   'economy_pattern',
    PARTNER:   'partner_signal',
    HUMOR:     'joke',
    GENERAL:   'observation',
  };
  let memory_type = MEMORY_TYPE_MAP[cat];
  if (cat === 'COMMUNITY' && isDiscord) memory_type = 'member';
  return { agent_type, memory_type };
}

// ─── Cross-platform match upsert ─────────────────────────────────────────────

async function upsertCrossPlatformMatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  twitchUsername: string,
  discordUsername: string,
  confidence: number,
  matchMethod: string,
  twitchUserId?: string,
  discordUserId?: string,
): Promise<void> {
  try {
    const { data: existing } = await sb
      .from('cross_platform_users')
      .select('id,confidence_score,match_status')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('twitch_username', twitchUsername)
      .eq('discord_username', discordUsername)
      .maybeSingle();

    const now = new Date().toISOString();
    const newConfidence = Math.min(1.0, confidence);

    if (existing) {
      const update: Record<string, unknown> = { last_seen_at: now, updated_at: now };
      const isHigher = newConfidence > ((existing.confidence_score as number | null) ?? 0);
      if (isHigher) {
        update['confidence_score']  = newConfidence;
        update['match_method']      = matchMethod;
        update['last_confirmed_at'] = now;
      }
      if (twitchUserId)  update['twitch_user_id']  = twitchUserId;
      if (discordUserId) update['discord_user_id'] = discordUserId;
      await sb.from('cross_platform_users').update(update).eq('id', existing.id);
      return;
    }

    const insertRow: Record<string, unknown> = {
      workspace_id:      WORKSPACE_ID,
      twitch_username:   twitchUsername,
      discord_username:  discordUsername,
      display_name:      twitchUsername,
      platform_sources:  ['twitch', 'discord'],
      confidence_score:  newConfidence,
      match_status:      'pending',
      match_method:      matchMethod,
      match_notes:       `Auto: ${matchMethod} (confidence ${Math.round(newConfidence * 100)}%)`,
      last_confirmed_at: now,
    };
    if (twitchUserId)  insertRow['twitch_user_id']  = twitchUserId;
    if (discordUserId) insertRow['discord_user_id'] = discordUserId;
    await sb.from('cross_platform_users').insert(insertRow);
    console.log(`[CrossPlatform] Ny match (${matchMethod}): ${twitchUsername} ↔ ${discordUsername} (${Math.round(newConfidence * 100)}%)`);
  } catch {}
}

// ─── Decay pass (runs every 6th aggregation cycle ≈ every 90 min) ────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runDecayPass(sb: any): Promise<{ decayed: number; deleted: number }> {
  const cutoff23h = new Date(Date.now() - 23 * 3600_000).toISOString();
  const cutoff60d = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();

  const { data: rows, error } = await sb
    .from('ai_agent_memory')
    .select('id,strength,decay_rate,occurrence_count,last_seen_at')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('locked', false)
    .or('admin_approved.is.null,admin_approved.eq.true')
    .or(`last_decayed_at.is.null,last_decayed_at.lt.${cutoff23h}`)
    .limit(500);

  if (error || !rows || rows.length === 0) {
    return { decayed: 0, deleted: 0 };
  }

  let decayed = 0;
  let deleted = 0;
  const now = new Date().toISOString();

  for (const row of rows as Record<string, unknown>[]) {
    const strength   = (row['strength']         as number | null) ?? 1.0;
    const decayRate  = (row['decay_rate']        as number | null) ?? 0.05;
    const occCount   = (row['occurrence_count']  as number | null) ?? 1;
    const lastSeen   = (row['last_seen_at']      as string | null) ?? cutoff60d;
    const newStrength = Math.max(0.0, strength - decayRate);

    if (newStrength < 0.05 && occCount < 3 && lastSeen < cutoff60d) {
      await sb.from('ai_agent_memory').delete().eq('id', row['id']);
      deleted++;
    } else {
      await sb.from('ai_agent_memory')
        .update({ strength: newStrength, last_decayed_at: now })
        .eq('id', row['id']);
      decayed++;
    }
  }

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'MEMORY_DECAY_COMPLETED',
    title: `Memory decay: ${decayed} oppdatert, ${deleted} slettet`,
    severity: 'info',
    metadata: { decayed, deleted, total: (rows as unknown[]).length },
  });

  return { decayed, deleted };
}

// ─── Feedback-loop fra ai_agent_decisions ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aggregerDecisionFeedback(sb: any): Promise<void> {
  const feedbackStart = Date.now();

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'DECISION_FEEDBACK_ANALYSIS_STARTED',
    title: 'Feedback-analyse startet',
    severity: 'info',
    metadata: { lastFeedbackRun: lastFeedbackRun ? new Date(lastFeedbackRun).toISOString() : null },
  });

  lastFeedbackRun = Date.now();

  const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: decisions } = await sb
    .from('ai_agent_decisions')
    .select('agent_type,decision_type,outcome,feedback_score,input_context,decision_summary,created_at')
    .eq('workspace_id', WORKSPACE_ID)
    .gte('created_at', cutoff30d)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!decisions || decisions.length < 3) {
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'DECISION_FEEDBACK_ANALYSIS_COMPLETED',
      title: 'Feedback-analyse ferdig: for lite data',
      severity: 'info',
      metadata: { decisionsFound: decisions?.length ?? 0, skipped: true, durationMs: Date.now() - feedbackStart },
    });
    return;
  }

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'DECISION_FEEDBACK_CONSUMED',
    title: `Feedback-data lest: ${decisions.length} beslutninger`,
    severity: 'info',
    metadata: { total: decisions.length, cutoff: cutoff30d },
  });

  const utført = (decisions as Record<string, unknown>[]).filter((d) => d['outcome'] === 'executed' || d['feedback_score'] === 1);
  const avvist = (decisions as Record<string, unknown>[]).filter((d) => d['outcome'] === 'dismissed' || d['feedback_score'] === 0);
  const acceptanceRate = Math.round((utført.length / decisions.length) * 100);

  const byType: Record<string, { total: number; executed: number }> = {};
  for (const d of decisions as Record<string, unknown>[]) {
    const t = (d['decision_type'] as string | null) ?? 'unknown';
    if (!byType[t]) byType[t] = { total: 0, executed: 0 };
    byType[t].total++;
    if (d['outcome'] === 'executed' || d['feedback_score'] === 1) byType[t].executed++;
  }

  const byGame: Record<string, { total: number; executed: number }> = {};
  for (const d of decisions as Record<string, unknown>[]) {
    const ctx = d['input_context'] as Record<string, unknown> | null;
    const g = ((ctx?.['game'] ?? ctx?.['streamGame']) as string | undefined);
    if (!g) continue;
    if (!byGame[g]) byGame[g] = { total: 0, executed: 0 };
    byGame[g].total++;
    if (d['outcome'] === 'executed' || d['feedback_score'] === 1) byGame[g].executed++;
  }

  const typeLines = Object.entries(byType)
    .map(([t, v]) => `${t}: ${Math.round((v.executed / v.total) * 100)}% akseptert (${v.total})`)
    .join(', ');

  const gameLines = Object.entries(byGame)
    .map(([g, v]) => ({ g, rate: v.executed / v.total, total: v.total }))
    .sort((a, b) => b.rate - a.rate)
    .map(x => `${x.g}: ${Math.round(x.rate * 100)}%`)
    .join(', ');

  await upsertBotMemory({
    agent_type: 'ai_producer',
    memory_type: 'feedback_pattern',
    memory_category: 'stream',
    key: 'decision_acceptance_rates',
    summary: `AI-anbefalinger siste 30d: ${acceptanceRate}% akseptert (${decisions.length} totalt). Per type: ${typeLines || 'ingen'}. Per spill: ${gameLines || 'ingen data'}.`,
    confidence_score: Math.min(0.95, 0.5 + decisions.length * 0.01),
    metadata: { total: decisions.length, executed: utført.length, dismissed: avvist.length, byType, byGame, acceptanceRate },
  });

  let insightText = '';
  if (decisions.length >= 5) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: `Basert på disse AI-beslutningsdataene, lag 1-2 konkrete læringssetninger på norsk:
Total: ${decisions.length} anbefalinger, ${utført.length} utført (${acceptanceRate}%), ${avvist.length} avvist.
Per type: ${typeLines || 'ingen'}
Per spill: ${gameLines || 'ingen'}

Eksempel: "Viewer-engagement-prompts aksepteres 82% av gangene, særlig under Tarkov-streams."
Maks 2 setninger, faktuell og konkret.` }],
          max_tokens: 150,
          temperature: 0.3,
        });
        insightText = res.choices[0]?.message?.content?.trim() ?? '';
        if (insightText) {
          logSystemEvent({
            source: 'learning_aggregator',
            event_type: 'DECISION_FEEDBACK_LEARNED',
            title: `AI lærte av ${decisions.length} beslutninger: ${acceptanceRate}% akseptert`,
            severity: 'info',
            metadata: {
              acceptanceRate,
              total: decisions.length,
              executed: utført.length,
              dismissed: avvist.length,
              decisionType: Object.keys(byType)[0] ?? 'ukjent',
              sampleSize: decisions.length,
              learningSummary: insightText.slice(0, 200),
            },
          });
        }
      } catch {}
    }
  }

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'DECISION_FEEDBACK_ANALYSIS_COMPLETED',
    title: `Feedback-analyse ferdig: ${acceptanceRate}% akseptert (${decisions.length} beslutninger)`,
    severity: 'info',
    metadata: {
      acceptanceRate,
      total: decisions.length,
      executed: utført.length,
      dismissed: avvist.length,
      insightGenerated: !!insightText,
      durationMs: Date.now() - feedbackStart,
    },
  });
}

// ─── Hoved-aggregering ────────────────────────────────────────────────────────

export async function kjørAggregering(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const sb = getSb();
  if (!sb) return;

  aggrRunCount++;
  const isDecayCycle = aggrRunCount % 6 === 0;
  const aggrStart = Date.now();

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'LEARNING_AGGREGATION_STARTED',
    title: `Aggregering startet (run #${aggrRunCount}${isDecayCycle ? ', decay-syklus' : ''})`,
    severity: 'info',
    metadata: { lastRun: lastRun ? new Date(lastRun).toISOString() : null, aggrRunCount, isDecayCycle },
  });

  const cutoff = new Date(lastRun || Date.now() - 2 * 60 * 60_000).toISOString();
  lastRun = Date.now();

  const sysWarningCutoff = new Date(Date.now() - 60 * 60_000).toISOString();

  // Fetch events, system warnings and linked accounts in parallel
  const [eventsRes, sysRes, linkedAccountsRes] = await Promise.all([
    sb.from('ai_agent_events')
      .select('source,event_type,username,message_text,importance_score,metadata,created_at')
      .eq('workspace_id', WORKSPACE_ID)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('system_events')
      .select('source,event_type,title,severity')
      .eq('workspace_id', WORKSPACE_ID)
      .in('severity', ['warning', 'error', 'critical'])
      .gte('created_at', sysWarningCutoff)
      .order('created_at', { ascending: false })
      .limit(8),
    sb.from('community_members')
      .select('discord_id,twitch_user_id')
      .eq('workspace_id', WORKSPACE_ID)
      .not('twitch_user_id', 'is', null)
      .not('discord_id', 'is', null),
  ]);

  const events: Record<string, unknown>[]         = eventsRes.data         ?? [];
  const sysWarnings: Record<string, unknown>[]    = sysRes.data            ?? [];
  const linkedAccounts: Record<string, unknown>[] = linkedAccountsRes.data ?? [];

  if (events.length < 1) {
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: 'Aggregering ferdig: ingen nye events',
      severity: 'info',
      metadata: { eventsAnalysert: 0, executionTime: Date.now() - aggrStart },
    });
    return;
  }

  // Build username→source map and ID→username maps from events
  const userSourceMap      = new Map<string, Set<string>>();
  const discordIdToUsername = new Map<string, string>();
  const twitchUserIdToUsername = new Map<string, string>();

  for (const ev of events) {
    const username = ev['username'] as string | null;
    const source   = ev['source']   as string;
    const meta     = ev['metadata'] as Record<string, unknown> | null;

    if (username) {
      const lower = username.toLowerCase();
      if (!userSourceMap.has(lower)) userSourceMap.set(lower, new Set());
      userSourceMap.get(lower)!.add(source);

      if (source === 'discord' && meta?.['discord_id']) {
        discordIdToUsername.set(String(meta['discord_id']), lower);
      }
      if (source === 'twitch' && meta?.['twitch_user_id']) {
        twitchUserIdToUsername.set(String(meta['twitch_user_id']), lower);
      }
    }
  }

  // Gate: skip analysis if bot was crashing or data is incomplete
  const criticalBotEvents = sysWarnings.filter((e) =>
    ['error', 'critical'].includes(e['severity'] as string) &&
    ['twitch_bot', 'stream_history', 'twitch_api', 'bot'].includes(e['source'] as string),
  );
  const hasPartialData = criticalBotEvents.length > 0 || events.length < 3;

  if (hasPartialData) {
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_SKIPPED_PARTIAL_DATA',
      title: `AI-læring utsatt — ufullstendig datagrunnlag (${criticalBotEvents.length} kritiske bot-feil, ${events.length} events)`,
      severity: 'warning',
      metadata: {
        reason: criticalBotEvents.length > 0 ? 'bot_errors_detected' : 'too_few_events',
        criticalEvents: criticalBotEvents.slice(0, 3).map((e) => ({ source: e['source'], event_type: e['event_type'], title: e['title'] })),
        eventCount: events.length,
      },
    });
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: 'Aggregering avbrutt: partial data gate aktivert',
      severity: 'info',
      metadata: { eventsAnalysert: events.length, executionTime: Date.now() - aggrStart, partialDataGate: true },
    });
    return;
  }

  const sysKontekst = sysWarnings.length > 0
    ? `\nSYSTEMSTATUS (ikke la dette dominere analysen):\n${sysWarnings.map((e) => `[${String(e['severity']).toUpperCase()}] ${e['source']}: ${e['title']}`).join('\n')}`
    : '';

  // Compact event summary for GPT
  const eventLinjer = events
    .slice(0, 60)
    .map((e) => {
      const meta = e['metadata'] && typeof e['metadata'] === 'object'
        ? Object.entries(e['metadata'] as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      const username = e['username'] ? ` @${e['username']}` : '';
      return `[${e['source']}/${e['event_type']}]${username} ${meta}`.trim();
    })
    .join('\n');

  let memoriesWritten      = 0;
  let insightsWritten      = 0;
  let crossPlatformMatches = 0;
  let decayedCount         = 0;

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Du er læringsagenten for Creator OS. Analyser disse hendelsene og trekk ut strukturert kunnskap i 10 kategorier.

HENDELSER (siste 15-20 min):
${eventLinjer}${sysKontekst}

Returner KUN JSON med disse nøklene (hopp over kategorier uten relevant data, maks 3 observasjoner per kategori):
{
  "COMMUNITY": [{"key": "brukernavn_eller_mønster", "observation": "...", "confidence": 0.7, "source": "twitch|discord|both"}],
  "INTERESTS": [{"key": "spill_eller_tema", "observation": "...", "confidence": 0.6}],
  "STREAM": [{"key": "mønster_nøkkel", "observation": "...", "confidence": 0.7}],
  "CREATOR": [{"key": "egenskap", "observation": "...", "confidence": 0.6}],
  "DISCORD": [{"key": "kanal_eller_mønster", "observation": "...", "confidence": 0.6}],
  "TWITCH": [{"key": "hendelse_type", "observation": "...", "confidence": 0.7}],
  "ECONOMY": [{"key": "økonomi_mønster", "observation": "...", "confidence": 0.6}],
  "PARTNER": [{"key": "partner_signal", "observation": "...", "confidence": 0.6}],
  "HUMOR": [{"key": "joke_id", "observation": "...", "confidence": 0.5, "source": "twitch|discord"}],
  "GENERAL": [{"key": "observasjon", "observation": "...", "confidence": 0.5}],
  "aktiveSeere": [{"username": "...", "hvorfor": "...", "source": "twitch|discord"}],
  "innsikter": [{"tittel": "...", "sammendrag": "...", "confidence": 0.8}]
}

Kategoribeskrivelser:
- COMMUNITY: aktive seere/membres, mønstre i hvem som er aktive, nye faces, faste fjes
- INTERESTS: spill, temaer, musikk, memes som dukker opp i hendelsene
- STREAM: hva øker chat-aktivitet, hva beholder seere, hva mister dem
- CREATOR: Glenns styrker, svakheter, typiske respons-mønstre overfor community
- DISCORD: aktive kanaler, poster-typer som fungerer, aktive tidspunkter
- TWITCH: timing, raid-mønstre, klipp-øyeblikk, hype-utløsere
- ECONOMY: coin-bruk, XP-mønstre, hvilke belønninger brukes vs ignoreres
- PARTNER: sponsor-innlegg som får vs ikke får engagement
- HUMOR: inside jokes, gjenganger-memes, faste fraser/catchphrases
- GENERAL: andre bemerkelsesverdige mønstre som ikke passer andre kategorier`,
        },
      ],
      max_tokens: 1400,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    let analyse: GptAnalyse = {};
    try { analyse = JSON.parse(res.choices[0]?.message?.content ?? '{}') as GptAnalyse; } catch {}

    // ── Write memory for all 10 categories ───────────────────────────────────
    for (const cat of ANALYSIS_CATEGORIES) {
      const observations = (analyse[cat] ?? []).slice(0, 3);
      for (const obs of observations) {
        if (!obs.key || !obs.observation) continue;
        const memCat = categoryToMemoryCategory(cat);
        const { agent_type, memory_type } = categoryToTypes(cat, obs.source ?? '');
        await upsertBotMemory({
          agent_type,
          memory_type,
          key: String(obs.key).toLowerCase().slice(0, 80),
          summary: String(obs.observation).slice(0, 300),
          confidence_score: typeof obs.confidence === 'number' ? Math.min(1, obs.confidence) : 0.5,
          memory_category: memCat,
          metadata: { source: obs.source ?? 'unknown', category: cat, lastUpdated: new Date().toISOString() },
        });
        memoriesWritten++;
      }
    }

    // ── Write active viewers/members (explicit user tracking) ────────────────
    for (const seer of (analyse.aktiveSeere ?? []).slice(0, 5)) {
      if (!seer.username) continue;
      const lower = String(seer.username).toLowerCase();
      const sources = userSourceMap.get(lower) ?? new Set([seer.source ?? 'twitch']);

      if (sources.has('twitch')) {
        await upsertBotMemory({
          agent_type: 'twitch',
          memory_type: 'viewer',
          key: lower,
          summary: seer.hvorfor ?? 'Aktiv seer på kanalen',
          confidence_score: 0.6,
          memory_category: 'community',
          metadata: { lastSeen: new Date().toISOString(), source: 'twitch' },
        });
        memoriesWritten++;
      }
      if (sources.has('discord')) {
        await upsertBotMemory({
          agent_type: 'discord',
          memory_type: 'member',
          key: lower,
          summary: seer.hvorfor ?? 'Aktiv Discord-member i communityet',
          confidence_score: 0.6,
          memory_category: 'community',
          metadata: { lastSeen: new Date().toISOString(), source: 'discord' },
        });
        memoriesWritten++;
      }
    }

    if (memoriesWritten > 0) {
      logSystemEvent({
        source: 'learning_aggregator',
        event_type: 'MEMORY_UPDATED',
        title: `${memoriesWritten} memory-oppføringer oppdatert`,
        severity: 'info',
        metadata: { count: memoriesWritten, categories: ANALYSIS_CATEGORIES.length },
      });
    }

    // ── Write insights ────────────────────────────────────────────────────────
    const innsikter = (analyse.innsikter ?? []).slice(0, 3);
    if (innsikter.length > 0) {
      try {
        const { error: insErr } = await sb.from('ai_agent_insights').insert(
          innsikter.map((ins) => ({
            workspace_id:     WORKSPACE_ID,
            title:            ins.tittel     ?? 'Ny innsikt',
            summary:          ins.sammendrag ?? '',
            confidence_score: ins.confidence ?? 0.6,
            source_data:      { eventCount: events.length, cutoff },
          })),
        );
        if (insErr) {
          console.error('[LearningAggregator] insights insert feilet:', insErr.message, insErr.code);
        } else {
          insightsWritten = innsikter.length;
          logSystemEvent({
            source: 'learning_aggregator',
            event_type: 'INSIGHT_CREATED',
            title: `${innsikter.length} nye innsikter generert`,
            severity: 'info',
            metadata: { count: innsikter.length, titles: innsikter.map((i) => (i.tittel ?? '').slice(0, 60)) },
          });
        }
      } catch (e: unknown) {
        console.error('[LearningAggregator] insights insert exception:', e instanceof Error ? e.message : String(e));
      }
    }

    // ── Cross-platform identity fusion ────────────────────────────────────────
    const candidates: CrossPlatformCandidate[] = [];

    // Method 1: Exact username match (confidence 0.75)
    for (const [username, sources] of userSourceMap.entries()) {
      if (sources.has('twitch') && sources.has('discord')) {
        candidates.push({ twitchUsername: username, discordUsername: username, confidence: 0.75, matchMethod: 'username' });
      }
    }

    // Method 2: Linked accounts via community_members (confidence 0.98)
    for (const link of linkedAccounts) {
      const discordId   = String(link['discord_id']);
      const twitchUid   = String(link['twitch_user_id']);
      const discordUser = discordIdToUsername.get(discordId);
      const twitchUser  = twitchUserIdToUsername.get(twitchUid);
      if (discordUser && twitchUser) {
        const existingIdx = candidates.findIndex(c => c.twitchUsername === twitchUser || c.discordUsername === discordUser);
        if (existingIdx >= 0) {
          candidates[existingIdx].confidence   = 0.98;
          candidates[existingIdx].matchMethod  = 'linked_account';
          candidates[existingIdx].twitchUserId = twitchUid;
          candidates[existingIdx].discordUserId = discordId;
        } else {
          candidates.push({ twitchUsername: twitchUser, discordUsername: discordUser, confidence: 0.98, matchMethod: 'linked_account', twitchUserId: twitchUid, discordUserId: discordId });
        }
      }
    }

    // Method 3: Similar username (edit distance ≤ 2, same first 5 chars, confidence 0.45)
    const twitchUsers  = [...userSourceMap.entries()].filter(([, s]) => s.has('twitch')).map(([u]) => u);
    const discordUsers = [...userSourceMap.entries()].filter(([, s]) => s.has('discord')).map(([u]) => u);

    for (const tw of twitchUsers) {
      for (const dc of discordUsers) {
        if (tw === dc) continue; // already handled by exact match
        if (tw.length < 3 || dc.length < 3) continue;
        if (tw.slice(0, 5) === dc.slice(0, 5) && editDistance(tw, dc) <= 2) {
          const alreadyMatched = candidates.some(c => c.twitchUsername === tw && c.discordUsername === dc);
          if (!alreadyMatched) {
            candidates.push({ twitchUsername: tw, discordUsername: dc, confidence: 0.45, matchMethod: 'similar_username' });
          }
        }
      }
    }

    // Write all candidates (cap at 10 to avoid write burst)
    for (const c of candidates.slice(0, 10)) {
      await upsertCrossPlatformMatch(sb, c.twitchUsername, c.discordUsername, c.confidence, c.matchMethod, c.twitchUserId, c.discordUserId);
      crossPlatformMatches++;
    }

    // ── Decay pass (every 6th run ≈ every 90 min) ────────────────────────────
    if (isDecayCycle) {
      const decay = await runDecayPass(sb);
      decayedCount = decay.decayed + decay.deleted;
    }

    // ── Completion events ─────────────────────────────────────────────────────
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: `Aggregering fullført: ${events.length} events → ${innsikter.length} innsikter, ${memoriesWritten} minner`,
      severity: 'info',
      metadata: {
        eventsAnalysert: events.length,
        innsikterFunnet: innsikter.length,
        memoriesWritten,
        crossPlatformMatches,
        sysWarninger: sysWarnings.length,
        isDecayCycle,
        executionTime: Date.now() - aggrStart,
      },
    });

    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_CYCLE_COMPLETED',
      title: `Læringssyklus fullført: ${memoriesWritten} minner, ${insightsWritten} innsikter`,
      severity: 'info',
      metadata: { memoriesWritten, insightsWritten, eventsProcessed: events.length, crossPlatformMatches, decayedCount },
    });

    if (memoriesWritten > 0 || insightsWritten > 0) {
      console.log(`[LearningAggregator] ✓ ${events.length} hendelser → ${insightsWritten} innsikter, ${memoriesWritten} minner, ${crossPlatformMatches} kryss-plattform`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message?.slice(0, 80) : String(err).slice(0, 80);
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: `Aggregering feilet: ${msg}`,
      severity: 'error',
      metadata: { error: err instanceof Error ? err.message?.slice(0, 200) : String(err).slice(0, 200), executionTime: Date.now() - aggrStart },
    });
    console.error('[LearningAggregator] Feil:', msg);
  }
}

export function startLearningAggregator(): void {
  // Hoved-aggregering: kjøres hvert 15. min (starter etter 2 min for å la systemet stabilisere)
  setTimeout(async () => {
    await kjørAggregering().catch(() => {});
    setInterval(() => kjørAggregering().catch(() => {}), 15 * 60_000);
  }, 2 * 60_000);

  // Feedback-analyse: deterministisk kjøring hvert 60. min
  setTimeout(async () => {
    const sb = getSb();
    if (sb) await aggregerDecisionFeedback(sb).catch(() => {});
    setInterval(async () => {
      const sb2 = getSb();
      if (sb2) await aggregerDecisionFeedback(sb2).catch(() => {});
    }, 60 * 60_000);
  }, 5 * 60_000); // Start etter 5 min for å la hoved-aggregering komme i gang

  console.log('  ✓ Learning Aggregator V2 startet (aggregering hvert 15. min, feedback hvert 60. min, decay hvert 90. min)');
}
