/**
 * 15-minutters batch-aggregering.
 * Leser siste hendelser → ett GPT-kall → oppdaterer ai_agent_memory + ai_agent_insights.
 * Billig: én GPT-4o-mini kall per 15 min, ikke per melding.
 *
 * Støtter både Twitch og Discord events.
 * Kjører cross-platform matching etter aggregering.
 */

import { upsertBotMemory } from './agentLogger';
import OpenAI from 'openai';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';
let lastRun = 0;
let lastFeedbackRun = 0;

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

// ─── Feedback-loop fra ai_agent_decisions ─────────────────────────────────────

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

  const utført = decisions.filter((d: any) => d.outcome === 'executed' || d.feedback_score === 1);
  const avvist = decisions.filter((d: any) => d.outcome === 'dismissed' || d.feedback_score === 0);
  const acceptanceRate = Math.round((utført.length / decisions.length) * 100);

  // Per type
  const byType: Record<string, { total: number; executed: number }> = {};
  for (const d of decisions) {
    const t = d.decision_type ?? 'unknown';
    if (!byType[t]) byType[t] = { total: 0, executed: 0 };
    byType[t].total++;
    if (d.outcome === 'executed' || d.feedback_score === 1) byType[t].executed++;
  }

  // Per spill
  const byGame: Record<string, { total: number; executed: number }> = {};
  for (const d of decisions) {
    const g = (d.input_context?.game ?? d.input_context?.streamGame) as string | undefined;
    if (!g) continue;
    if (!byGame[g]) byGame[g] = { total: 0, executed: 0 };
    byGame[g].total++;
    if (d.outcome === 'executed' || d.feedback_score === 1) byGame[g].executed++;
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
    key: 'decision_acceptance_rates',
    summary: `AI-anbefalinger siste 30d: ${acceptanceRate}% akseptert (${decisions.length} totalt). Per type: ${typeLines || 'ingen'}. Per spill: ${gameLines || 'ingen data'}.`,
    confidence_score: Math.min(0.95, 0.5 + decisions.length * 0.01),
    metadata: { total: decisions.length, executed: utført.length, dismissed: avvist.length, byType, byGame, acceptanceRate },
  });

  // GPT-innsikt kun hvis nok data
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
          // Bevisst IKKE skrevet til ai_agent_insights – teknisk akseptansedata hører til
          // Systemhelse/AI Memory (ai_agent_memory via upsertBotMemory ovenfor), ikke den
          // praktiske streamer-innsikt-feeden på dashboardet (Dashboard V4 BUG 4).
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

  const aggrStart = Date.now();

  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'LEARNING_AGGREGATION_STARTED',
    title: 'Aggregering startet',
    severity: 'info',
    metadata: { lastRun: lastRun ? new Date(lastRun).toISOString() : null },
  });

  // Hent hendelser siden forrige kjøring (eller siste 2 timer ved oppstart)
  const cutoff = new Date(lastRun || Date.now() - 2 * 60 * 60_000).toISOString();
  lastRun = Date.now();

  const sysWarningCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const [eventsRes, sysRes] = await Promise.all([
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
  ]);

  const events: any[] = eventsRes.data ?? [];
  const sysWarnings: any[] = sysRes.data ?? [];

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

  // Bygg username→kilde-map for korrekt agent_type-tildeling
  const userSourceMap = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.username) {
      const lower = (ev.username as string).toLowerCase();
      if (!userSourceMap.has(lower)) userSourceMap.set(lower, new Set());
      userSourceMap.get(lower)!.add(ev.source as string);
    }
  }

  // Kompakt event-sammendrag for GPT
  const eventLinjer = events
    .slice(0, 60)
    .map((e: any) => {
      const meta = e.metadata && typeof e.metadata === 'object'
        ? Object.entries(e.metadata).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      return `[${e.source}/${e.event_type}]${e.username ? ' @' + e.username : ''} ${meta}`.trim();
    })
    .join('\n');

  const sysKontekst = sysWarnings.length > 0
    ? `\nSYSTEMSTATUS (ikke la dette dominere analysen):\n${sysWarnings.map((e: any) => `[${e.severity.toUpperCase()}] ${e.source}: ${e.title}`).join('\n')}`
    : '';

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Du er læringsagenten for Creator OS. Analyser disse hendelsene og trekk ut kunnskap.

HENDELSER (siste 15-20 min):
${eventLinjer}${sysKontekst}

Finn og returner:
1. Aktive brukere (username som dukker opp hyppig = potensielle faste seere/membres)
2. Viktige øyeblikk (raids, subs, klipp ferdig, seer-topper)
3. Mønstre (tidspunkt, spill, aktivitetstype som går igjen)
4. Community-signaler (fraser, inside jokes, emotes fra message_text)

Returner KUN JSON:
{
  "aktiveSeere": [{"username": "...", "hvorfor": "...", "source": "twitch|discord"}],
  "innsikter": [{"tittel": "...", "sammendrag": "...", "confidence": 0.8}],
  "communitySignaler": [{"signal": "...", "type": "joke|phrase|pattern", "source": "twitch|discord"}]
}`,
        },
      ],
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    let analyse: any = {};
    try { analyse = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch {}

    // Oppdater minne per bruker
    let memoryOppdatert = 0;
    for (const seer of (analyse.aktiveSeere ?? []).slice(0, 5)) {
      if (!seer.username) continue;
      const lower = (seer.username as string).toLowerCase();
      const sources = userSourceMap.get(lower) ?? new Set([seer.source ?? 'twitch']);

      const isTwitch = sources.has('twitch');
      const isDiscord = sources.has('discord');

      if (isTwitch) {
        await upsertBotMemory({
          agent_type: 'twitch',
          memory_type: 'viewer',
          key: lower,
          summary: seer.hvorfor ?? `Aktiv seer på kanalen`,
          confidence_score: 0.6,
          metadata: { lastSeen: new Date().toISOString(), source: 'twitch' },
        });
        memoryOppdatert++;
      }
      if (isDiscord) {
        await upsertBotMemory({
          agent_type: 'discord',
          memory_type: 'member',
          key: lower,
          summary: seer.hvorfor ?? `Aktiv Discord-member i communityet`,
          confidence_score: 0.6,
          metadata: { lastSeen: new Date().toISOString(), source: 'discord' },
        });
        memoryOppdatert++;
      }

      if (isTwitch && isDiscord) {
        upsertCrossPlatformMatch(sb, lower, lower, 0.75).catch(() => {});
      }
    }

    if (memoryOppdatert > 0) {
      logSystemEvent({
        source: 'learning_aggregator',
        event_type: 'MEMORY_UPDATED',
        title: `${memoryOppdatert} memory-oppføringer oppdatert`,
        severity: 'info',
        metadata: { count: memoryOppdatert, activeSeere: (analyse.aktiveSeere ?? []).length },
      });
    }

    // Legg til innsikter i databasen
    const innsikter = (analyse.innsikter ?? []).slice(0, 3);
    if (innsikter.length > 0) {
      try {
        const { error: insErr } = await sb.from('ai_agent_insights').insert(
          innsikter.map((ins: any) => ({
            workspace_id: WORKSPACE_ID,
            title: ins.tittel ?? 'Ny innsikt',
            summary: ins.sammendrag ?? '',
            confidence_score: ins.confidence ?? 0.6,
            source_data: { eventCount: events.length, cutoff },
          }))
        );
        if (insErr) console.error('[LearningAggregator] insights insert feilet:', insErr.message, insErr.code);

        if (!insErr) {
          logSystemEvent({
            source: 'learning_aggregator',
            event_type: 'INSIGHT_CREATED',
            title: `${innsikter.length} nye innsikter generert`,
            severity: 'info',
            metadata: {
              count: innsikter.length,
              titles: innsikter.map((i: any) => (i.tittel ?? '').slice(0, 60)),
            },
          });
        }
      } catch (e: any) {
        console.error('[LearningAggregator] insights insert exception:', e.message);
      }
    }

    // Oppdater community-minne
    for (const cs of (analyse.communitySignaler ?? []).slice(0, 5)) {
      if (!cs.signal || cs.signal.length < 3) continue;
      const agentType = cs.source === 'discord' ? 'discord' : 'twitch';
      await upsertBotMemory({
        agent_type: agentType,
        memory_type: cs.type === 'joke' ? 'joke' : 'topic',
        key: cs.signal.toLowerCase().slice(0, 80),
        summary: cs.signal,
        confidence_score: 0.5,
      });
    }

    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: `Aggregering fullført: ${events.length} events → ${innsikter.length} innsikter`,
      severity: 'info',
      metadata: {
        eventsAnalysert: events.length,
        innsikterFunnet: innsikter.length,
        memoryOppdatert,
        communitySignaler: (analyse.communitySignaler ?? []).length,
        sysWarninger: sysWarnings.length,
        executionTime: Date.now() - aggrStart,
      },
    });

    if (innsikter.length > 0 || memoryOppdatert > 0) {
      console.log(`[LearningAggregator] ✓ ${events.length} hendelser → ${innsikter.length} innsikter, ${memoryOppdatert} memory oppdatert`);
    }
  } catch (err: any) {
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'LEARNING_AGGREGATION_COMPLETED',
      title: `Aggregering feilet: ${err.message?.slice(0, 80)}`,
      severity: 'error',
      metadata: { error: err.message?.slice(0, 200), executionTime: Date.now() - aggrStart },
    });
    console.error('[LearningAggregator] Feil:', err.message?.slice(0, 100));
  }
}

async function upsertCrossPlatformMatch(
  sb: any,
  twitchUsername: string,
  discordUsername: string,
  confidence: number,
): Promise<void> {
  try {
    const { data: existing } = await sb
      .from('cross_platform_users')
      .select('id,confidence_score,match_status')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('twitch_username', twitchUsername)
      .eq('discord_username', discordUsername)
      .maybeSingle();

    if (existing) {
      if (existing.match_status === 'pending') {
        await sb.from('cross_platform_users').update({
          confidence_score: Math.min(1.0, Math.max(existing.confidence_score, confidence)),
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
      return;
    }

    await sb.from('cross_platform_users').insert({
      workspace_id: WORKSPACE_ID,
      twitch_username: twitchUsername,
      discord_username: discordUsername,
      display_name: twitchUsername,
      platform_sources: ['twitch', 'discord'],
      confidence_score: confidence,
      match_status: 'pending',
      match_notes: `Auto-detektert: identisk brukernavn på Twitch og Discord`,
    });

    console.log(`[CrossPlatform] Ny match: ${twitchUsername} ↔ ${discordUsername} (confidence: ${confidence})`);
  } catch {}
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

  console.log('  ✓ Learning Aggregator startet (aggregering hvert 15. min, feedback hvert 60. min)');
}
