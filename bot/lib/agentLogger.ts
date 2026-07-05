/**
 * Railway-side agent event logger.
 * Buffrer hendelser i 10s før batch-skriving til Supabase.
 * Brukes av twitchBot.ts, index.ts (Discord-hendelser) og clipWorker.ts.
 *
 * Observability-garanti:
 *   Hvert flush-forsøk logger nøkkel-rolle (service_role vs anon), JS-klient-resultat,
 *   REST-fallback-resultat, og skriver AI_EVENT_INSERT_FAILED til system_events om begge feiler.
 *   Aldri stille feil igjen.
 *
 * upsertBotMemory er nå en thin wrapper rundt communityBrain::upsertCommunityMemory.
 */

import { upsertCommunityMemory } from './communityBrain';

const WORKSPACE_ID = process.env.WORKSPACE_ID || '';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

/** Dekoder JWT-payload og returnerer 'role'-claim — beviser om det er service_role eller anon. */
function getKeyRole(key: string): string {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf-8'));
    return (payload.role as string) ?? 'unknown';
  } catch {
    return 'decode-failed';
  }
}

interface BotAgentEvent {
  workspaceId?: string;
  source: 'twitch' | 'discord' | 'content_factory';
  event_type: string;
  username?: string;
  message_text?: string;
  channel_id?: string;
  importance_score?: number;
  metadata?: Record<string, any>;
}

const eventBuffer: BotAgentEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function logBotAgentEvent(event: BotAgentEvent): void {
  eventBuffer.push(event);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushEvents().catch(() => {});
    }, 10_000);
  }
}

async function writeInsertFailureEvent(url: string, key: string, count: number, errorMsg: string): Promise<void> {
  try {
    const res = await fetch(`${url}/rest/v1/system_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID,
        source: 'twitch_bot',
        event_type: 'AI_EVENT_INSERT_FAILED',
        title: `ai_agent_events insert feilet: ${count} events tapt`,
        severity: 'error',
        metadata: { errorMsg: errorMsg.slice(0, 500), eventCount: count, keyRole: getKeyRole(key) },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      console.error(`[AgentLogger] system_events failure-event feilet også HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.error('[AgentLogger] writeInsertFailureEvent exception:', e.message?.slice(0, 80));
  }
}

async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('[AgentLogger] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler — events tapt');
    return;
  }

  const keyRole = getKeyRole(key);
  console.log(`[AgentLogger] Flush: ${batch.length} events | nøkkel-rolle: ${keyRole}`);

  const rows = batch.map(e => ({
    workspace_id:     e.workspaceId ?? WORKSPACE_ID,
    source:           e.source,
    event_type:       e.event_type,
    username:         e.username        ?? null,
    message_text:     e.message_text    ?? null,
    channel_id:       e.channel_id      ?? null,
    importance_score: e.importance_score ?? 0,
    metadata:         e.metadata        ?? {},
  }));

  // ── Forsøk 1: Supabase JS-klienten ──────────────────────────────────────────
  let jsClientOk = false;
  const sb = getSb();
  if (sb) {
    try {
      const { error } = await sb.from('ai_agent_events').insert(rows);
      if (!error) {
        jsClientOk = true;
        console.log(`[AgentLogger] ✓ JS-klient: ${batch.length} events skrevet til ai_agent_events`);
      } else {
        console.error(
          `[AgentLogger] JS-klient feilet` +
          ` | code: ${error.code ?? '(ingen)'}` +
          ` | message: ${error.message}` +
          ` | hint: ${error.hint ?? ''}` +
          ` | details: ${error.details ?? ''}`
        );
      }
    } catch (e: any) {
      console.error('[AgentLogger] JS-klient exception:', e.message?.slice(0, 100));
    }
  }

  if (jsClientOk) return;

  // ── Forsøk 2: Direkte REST API (beviser om det er client-konfig vs faktisk tilgangsproblem) ──
  try {
    const res = await fetch(`${url}/rest/v1/ai_agent_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) {
      console.log(`[AgentLogger] ✓ REST fallback: ${batch.length} events skrevet til ai_agent_events`);
    } else {
      const txt = await res.text().catch(() => res.statusText);
      console.error(`[AgentLogger] REST fallback HTTP ${res.status}: ${txt.slice(0, 300)}`);
      await writeInsertFailureEvent(url, key, batch.length, `REST HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e2: any) {
    console.error('[AgentLogger] REST exception:', e2.message?.slice(0, 80));
    await writeInsertFailureEvent(url, key, batch.length, `REST exception: ${e2.message?.slice(0, 100)}`);
  }
}

/** Logg en chat-melding (Twitch eller Discord) til ai_agent_events. */
export function logChatMessage(params: {
  workspaceId?: string;
  source: 'twitch' | 'discord';
  username: string;
  message_text: string;
  channel_id?: string;
  importance_score?: number;
  metadata?: Record<string, any>;
}): void {
  logBotAgentEvent({
    workspaceId:     params.workspaceId,
    source:          params.source,
    event_type:      params.source === 'twitch' ? 'chat_message' : 'discord_message',
    username:        params.username,
    message_text:    params.message_text,
    channel_id:      params.channel_id,
    importance_score: params.importance_score ?? 20,
    metadata:        params.metadata ?? {},
  });
}

/**
 * Thin backward-compat wrapper around upsertCommunityMemory.
 * Preserves the existing call signature for all bot callers.
 */
export async function upsertBotMemory(entry: {
  agent_type: string;
  memory_type: string;
  key: string;
  summary: string;
  confidence_score?: number;
  memory_category?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await upsertCommunityMemory({
    workspaceId: WORKSPACE_ID,
    agentType:   entry.agent_type,
    memoryType:  entry.memory_type,
    key:         entry.key,
    summary:     entry.summary,
    confidence:  entry.confidence_score,
    category:    entry.memory_category as import('./communityBrain').MemoryCategory | undefined,
    metadata:    entry.metadata,
  });
}
