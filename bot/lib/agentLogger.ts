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

async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0);
  const sb = getSb();
  if (!sb) {
    console.error('[AgentLogger] Supabase ikke konfigurert (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler) – events tapt');
    return;
  }
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
  try {
    const { error } = await sb.from('ai_agent_events').insert(rows);
    if (error) {
      console.error(`[AgentLogger] Insert feilet (${error.code ?? ''}): ${error.message}`);
      // Fallback: direkte REST for å omgå evt. RLS-problemer med JS-klienten
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        const res = await fetch(`${url}/rest/v1/ai_agent_events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(rows),
        }).catch((e2: any) => { console.error('[AgentLogger] REST fallback feilet:', e2.message); return null; });
        if (res && !res.ok) {
          const txt = await res.text().catch(() => res.statusText);
          console.error('[AgentLogger] REST fallback HTTP', res.status, txt.slice(0, 200));
        }
      }
    }
  } catch (e: any) {
    console.error('[AgentLogger] Flush exception:', e.message?.slice(0, 100));
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
      const { error } = await sb.from('ai_agent_memory').update({
        summary: entry.summary,
        confidence_score: entry.confidence_score ?? 0.7,
        occurrence_count: existing.occurrence_count + 1,
        last_seen_at: now,
        updated_at: now,
      }).eq('id', existing.id);
      if (error) console.error('[AgentLogger] memory update feilet:', error.message);
    } else {
      const { error } = await sb.from('ai_agent_memory').insert({
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
      if (error) console.error('[AgentLogger] memory insert feilet:', error.message);
    }
  } catch (e: any) {
    console.error('[AgentLogger] upsertBotMemory exception:', e.message?.slice(0, 100));
  }
}
