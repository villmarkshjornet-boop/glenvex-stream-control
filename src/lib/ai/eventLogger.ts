/**
 * Vercel-side event + decision logging.
 * Alltid billig – ingen GPT-kall her.
 */

import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export interface AgentEvent {
  source: 'twitch' | 'discord' | 'content_factory' | 'ai_producer';
  event_type: string;
  user_id?: string;
  username?: string;
  channel_id?: string;
  message_text?: string;
  importance_score?: number;
  metadata?: Record<string, any>;
}

export async function logAgentEvent(event: AgentEvent): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('ai_agent_events').insert({
      workspace_id: getWorkspaceId(),
      source: event.source,
      event_type: event.event_type,
      user_id: event.user_id ?? null,
      username: event.username ?? null,
      channel_id: event.channel_id ?? null,
      message_text: event.message_text ?? null,
      importance_score: event.importance_score ?? 0,
      metadata: event.metadata ?? {},
    });
  } catch { /* aldri kast – logging er best-effort */ }
}

export async function logAgentDecision(decision: {
  agent_type: string;
  decision_type: string;
  input_context?: Record<string, any>;
  decision_summary: string;
  outcome?: string;
  feedback_score?: number;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('ai_agent_decisions').insert({
      workspace_id: getWorkspaceId(),
      agent_type: decision.agent_type,
      decision_type: decision.decision_type,
      input_context: decision.input_context ?? {},
      decision_summary: decision.decision_summary,
      outcome: decision.outcome ?? 'pending',
      feedback_score: decision.feedback_score ?? null,
    });
  } catch {}
}
