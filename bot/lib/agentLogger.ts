/**
 * Railway-side agent event logger.
 * Buffrer hendelser i 10s før batch-skriving til Supabase.
 * Brukes av twitchBot.ts, index.ts (Discord-hendelser) og clipWorker.ts.
 */

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

interface BotAgentEvent {
  source: 'twitch' | 'discord' | 'content_factory';
  event_type: string;
  username?: string;
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

async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0);
  const sb = getSb();
  if (!sb) return;
  try {
    await sb.from('ai_agent_events').insert(
      batch.map(e => ({
        workspace_id: WORKSPACE_ID,
        source: e.source,
        event_type: e.event_type,
        username: e.username ?? null,
        importance_score: e.importance_score ?? 0,
        metadata: e.metadata ?? {},
      }))
    );
  } catch { /* silent */ }
}

export async function upsertBotMemory(entry: {
  agent_type: string;
  memory_type: string;
  key: string;
  summary: string;
  confidence_score?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  const now = new Date().toISOString();
  try {
    const { data: existing } = await sb
      .from('ai_agent_memory')
      .select('id,occurrence_count')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('agent_type', entry.agent_type)
      .eq('memory_type', entry.memory_type)
      .eq('key', entry.key)
      .single();

    if (existing) {
      await sb.from('ai_agent_memory').update({
        summary: entry.summary,
        confidence_score: entry.confidence_score ?? 0.7,
        occurrence_count: existing.occurrence_count + 1,
        last_seen_at: now,
        updated_at: now,
      }).eq('id', existing.id);
    } else {
      await sb.from('ai_agent_memory').insert({
        workspace_id: WORKSPACE_ID,
        agent_type: entry.agent_type,
        memory_type: entry.memory_type,
        key: entry.key,
        summary: entry.summary,
        confidence_score: entry.confidence_score ?? 0.5,
        occurrence_count: 1,
        last_seen_at: now,
        metadata: entry.metadata ?? {},
      });
    }
  } catch {}
}
