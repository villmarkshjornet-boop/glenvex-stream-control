// Memory Engine — V3 read/write path for ai_agent_memory
// Does NOT replace upsertBotMemory (existing modules still use it directly).
// This is the Creator Brain's API for memory — the same table, a typed interface.
// V3 Architecture: Section 8 — AI Memory V3

import { getBotDb, WORKSPACE_ID } from './supabase';

export interface MemoryRow {
  id: string;
  agentType: string;
  memoryType: string;
  key: string;
  summary: string;
  confidenceScore: number;
  occurrenceCount: number;
  lastSeenAt: string;
  metadata: Record<string, any>;
}

export interface UpsertMemoryOpts {
  workspaceId?: string;
  agentType: string;
  memoryType: string;
  key: string;
  summary: string;
  confidenceScore?: number;
  metadata?: Record<string, any>;
}

function mapRow(r: Record<string, any>): MemoryRow {
  return {
    id: r.id,
    agentType: r.agent_type,
    memoryType: r.memory_type,
    key: r.key,
    summary: r.summary,
    confidenceScore: r.confidence_score ?? 0.5,
    occurrenceCount: r.occurrence_count ?? 1,
    lastSeenAt: r.last_seen_at,
    metadata: r.metadata ?? {},
  };
}

export async function getMemory(opts: {
  workspaceId?: string;
  agentType?: string;
  memoryType?: string;
  limit?: number;
}): Promise<MemoryRow[]> {
  const db = getBotDb();
  if (!db) return [];
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  let q = db
    .from('ai_agent_memory')
    .select('id,agent_type,memory_type,key,summary,confidence_score,occurrence_count,last_seen_at,metadata')
    .eq('workspace_id', ws)
    .order('occurrence_count', { ascending: false })
    .limit(opts.limit ?? 10);

  if (opts.agentType) q = (q as any).eq('agent_type', opts.agentType);
  if (opts.memoryType) q = (q as any).eq('memory_type', opts.memoryType);

  const { data } = await q;
  return (data ?? []).map(mapRow);
}

export async function upsertMemory(opts: UpsertMemoryOpts): Promise<boolean> {
  const db = getBotDb();
  if (!db) return false;
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  const { error } = await db.from('ai_agent_memory').upsert({
    workspace_id: ws,
    agent_type: opts.agentType,
    memory_type: opts.memoryType,
    key: opts.key,
    summary: opts.summary,
    confidence_score: opts.confidenceScore ?? 0.5,
    occurrence_count: 1,
    last_seen_at: new Date().toISOString(),
    metadata: opts.metadata ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,agent_type,memory_type,key' });

  return !error;
}
