// Memory Engine — V3 read/write path for ai_agent_memory
// upsertMemory is now a thin wrapper around communityBrain::upsertCommunityMemory
// (the canonical write path). Kept for backward compat with existing callers.
// V3 Architecture: Section 8 — AI Memory V3

import { getBotDb, WORKSPACE_ID } from './supabase';
import { upsertCommunityMemory } from './communityBrain';

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

/**
 * Thin backward-compat wrapper around upsertCommunityMemory.
 * Bug fix: previously reset occurrence_count to 1 on every upsert (lost history).
 * Now delegates to communityBrain which correctly increments on conflict.
 */
export async function upsertMemory(opts: UpsertMemoryOpts): Promise<boolean> {
  const ws = opts.workspaceId ?? WORKSPACE_ID;
  try {
    await upsertCommunityMemory({
      workspaceId:  ws,
      agentType:    opts.agentType,
      memoryType:   opts.memoryType,
      key:          opts.key,
      summary:      opts.summary,
      confidence:   opts.confidenceScore,
      metadata:     opts.metadata as Record<string, unknown> | undefined,
    });
    return true;
  } catch {
    return false;
  }
}
