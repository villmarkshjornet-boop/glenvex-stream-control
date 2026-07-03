/**
 * getCreatorContext() – én felles inngang til all akkumulert kunnskap.
 * Brukes av: highlightDiscovery, learningLoop, aiProducer, dashboardAssistant
 * Aldri kall memory-tabeller direkte fra agenter – bruk alltid denne.
 *
 * Autorativ kilde: ai_agent_memory (ai_producer_knowledge-fallback fjernet).
 */

import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

// ── Memory-category helpers (mirror of bot/lib/communityBrain.ts) ─────────────

type MemoryCategory =
  | 'community' | 'interests' | 'stream' | 'creator'
  | 'discord'   | 'twitch'   | 'economy' | 'partner'
  | 'humor'     | 'general';

const MEMORY_TYPE_CATEGORY_MAP: Readonly<Record<string, MemoryCategory>> = {
  viewer: 'community', member: 'community', member_profile: 'community',
  topic: 'interests', joke: 'interests', community_phrase: 'interests',
  meme: 'interests', game_pattern: 'interests',
  stream_pattern: 'stream', content_pattern: 'stream', retention_pattern: 'stream',
  creator_style: 'creator', creator_preference: 'creator',
  creator_strength: 'creator', creator_weakness: 'creator',
  discord_pattern: 'discord', channel_pattern: 'discord',
  twitch_pattern: 'twitch', raid_pattern: 'twitch', clip_pattern: 'twitch',
  economy_pattern: 'economy', coin_pattern: 'economy',
  xp_pattern: 'economy', reward_pattern: 'economy',
  partner_pattern: 'partner', sponsor_pattern: 'partner',
};

function categoryFromMemoryType(memoryType: string): MemoryCategory {
  return MEMORY_TYPE_CATEGORY_MAP[memoryType] ?? 'general';
}

function decayRateFromFrequency(occurrenceCount: number): number {
  if (occurrenceCount > 10) return 0.01;
  if (occurrenceCount > 5)  return 0.02;
  return 0.05;
}

export interface MemoryEntry {
  key: string;
  summary: string;
  confidenceScore: number;
  occurrenceCount: number;
  lastSeen?: string;
  metadata?: Record<string, any>;
}

export interface CreatorContext {
  workspaceId: string;
  // Kjente seere og Discord-membres
  topViewers: MemoryEntry[];
  topMembers: MemoryEntry[];
  // Community-kunnskap
  runningJokes: MemoryEntry[];
  communityPhrases: MemoryEntry[];
  // Innholds- og spillmønstre
  contentPatterns: MemoryEntry[];
  gamePatterns: MemoryEntry[];
  streamPatterns: MemoryEntry[];
  // Kanalnivå-kunnskap (komprimert)
  channelProfile: string;
  contentStrategy: string;
  communityContext: string;
  // Siste innsikter fra aggregering
  recentInsights: { title: string; summary: string; confidenceScore: number; createdAt: string }[];
  // Antall streams analysert (proxy for modenhet)
  streamCount: number;
  // Siste utførte AI-anbefalinger (for effektsporing)
  recentExecutedTips: { tip: string; executedAt: string; game?: string }[];
  // Siste stream-resultater (for before/after-analyse)
  recentStreamHistory: { title: string; game: string; peakViewers: number; avgViewers: number; followersGained: number; startedAt: string }[];
}

const FALLBACK_CONTEXT: Omit<CreatorContext, 'workspaceId'> = {
  topViewers: [],
  topMembers: [],
  runningJokes: [],
  communityPhrases: [],
  contentPatterns: [],
  gamePatterns: [],
  streamPatterns: [],
  channelProfile: 'Streameren – norsk gaming streamer.',
  contentStrategy: 'Fokus på genuine reaksjoner, episke øyeblikk og community-interaksjon.',
  communityContext: 'Norsk gaming community, engasjerte seere.',
  recentInsights: [],
  streamCount: 0,
  recentExecutedTips: [],
  recentStreamHistory: [],
};

export async function getCreatorContext(options?: {
  limit?: number;
}): Promise<CreatorContext> {
  const db = getDb();
  const workspaceId = getWorkspaceId();
  if (!db) return { ...FALLBACK_CONTEXT, workspaceId };

  const limit = options?.limit ?? 25;

  const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [memoryRes, insightsRes, executedTipsRes, streamHistoryRes] = await Promise.all([
    db.from('ai_agent_memory')
      .select('agent_type,memory_type,key,summary,confidence_score,occurrence_count,last_seen_at,metadata')
      .eq('workspace_id', workspaceId)
      .order('occurrence_count', { ascending: false })
      .limit(300),

    db.from('ai_agent_insights')
      .select('title,summary,confidence_score,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),

    // Siste utførte AI-anbefalinger (for effektsporing og kontekst)
    db.from('system_events')
      .select('title,metadata,created_at')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'AI_PRODUCER_RECOMMENDATION_COMPLETED')
      .gte('created_at', cutoff30d)
      .order('created_at', { ascending: false })
      .limit(10),

    // Siste stream-resultater (for before/after-analyse)
    db.from('stream_history')
      .select('title,game,peak_viewers,avg_viewers,followers_gained,started_at')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  const memory: any[] = memoryRes.data ?? [];
  const insights: any[] = insightsRes.data ?? [];
  const executedTips: any[] = executedTipsRes.data ?? [];
  const streamHistory: any[] = streamHistoryRes.data ?? [];

  const byType = (memType: string): MemoryEntry[] =>
    memory
      .filter(m => m.memory_type === memType)
      .slice(0, limit)
      .map(m => ({
        key: m.key,
        summary: m.summary,
        confidenceScore: m.confidence_score ?? 0.5,
        occurrenceCount: m.occurrence_count ?? 1,
        lastSeen: m.last_seen_at,
        metadata: m.metadata,
      }));

  const channelProfileMem = memory.find((m: any) => m.memory_type === 'stream_pattern' && m.key === 'channel_profile');
  const contentStratMem   = memory.find((m: any) => m.memory_type === 'content_pattern' && m.key === 'content_strategy');
  const communityMem      = memory.find((m: any) => m.memory_type === 'community_pattern' && m.key === 'community_context');

  const streamCount = memory.filter((m: any) => m.memory_type === 'stream_pattern' && m.key !== 'channel_profile').length;

  return {
    workspaceId,
    topViewers: byType('viewer'),
    topMembers: byType('member'),
    runningJokes: byType('joke'),
    communityPhrases: byType('topic'),
    contentPatterns: byType('content_pattern'),
    gamePatterns: byType('game_pattern'),
    streamPatterns: byType('stream_pattern'),
    channelProfile:   channelProfileMem?.summary || FALLBACK_CONTEXT.channelProfile,
    contentStrategy:  contentStratMem?.summary   || FALLBACK_CONTEXT.contentStrategy,
    communityContext: communityMem?.summary       || FALLBACK_CONTEXT.communityContext,
    recentInsights: insights.map((i: any) => ({
      title: i.title,
      summary: i.summary,
      confidenceScore: i.confidence_score ?? 0.5,
      createdAt: i.created_at,
    })),
    streamCount,
    recentExecutedTips: executedTips.map((e: any) => ({
      tip: e.metadata?.tipTekst ?? e.title ?? '',
      executedAt: e.created_at,
      game: e.metadata?.streamGame ?? undefined,
    })),
    recentStreamHistory: streamHistory.map((s: any) => ({
      title: s.title ?? '',
      game: s.game ?? '',
      peakViewers: s.peak_viewers ?? 0,
      avgViewers: s.avg_viewers ?? 0,
      followersGained: s.followers_gained ?? 0,
      startedAt: s.started_at ?? '',
    })),
  };
}

export async function upsertMemory(entry: {
  agent_type: string;
  memory_type: string;
  key: string;
  summary: string;
  confidence_score?: number;
  source?: string;
  category?: MemoryCategory;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  const workspaceId = getWorkspaceId();
  const now = new Date().toISOString();
  const category = entry.category ?? categoryFromMemoryType(entry.memory_type);

  try {
    const { data: existing, error: selectError } = await db
      .from('ai_agent_memory')
      .select('id,occurrence_count,strength,locked,metadata,source_count')
      .eq('workspace_id', workspaceId)
      .eq('agent_type',  entry.agent_type)
      .eq('memory_type', entry.memory_type)
      .eq('key',         entry.key)
      .maybeSingle();

    if (selectError) {
      console.error('[CreatorContext] memory SELECT feilet:', selectError.message);
      return;
    }

    if (existing) {
      const newCount = ((existing.occurrence_count as number | null) ?? 1) + 1;
      const isLocked = existing.locked === true;

      if (isLocked) {
        await db.from('ai_agent_memory').update({
          occurrence_count: newCount,
          last_seen_at: now,
          updated_at:   now,
        }).eq('id', existing.id as string);
        return;
      }

      // Merge metadata and track source
      const existingMeta = (existing.metadata as Record<string, unknown> | null) ?? {};
      const lastSource   = existingMeta.last_source as string | undefined;
      const mergedMeta: Record<string, unknown> = { ...existingMeta, ...(entry.metadata ?? {}) };

      let newSourceCount = (existing.source_count as number | null) ?? 1;
      if (entry.source) {
        if (lastSource === undefined) {
          mergedMeta.last_source = entry.source;
        } else if (entry.source !== lastSource) {
          newSourceCount += 1;
          mergedMeta.last_source = entry.source;
        }
      }

      const existingStrength = typeof existing.strength === 'number' ? (existing.strength as number) : 1.0;
      const newStrength  = Math.min(1.0, existingStrength + 0.05);
      const newDecayRate = decayRateFromFrequency(newCount);

      await db.from('ai_agent_memory').update({
        summary:          entry.summary,
        confidence_score: entry.confidence_score ?? 0.7,
        occurrence_count: newCount,
        last_seen_at:     now,
        updated_at:       now,
        strength:         newStrength,
        decay_rate:       newDecayRate,
        source_count:     newSourceCount,
        memory_category:  category,
        metadata:         mergedMeta,
      }).eq('id', existing.id as string);

    } else {
      const initMeta: Record<string, unknown> = { ...(entry.metadata ?? {}) };
      if (entry.source) initMeta.last_source = entry.source;

      await db.from('ai_agent_memory').insert({
        workspace_id:     workspaceId,
        agent_type:       entry.agent_type,
        memory_type:      entry.memory_type,
        key:              entry.key,
        summary:          entry.summary,
        confidence_score: entry.confidence_score ?? 0.5,
        occurrence_count: 1,
        last_seen_at:     now,
        updated_at:       now,
        strength:         1.0,
        decay_rate:       0.05,
        source_count:     1,
        memory_category:  category,
        metadata:         initMeta,
        // admin_approved intentionally omitted (stays null for new entries)
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[CreatorContext] upsertMemory exception:', msg.slice(0, 200));
  }
}

export async function addInsight(insight: {
  title: string;
  summary: string;
  confidence_score?: number;
  source_data?: Record<string, any>;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('ai_agent_insights').insert({
      workspace_id: getWorkspaceId(),
      title: insight.title,
      summary: insight.summary,
      confidence_score: insight.confidence_score ?? 0.7,
      source_data: insight.source_data ?? {},
    });
  } catch {}
}

export function buildContextPrompt(ctx: CreatorContext): string {
  if (ctx.streamCount === 0 && ctx.topViewers.length === 0 && ctx.runningJokes.length === 0) {
    return 'Kanal: streameren – norsk gaming streamer. Fokus på genuine reaksjoner og episke øyeblikk.';
  }

  const deler: string[] = [`KANALKUNNSKAP (${ctx.streamCount} streams analysert):`];

  if (ctx.channelProfile) deler.push(`- Profil: ${ctx.channelProfile}`);
  if (ctx.contentStrategy) deler.push(`- Strategi: ${ctx.contentStrategy}`);
  if (ctx.communityContext) deler.push(`- Community: ${ctx.communityContext}`);

  if (ctx.topViewers.length > 0) {
    deler.push(`- Kjente seere: ${ctx.topViewers.slice(0, 5).map(v => v.key).join(', ')}`);
  }

  if (ctx.runningJokes.length > 0) {
    deler.push(`- Interne vitser/uttrykk: ${ctx.runningJokes.slice(0, 5).map(j => j.key).join(', ')}`);
  }

  if (ctx.contentPatterns.length > 0) {
    deler.push(`- Historiske mønstre:\n${ctx.contentPatterns.slice(0, 5).map(p => `  • ${p.key}: score ${Math.round(p.confidenceScore * 100)} (${p.occurrenceCount}×)`).join('\n')}`);
  }

  if (ctx.gamePatterns.length > 0) {
    deler.push(`- Spillkunnskap:\n${ctx.gamePatterns.slice(0, 3).map(g => `  • ${g.key}: ${g.summary}`).join('\n')}`);
  }

  if (ctx.recentInsights.length > 0) {
    deler.push(`- Siste innsikter:\n${ctx.recentInsights.slice(0, 2).map(i => `  • ${i.title}: ${i.summary}`).join('\n')}`);
  }

  if (ctx.recentStreamHistory.length > 0) {
    const snittPeak = Math.round(ctx.recentStreamHistory.reduce((s, h) => s + h.peakViewers, 0) / ctx.recentStreamHistory.length);
    deler.push(`- Siste ${ctx.recentStreamHistory.length} streams: snitt peak ${snittPeak} seere. Spill: ${ctx.recentStreamHistory.map(h => h.game).filter((g, i, a) => a.indexOf(g) === i).slice(0, 3).join(', ')}`);
  }

  if (ctx.recentExecutedTips.length > 0) {
    deler.push(`- Siste utførte tiltak (${ctx.recentExecutedTips.length}): ${ctx.recentExecutedTips.slice(0, 3).map(t => `"${t.tip.slice(0, 60)}"`).join(', ')}`);
  }

  deler.push('\nBruk denne kunnskapen aktivt: gi HØYERE score til øyeblikk som historisk fungerer bra for streameren.');
  return deler.join('\n');
}
