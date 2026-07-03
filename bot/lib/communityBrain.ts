/**
 * communityBrain.ts — Canonical write path for all community memory.
 * Single source of truth for upserts into ai_agent_memory from bot-side code.
 * Replaces: agentLogger::upsertBotMemory (logic), memoryEngine::upsertMemory (logic).
 *
 * V3 Architecture: Section 8 — AI Memory V3
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getBotDb, WORKSPACE_ID } from './supabase';

// ── Category types ────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'community'   // members, relationships, groupings
  | 'interests'   // games, topics, memes, humor
  | 'stream'      // what works, retention, engagement
  | 'creator'     // Glenn's strengths/weaknesses
  | 'discord'     // channels, posting patterns
  | 'twitch'      // timing, raids, clips, hype
  | 'economy'     // coins, XP, rewards
  | 'partner'     // sponsor performance
  | 'humor'       // inside jokes, memes
  | 'general';    // uncategorized

const MEMORY_TYPE_CATEGORY_MAP: Readonly<Record<string, MemoryCategory>> = {
  viewer:             'community',
  member:             'community',
  member_profile:     'community',
  topic:              'interests',
  joke:               'interests',
  community_phrase:   'interests',
  meme:               'interests',
  game_pattern:       'interests',
  stream_pattern:     'stream',
  content_pattern:    'stream',
  retention_pattern:  'stream',
  creator_style:      'creator',
  creator_preference: 'creator',
  creator_strength:   'creator',
  creator_weakness:   'creator',
  discord_pattern:    'discord',
  channel_pattern:    'discord',
  twitch_pattern:     'twitch',
  raid_pattern:       'twitch',
  clip_pattern:       'twitch',
  economy_pattern:    'economy',
  coin_pattern:       'economy',
  xp_pattern:         'economy',
  reward_pattern:     'economy',
  partner_pattern:    'partner',
  sponsor_pattern:    'partner',
};

/** Derive MemoryCategory from a memory_type string. Falls back to 'general'. */
export function categoryFromMemoryType(memoryType: string): MemoryCategory {
  return MEMORY_TYPE_CATEGORY_MAP[memoryType] ?? 'general';
}

/** Compute per-day decay rate based on how many times this memory has been seen. */
export function decayRateFromFrequency(occurrenceCount: number): number {
  if (occurrenceCount > 10) return 0.01;
  if (occurrenceCount > 5)  return 0.02;
  return 0.05;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface CommunityMemoryParams {
  workspaceId: string;
  agentType: string;       // 'community', 'twitch', 'discord', 'creator_brain', etc.
  memoryType: string;      // existing memory_type values from ai_agent_memory
  key: string;             // unique identifier within (workspace, agent, type)
  summary: string;
  confidence?: number;     // 0.0–1.0
  strength?: number;       // 0.0–1.0 (default 1.0 for new entries)
  decayRate?: number;      // per-day decay (default 0.05, low-freq memories decay faster)
  category?: MemoryCategory;
  source?: string;         // 'twitch' | 'discord' | 'vod' | 'admin' etc.
  metadata?: Record<string, unknown>;
}

/**
 * Canonical upsert into ai_agent_memory.
 * - UNIQUE conflict key: (workspace_id, agent_type, memory_type, key)
 * - On conflict: increments occurrence_count, updates summary/confidence/timestamps
 * - Tracks source_count via metadata.last_source comparison
 * - Updates strength by +0.05 per confirmation (capped at 1.0)
 * - Derives decay_rate from updated occurrence_count
 * - Skips strength/decay changes for locked rows (still bumps occurrence + last_seen)
 * - Never throws — fire-and-forget safe
 *
 * @param params  Memory entry data
 * @param sb      Optional pre-existing SupabaseClient (uses getBotDb() singleton if omitted)
 */
export async function upsertCommunityMemory(
  params: CommunityMemoryParams,
  sb?: SupabaseClient,
): Promise<void> {
  const client = sb ?? getBotDb();
  if (!client) return;

  const now = new Date().toISOString();
  const category: MemoryCategory = params.category ?? categoryFromMemoryType(params.memoryType);

  try {
    // ── 1. Fetch current row ───────────────────────────────────────────────
    const { data: existing, error: selectError } = await client
      .from('ai_agent_memory')
      .select('id,occurrence_count,strength,locked,metadata,source_count')
      .eq('workspace_id', params.workspaceId)
      .eq('agent_type',   params.agentType)
      .eq('memory_type',  params.memoryType)
      .eq('key',          params.key)
      .maybeSingle();

    if (selectError) {
      console.error('[CommunityBrain] SELECT failed:', selectError.message);
      return;
    }

    if (existing) {
      // ── 2a. Row exists — update ──────────────────────────────────────────
      const newCount  = ((existing.occurrence_count as number | null) ?? 1) + 1;
      const isLocked  = existing.locked === true;

      if (isLocked) {
        // Locked row: only bump occurrence_count and last_seen_at
        const { error } = await client
          .from('ai_agent_memory')
          .update({
            occurrence_count: newCount,
            last_seen_at: now,
            updated_at:   now,
          })
          .eq('id', existing.id as string);
        if (error) console.error('[CommunityBrain] locked-row update failed:', error.message);
        return;
      }

      // Build merged metadata and track last_source
      const existingMeta = (existing.metadata as Record<string, unknown> | null) ?? {};
      const lastSource   = existingMeta.last_source as string | undefined;
      const mergedMeta: Record<string, unknown> = {
        ...existingMeta,
        ...(params.metadata ?? {}),
      };

      let newSourceCount = ((existing.source_count as number | null) ?? 1);
      if (params.source) {
        if (lastSource === undefined) {
          mergedMeta.last_source = params.source;
        } else if (params.source !== lastSource) {
          newSourceCount += 1;
          mergedMeta.last_source = params.source;
        }
      }

      // Strength: bump by 0.05 each confirmation, cap at 1.0
      const existingStrength = typeof existing.strength === 'number'
        ? (existing.strength as number)
        : 1.0;
      const newStrength  = Math.min(1.0, existingStrength + 0.05);
      const newDecayRate = params.decayRate ?? decayRateFromFrequency(newCount);

      const { error } = await client
        .from('ai_agent_memory')
        .update({
          summary:          params.summary,
          confidence_score: params.confidence ?? 0.7,
          occurrence_count: newCount,
          last_seen_at:     now,
          updated_at:       now,
          strength:         newStrength,
          decay_rate:       newDecayRate,
          source_count:     newSourceCount,
          memory_category:  category,
          metadata:         mergedMeta,
        })
        .eq('id', existing.id as string);

      if (error) console.error('[CommunityBrain] update failed:', error.message);

    } else {
      // ── 2b. Row does not exist — insert ───────────────────────────────────
      const initMeta: Record<string, unknown> = { ...(params.metadata ?? {}) };
      if (params.source) initMeta.last_source = params.source;

      const { error } = await client
        .from('ai_agent_memory')
        .insert({
          workspace_id:     params.workspaceId,
          agent_type:       params.agentType,
          memory_type:      params.memoryType,
          key:              params.key,
          summary:          params.summary,
          confidence_score: params.confidence ?? 0.5,
          occurrence_count: 1,
          last_seen_at:     now,
          updated_at:       now,
          strength:         params.strength ?? 1.0,
          decay_rate:       params.decayRate ?? 0.05,
          source_count:     1,
          memory_category:  category,
          metadata:         initMeta,
          // admin_approved intentionally omitted (stays null for new entries)
        });

      if (error) console.error('[CommunityBrain] insert failed:', error.message);
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[CommunityBrain] upsertCommunityMemory exception:', msg.slice(0, 200));
  }
}

// Re-export for convenience so bot callers can get the default workspace id
export { WORKSPACE_ID };
