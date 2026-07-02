/**
 * aiMemory.ts — Unified AI memory context builder (V3)
 *
 * Single access point for reading ai_agent_memory into a formatted string
 * suitable for injection into AI system prompts.
 *
 * Does NOT replace or modify existing modules (memoryEngine, learningAggregator, etc.).
 * Those modules continue to WRITE to ai_agent_memory as before.
 * This module provides the canonical READ path for AI personalities.
 *
 * V3 Architecture: Section 8 — AI Memory V3 / unified context
 */

import { getBotDb, WORKSPACE_ID } from './supabase';

const MEMORY_CACHE_MS = 5 * 60 * 1000; // 5 min — same as aiPersonality

let _cache: string | null = null;
let _cacheTs = 0;
let _cacheWs = '';

/**
 * Returns a formatted memory context string for the given workspace.
 * Groups ai_agent_memory rows by category and returns a structured Norwegian string.
 *
 * Format:
 * [Hukommelse]
 * Community-folk: ...
 * Humor/temaer: ...
 * Medlemmer: ...
 *
 * Returns empty string if DB is unavailable or table is empty.
 */
export async function getMemoryContext(workspaceId: string = WORKSPACE_ID): Promise<string> {
  // Cache per workspace
  if (_cache !== null && _cacheWs === workspaceId && Date.now() - _cacheTs < MEMORY_CACHE_MS) {
    return _cache;
  }

  const db = getBotDb();
  if (!db) return '';

  try {
    const [memoryRes, insightsRes] = await Promise.all([
      db
        .from('ai_agent_memory')
        .select('agent_type,memory_type,key,summary,occurrence_count')
        .eq('workspace_id', workspaceId)
        .order('occurrence_count', { ascending: false })
        .limit(20),

      db
        .from('ai_agent_insights')
        .select('title,summary')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    const rows = memoryRes.data ?? [];
    const insights = insightsRes.data ?? [];

    if (rows.length === 0 && insights.length === 0) {
      _cache = '';
      _cacheTs = Date.now();
      _cacheWs = workspaceId;
      return '';
    }

    // Group by memory_type
    const viewers   = rows.filter(r => r.memory_type === 'viewer');
    const members   = rows.filter(r => r.memory_type === 'member');
    const jokes     = rows.filter(r => r.memory_type === 'joke');
    const topics    = rows.filter(r => r.memory_type === 'topic');
    const feedback  = rows.filter(r => r.memory_type === 'feedback_pattern');
    const other     = rows.filter(r => !['viewer','member','joke','topic','feedback_pattern'].includes(r.memory_type));

    const lines: string[] = ['[Hukommelse]'];

    // Kjente community-folk (viewers + members, merged)
    const kjente = [...viewers.slice(0, 5), ...members.slice(0, 3)];
    if (kjente.length > 0) {
      lines.push('Community-folk: ' + kjente.map(v => `${v.key} (${v.summary})`).join(', '));
    }

    // Humor og inside jokes
    if (jokes.length > 0) {
      lines.push('Humor: ' + jokes.slice(0, 4).map(j => j.summary).join('; '));
    }

    // Temaer/topics
    if (topics.length > 0) {
      lines.push('Temaer: ' + topics.slice(0, 4).map(t => t.summary).join('; '));
    }

    // Feedback patterns (AI acceptance rates)
    if (feedback.length > 0) {
      lines.push('AI-mønstre: ' + feedback.slice(0, 2).map(f => f.summary.slice(0, 120)).join(' | '));
    }

    // Other memory types
    if (other.length > 0) {
      lines.push('Annet: ' + other.slice(0, 3).map(o => `${o.memory_type}:${o.key} — ${o.summary.slice(0, 80)}`).join('; '));
    }

    // Recent insights
    if (insights.length > 0) {
      lines.push('Ferske innsikter: ' + insights.map(i => `${i.title} – ${i.summary}`).join('. '));
    }

    const result = lines.join('\n');

    _cache = result;
    _cacheTs = Date.now();
    _cacheWs = workspaceId;

    return result;
  } catch {
    return '';
  }
}

/** Invalidate the in-process cache (call after upsertBotMemory in tests or forced refresh). */
export function invalidateMemoryCache(): void {
  _cache = null;
  _cacheTs = 0;
}
