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

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

export async function kjørAggregering(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const sb = getSb();
  if (!sb) return;

  const aggrStart = Date.now();

  // Hent hendelser siden forrige kjøring (eller siste 20 min ved oppstart)
  const cutoff = new Date(lastRun || Date.now() - 20 * 60_000).toISOString();
  lastRun = Date.now();

  const { data: events } = await sb
    .from('ai_agent_events')
    .select('source,event_type,username,message_text,importance_score,metadata,created_at')
    .eq('workspace_id', WORKSPACE_ID)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!events || events.length < 1) return;

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

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Du er læringsagenten for GLENVEX Creator OS. Analyser disse hendelsene og trekk ut kunnskap.

HENDELSER (siste 15-20 min):
${eventLinjer}

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

    // Oppdater minne per bruker – bruk korrekt agent_type basert på kilde
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
          summary: seer.hvorfor ?? `Aktiv seer på GLENVEX`,
          confidence_score: 0.6,
          metadata: { lastSeen: new Date().toISOString(), source: 'twitch' },
        });
      }
      if (isDiscord) {
        await upsertBotMemory({
          agent_type: 'discord',
          memory_type: 'member',
          key: lower,
          summary: seer.hvorfor ?? `Aktiv Discord-member i GLENVEX`,
          confidence_score: 0.6,
          metadata: { lastSeen: new Date().toISOString(), source: 'discord' },
        });
      }

      // Kryss-plattform: samme brukernavn sett på begge → høy confidence
      if (isTwitch && isDiscord) {
        upsertCrossPlatformMatch(sb, lower, lower, 0.75).catch(() => {});
      }
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
      } catch (e: any) {
        console.error('[LearningAggregator] insights insert exception:', e.message);
      }
    }

    // Oppdater community-minne med korrekt kilde
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
      event_type: 'AGGREGATION_COMPLETE',
      title: `Aggregering fullført: ${events.length} events → ${innsikter.length} innsikter`,
      severity: 'info',
      metadata: {
        eventsAnalysert: events.length,
        innsikterFunnet: innsikter.length,
        memoryOppdatert: (analyse.aktiveSeere ?? []).length,
        communitySignaler: (analyse.communitySignaler ?? []).length,
        executionTime: Date.now() - aggrStart,
      },
    });
    if (innsikter.length > 0 || (analyse.aktiveSeere ?? []).length > 0) {
      console.log(`[LearningAggregator] ✓ ${events.length} hendelser → ${innsikter.length} innsikter, ${(analyse.aktiveSeere ?? []).length} brukere oppdatert`);
    }
  } catch (err: any) {
    logSystemEvent({
      source: 'learning_aggregator',
      event_type: 'AGGREGATION_COMPLETE',
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
    // Sjekk om match allerede finnes
    const { data: existing } = await sb
      .from('cross_platform_users')
      .select('id,confidence_score,match_status')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('twitch_username', twitchUsername)
      .eq('discord_username', discordUsername)
      .maybeSingle();

    if (existing) {
      // Oppdater confidence og last_seen_at hvis eksisterer
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
  setTimeout(async () => {
    await kjørAggregering().catch(() => {});
    setInterval(() => kjørAggregering().catch(() => {}), 15 * 60_000);
  }, 2 * 60_000);

  console.log('  ✓ Learning Aggregator startet (kjører hvert 15. min)');
}
