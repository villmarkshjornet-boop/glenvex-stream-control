// Decision Engine — V3 wrapper around ai_agent_decisions
// logDecision() + recordOutcome() is the only correct path for AI decisions.
// Phase 1: new path only. Existing 27+ AI calls are NOT migrated yet.
// V3 Architecture: Section 9 — Decision Engine

import { getBotDb, WORKSPACE_ID } from './supabase';
import { logSystemEvent } from './systemEvents';

export interface LogDecisionOpts {
  workspaceId?: string;
  agentType: string;
  decisionType: string;
  decisionSummary: string;
  inputContext?: Record<string, any>;
}

export interface DecisionRecord {
  id: string;
  agentType: string;
  decisionType: string;
  decisionSummary: string;
  outcome: string | null;
  feedbackScore: number | null;
  createdAt: string;
}

export async function logDecision(opts: LogDecisionOpts): Promise<string | null> {
  const db = getBotDb();
  if (!db) return null;
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  const { data, error } = await db
    .from('ai_agent_decisions')
    .insert({
      workspace_id: ws,
      agent_type: opts.agentType,
      decision_type: opts.decisionType,
      decision_summary: opts.decisionSummary,
      input_context: opts.inputContext ?? {},
      outcome: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) {
    logSystemEvent({
      source: 'decision_engine',
      event_type: 'DECISION_LOG_FAILED',
      title: `Kunne ikke logge beslutning: ${opts.decisionType}`,
      severity: 'warning',
      metadata: { error: error?.message?.slice(0, 200), decisionType: opts.decisionType, agentType: opts.agentType },
    });
    return null;
  }

  return (data as Record<string, any>).id as string;
}

export async function recordOutcome(
  decisionId: string,
  outcome: 'success' | 'failure' | 'unknown',
  feedbackScore?: number
): Promise<boolean> {
  const db = getBotDb();
  if (!db) return false;

  const { error } = await db
    .from('ai_agent_decisions')
    .update({ outcome, feedback_score: feedbackScore ?? null })
    .eq('id', decisionId);

  return !error;
}

export async function getRecentDecisions(opts: {
  workspaceId?: string;
  agentType?: string;
  limit?: number;
}): Promise<DecisionRecord[]> {
  const db = getBotDb();
  if (!db) return [];
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  let q = db
    .from('ai_agent_decisions')
    .select('id,agent_type,decision_type,decision_summary,outcome,feedback_score,created_at')
    .eq('workspace_id', ws)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 10);

  if (opts.agentType) q = (q as any).eq('agent_type', opts.agentType);

  const { data } = await q;
  return (data ?? []).map((r: Record<string, any>) => ({
    id: r.id,
    agentType: r.agent_type,
    decisionType: r.decision_type,
    decisionSummary: r.decision_summary,
    outcome: r.outcome ?? null,
    feedbackScore: r.feedback_score ?? null,
    createdAt: r.created_at,
  }));
}
