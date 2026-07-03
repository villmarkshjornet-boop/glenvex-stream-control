/**
 * aiMemory.ts — Unified AI memory context builder (V4)
 *
 * Single access point for reading ai_agent_memory into a formatted string
 * suitable for injection into AI system prompts.
 *
 * Does NOT replace or modify existing modules (memoryEngine, learningAggregator, etc.).
 * Those modules continue to WRITE to ai_agent_memory as before.
 * This module provides the canonical READ path for AI personalities.
 *
 * V4 changes (Learning Engine V2):
 * - Groups by memory_category instead of memory_type (with backward-compat fallback)
 * - Filters out memories with strength ≤ 0.15 (decayed)
 * - Sorts by (confidence_score * strength + importance_boost) DESC
 * - Shows source credibility: "(Twitch + Discord)" vs "(Discord)" etc.
 * - Community members deduped by key across platforms
 *
 * V3 Architecture: Section 8 — AI Memory V3 / unified context
 */

import { getBotDb, WORKSPACE_ID } from './supabase';

const MEMORY_CACHE_MS = 5 * 60 * 1000; // 5 min — same as aiPersonality

let _cache: string | null = null;
let _cacheTs = 0;
let _cacheWs = '';

// ─── Category config ─────────────────────────────────────────────────────────

/** Norwegian display labels for each memory_category. */
const CATEGORY_LABELS: Record<string, string> = {
  community: 'Community',
  humor:     'Humor og inside jokes',
  interests: 'Interesser/spill/temaer',
  stream:    'Stream-mønstre',
  twitch:    'Twitch',
  discord:   'Discord',
  economy:   'Økonomi (coins/XP)',
  partner:   'Partnere',
  general:   'Annet',
};

/** Render order for categories — most important first. */
const CATEGORY_ORDER = ['community', 'humor', 'interests', 'stream', 'twitch', 'discord', 'economy', 'partner', 'general'];

/** Backward-compat: map old memory_type to a category when memory_category is null. */
function fallbackCategory(memoryType: string): string {
  if (memoryType === 'viewer' || memoryType === 'member') return 'community';
  if (memoryType === 'joke') return 'humor';
  if (memoryType === 'topic') return 'interests';
  if (memoryType === 'feedback_pattern' || memoryType === 'stream_pattern' || memoryType === 'creator_insight') return 'stream';
  if (memoryType === 'stream_event') return 'twitch';
  if (memoryType === 'channel_pattern') return 'discord';
  if (memoryType === 'economy_pattern') return 'economy';
  if (memoryType === 'partner_signal') return 'partner';
  return 'general';
}

/** Derive source label from agent_type and metadata for display. */
function sourceLabel(agentType: string, metaSrc: string | undefined): string {
  if (metaSrc === 'both') return '(Twitch + Discord)';
  if (agentType === 'discord') return '(Discord)';
  if (agentType === 'twitch') return '(Twitch)';
  return '';
}

// ─── Effective sort score ─────────────────────────────────────────────────────

interface MemoryRow {
  agent_type:       string;
  memory_type:      string;
  memory_category:  string | null;
  key:              string;
  summary:          string;
  occurrence_count: number;
  confidence_score: number | null;
  strength:         number | null;
  importance_boost: number | null;
  metadata:         Record<string, unknown> | null;
}

function sortScore(r: MemoryRow): number {
  const conf  = r.confidence_score  ?? 0.5;
  const str   = r.strength          ?? 1.0;
  const boost = r.importance_boost  ?? 0.0;
  return conf * str + boost;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a formatted memory context string for the given workspace.
 * Groups ai_agent_memory rows by memory_category and returns a structured
 * Norwegian string. Only includes memories with strength > 0.15.
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
        .select('agent_type,memory_type,memory_category,key,summary,occurrence_count,confidence_score,strength,importance_boost,metadata')
        .eq('workspace_id', workspaceId)
        .gt('strength', 0.15)          // exclude decayed memories
        .order('occurrence_count', { ascending: false })
        .limit(40),                     // fetch more, then in-memory sort+group

      db
        .from('ai_agent_insights')
        .select('title,summary')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    const rawRows = (memoryRes.data ?? []) as MemoryRow[];
    const insights = insightsRes.data ?? [];

    if (rawRows.length === 0 && insights.length === 0) {
      _cache = '';
      _cacheTs = Date.now();
      _cacheWs = workspaceId;
      return '';
    }

    // Sort all rows by computed score DESC
    const rows = [...rawRows].sort((a, b) => sortScore(b) - sortScore(a));

    // Group by effective category (use memory_category if set, else fallback from memory_type)
    const grouped = new Map<string, MemoryRow[]>();
    for (const row of rows) {
      const cat = row.memory_category ?? fallbackCategory(row.memory_type);
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(row);
    }

    const lines: string[] = ['[Hukommelse]'];

    // Community: deduplicate by key across Twitch/Discord sources
    const communityRows = grouped.get('community') ?? [];
    if (communityRows.length > 0) {
      // Merge same key from different platforms
      const byKey = new Map<string, { summary: string; agentTypes: Set<string>; metaSrc: string | undefined; score: number }>();
      for (const r of communityRows) {
        const key = r.key;
        const src = (r.metadata?.['source'] as string | undefined);
        if (byKey.has(key)) {
          byKey.get(key)!.agentTypes.add(r.agent_type);
        } else {
          byKey.set(key, { summary: r.summary, agentTypes: new Set([r.agent_type]), metaSrc: src, score: sortScore(r) });
        }
      }
      const communityLines = [...byKey.entries()]
        .sort(([, a], [, b]) => b.score - a.score)
        .slice(0, 8)
        .map(([key, data]) => {
          const hasTwitch  = data.agentTypes.has('twitch');
          const hasDiscord = data.agentTypes.has('discord');
          const label = (hasTwitch && hasDiscord) ? '(Twitch + Discord)'
                      : hasDiscord                ? '(Discord)'
                      :                            '(Twitch)';
          return `${key} ${label}: ${data.summary}`;
        });
      if (communityLines.length > 0) {
        lines.push(`${CATEGORY_LABELS['community']}: ${communityLines.join(', ')}`);
      }
    }

    // All other categories in CATEGORY_ORDER
    for (const cat of CATEGORY_ORDER) {
      if (cat === 'community') continue; // already rendered above
      const catRows = grouped.get(cat);
      if (!catRows || catRows.length === 0) continue;

      const label = CATEGORY_LABELS[cat] ?? cat;
      const catLines = catRows
        .slice(0, 4)
        .map(r => {
          const src = sourceLabel(r.agent_type, r.metadata?.['source'] as string | undefined);
          return src ? `${r.summary} ${src}` : r.summary;
        });
      lines.push(`${label}: ${catLines.join('; ')}`);
    }

    // Any categories not in CATEGORY_ORDER (future-proofing)
    for (const [cat, catRows] of grouped.entries()) {
      if (CATEGORY_ORDER.includes(cat)) continue;
      const label = CATEGORY_LABELS[cat] ?? cat;
      lines.push(`${label}: ${catRows.slice(0, 2).map(r => r.summary).join('; ')}`);
    }

    // Recent insights
    if (insights.length > 0) {
      lines.push('Ferske innsikter: ' + (insights as { title: string; summary: string }[]).map(i => `${i.title} – ${i.summary}`).join('. '));
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
