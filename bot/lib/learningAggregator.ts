/**
 * 15-minutters batch-aggregering.
 * Leser siste hendelser → ett GPT-kall → oppdaterer ai_agent_memory + ai_agent_insights.
 * Billig: én GPT-4o-mini kall per 15 min, ikke per melding.
 */

import { upsertBotMemory } from './agentLogger';
import OpenAI from 'openai';

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

  if (!events || events.length < 3) return; // For lite å lære av

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
  "aktiveSeere": [{"username": "...", "hvorfor": "..."}],
  "innsikter": [{"tittel": "...", "sammendrag": "...", "confidence": 0.8}],
  "communitySignaler": [{"signal": "...", "type": "joke|phrase|pattern"}]
}`,
        },
      ],
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    let analyse: any = {};
    try { analyse = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch {}

    // Oppdater viewer-minne
    for (const seer of (analyse.aktiveSeere ?? []).slice(0, 5)) {
      if (!seer.username) continue;
      await upsertBotMemory({
        agent_type: 'twitch',
        memory_type: 'viewer',
        key: seer.username.toLowerCase(),
        summary: seer.hvorfor ?? `Aktiv seer på GLENVEX`,
        confidence_score: 0.6,
        metadata: { lastSeen: new Date().toISOString() },
      });
    }

    // Legg til innsikter i databasen
    const innsikter = (analyse.innsikter ?? []).slice(0, 3);
    if (innsikter.length > 0) {
      try {
        await sb.from('ai_agent_insights').insert(
          innsikter.map((ins: any) => ({
            workspace_id: WORKSPACE_ID,
            title: ins.tittel ?? 'Ny innsikt',
            summary: ins.sammendrag ?? '',
            confidence_score: ins.confidence ?? 0.6,
            source_data: { eventCount: events.length, cutoff },
          }))
        );
      } catch {}
    }

    // Oppdater community-minne
    for (const cs of (analyse.communitySignaler ?? []).slice(0, 5)) {
      if (!cs.signal || cs.signal.length < 3) continue;
      await upsertBotMemory({
        agent_type: 'twitch',
        memory_type: cs.type === 'joke' ? 'joke' : 'topic',
        key: cs.signal.toLowerCase().slice(0, 80),
        summary: cs.signal,
        confidence_score: 0.5,
      });
    }

    if (innsikter.length > 0 || (analyse.aktiveSeere ?? []).length > 0) {
      console.log(`[LearningAggregator] ✓ ${events.length} hendelser → ${innsikter.length} innsikter, ${(analyse.aktiveSeere ?? []).length} seere oppdatert`);
    }
  } catch (err: any) {
    console.error('[LearningAggregator] Feil:', err.message?.slice(0, 100));
  }
}

export function startLearningAggregator(): void {
  // Vent 2 min etter oppstart, deretter hvert 15. min
  setTimeout(async () => {
    await kjørAggregering().catch(() => {});
    setInterval(() => kjørAggregering().catch(() => {}), 15 * 60_000);
  }, 2 * 60_000);

  console.log('  ✓ Learning Aggregator startet (kjører hvert 15. min)');
}
