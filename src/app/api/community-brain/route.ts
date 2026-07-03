import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthenticatedWorkspace } from '@/lib/requireAuth';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemorySummary {
  id: string;
  key: string;
  summary: string;
  confidence: number;
  strength: number;
  occurrenceCount: number;
  sourceCount: number;
  category: string;
  memoryType: string;
  lastSeen: string;
  locked: boolean;
  adminApproved: boolean | null;
  importanceBoost: number;
}

interface InsightSummary {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  category: string;
  createdAt: string;
  adminApproved: boolean | null;
}

interface KnowledgeSummary {
  id: string;
  knowledgeType: string;
  key: string;
  summary: string;
  confidence: number;
  evidenceCount: number;
  strength: number;
  lastUpdated: string;
}

interface IdentityMatch {
  id: string;
  twitchUsername: string | null;
  discordUsername: string | null;
  confidence: number;
  matchMethod: string;
  matchStatus: string;
}

interface DecisionSummary {
  id: string;
  decisionType: string;
  decisionSummary: string;
  outcome: string | null;
  feedbackScore: number | null;
  engagementDelta: number | null;
  createdAt: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapMemory(m: Record<string, unknown>): MemorySummary {
  return {
    id:              m.id as string,
    key:             (m.key as string) ?? '',
    summary:         (m.summary as string) ?? '',
    confidence:      (m.confidence_score as number) ?? 0,
    strength:        (m.strength as number) ?? 0,
    occurrenceCount: (m.occurrence_count as number) ?? 0,
    sourceCount:     (m.source_count as number) ?? 0,
    category:        (m.memory_category as string) ?? 'general',
    memoryType:      (m.memory_type as string) ?? '',
    lastSeen:        (m.last_seen_at as string) ?? (m.created_at as string) ?? '',
    locked:          (m.locked as boolean) ?? false,
    adminApproved:   m.admin_approved as boolean | null,
    importanceBoost: (m.importance_boost as number) ?? 0,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const workspaceId = getAuthenticatedWorkspace(req);
  if (!workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not available' }, { status: 500 });
  }

  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayISO   = todayStart.toISOString();
  const weekAgoISO = new Date(now - 7 * 24 * 3600_000).toISOString();
  const dayAgoISO  = new Date(now - 24 * 3600_000).toISOString();

  const [
    allMemoriesRes,
    memoriesCountRes,
    insightsCountRes,
    decisionsCountRes,
    identitiesCountRes,
    pendingMemoriesCountRes,
    pendingInsightsCountRes,
    pendingKnowledgeCountRes,
    recentInsightsRes,
    recentDecisionsRes,
    creatorKnowledgeRes,
    identityMatchesRes,
  ] = await Promise.all([
    // All memories for in-memory computation (limit 500)
    db.from('ai_agent_memory')
      .select('id, key, summary, confidence_score, strength, occurrence_count, source_count, memory_category, memory_type, last_seen_at, created_at, locked, admin_approved, importance_boost')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(500),

    // Exact total counts (head-only)
    db.from('ai_agent_memory')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),

    db.from('ai_agent_insights')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),

    db.from('ai_agent_decisions')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),

    db.from('cross_platform_users')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),

    // Pending review counts
    db.from('ai_agent_memory')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('admin_approved', null),

    db.from('ai_agent_insights')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('admin_approved', null),

    db.from('creator_knowledge')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('admin_approved', null),

    // Recent insights (latest 10)
    db.from('ai_agent_insights')
      .select('id, title, summary, confidence_score, category, created_at, admin_approved')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),

    // Recent decisions (latest 10)
    db.from('ai_agent_decisions')
      .select('id, decision_type, decision_summary, outcome, feedback_score, engagement_delta, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),

    // Creator knowledge — top 20 by confidence
    // Note: actual DB schema uses 'finding' not 'summary', 'last_seen' not 'last_updated'
    db.from('creator_knowledge')
      .select('id, knowledge_type, key, finding, confidence, evidence_count, strength, last_seen, updated_at')
      .eq('workspace_id', workspaceId)
      .order('confidence', { ascending: false })
      .limit(20),

    // Identity matches — top 20 by confidence
    db.from('cross_platform_users')
      .select('id, twitch_username, discord_username, confidence_score, match_method, match_status')
      .eq('workspace_id', workspaceId)
      .order('confidence_score', { ascending: false })
      .limit(20),
  ]);

  const allMemories = (allMemoriesRes.data   ?? []) as Record<string, unknown>[];
  const recentIns   = (recentInsightsRes.data ?? []) as Record<string, unknown>[];
  const recentDec   = (recentDecisionsRes.data ?? []) as Record<string, unknown>[];
  const creatorKnow = (creatorKnowledgeRes.data ?? []) as Record<string, unknown>[];
  const identities  = (identityMatchesRes.data ?? []) as Record<string, unknown>[];

  // ─── Stats ────────────────────────────────────────────────────────────────
  const totalMemories        = memoriesCountRes.count   ?? allMemories.length;
  const totalInsights        = insightsCountRes.count   ?? 0;
  const totalDecisions       = decisionsCountRes.count  ?? 0;
  const crossPlatformMatches = identitiesCountRes.count ?? 0;
  const pendingReview        =
    (pendingMemoriesCountRes.count ?? 0) +
    (pendingInsightsCountRes.count ?? 0) +
    (pendingKnowledgeCountRes.count ?? 0);

  const avgConfidence = allMemories.length > 0
    ? allMemories.reduce((s, m) => s + ((m.confidence_score as number) ?? 0), 0) / allMemories.length
    : 0;
  const avgStrength = allMemories.length > 0
    ? allMemories.reduce((s, m) => s + ((m.strength as number) ?? 0), 0) / allMemories.length
    : 0;

  const memoriesLearntToday    = allMemories.filter(m => ((m.created_at as string) ?? '') >= todayISO).length;
  const memoriesLearntThisWeek = allMemories.filter(m => ((m.created_at as string) ?? '') >= weekAgoISO).length;

  // ─── Category breakdown ───────────────────────────────────────────────────
  const categoryMap = new Map<string, Record<string, unknown>[]>();
  for (const m of allMemories) {
    const cat = (m.memory_category as string) ?? 'general';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(m);
  }

  const scoreOf = (m: Record<string, unknown>) =>
    ((m.strength as number) ?? 0.5) * ((m.confidence_score as number) ?? 0);

  const categories = Array.from(categoryMap.entries()).map(([category, mems]) => {
    const avgStr  = mems.reduce((s, m) => s + ((m.strength as number) ?? 0), 0) / mems.length;
    const avgConf = mems.reduce((s, m) => s + ((m.confidence_score as number) ?? 0), 0) / mems.length;
    const topMemories = [...mems]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, 5)
      .map(mapMemory);
    return { category, count: mems.length, avgStrength: avgStr, avgConfidence: avgConf, topMemories };
  });

  // ─── Derived memory lists ─────────────────────────────────────────────────
  const todayLearnings: MemorySummary[] = allMemories
    .filter(m => ((m.created_at as string) ?? '') >= dayAgoISO)
    .slice(0, 20)
    .map(mapMemory);

  const topConfident: MemorySummary[] = [...allMemories]
    .sort((a, b) => {
      const sa = ((a.confidence_score as number) ?? 0) * Math.max((a.strength as number) ?? 0.5, 0.5);
      const sb = ((b.confidence_score as number) ?? 0) * Math.max((b.strength as number) ?? 0.5, 0.5);
      return sb - sa;
    })
    .slice(0, 10)
    .map(mapMemory);

  const uncertain: MemorySummary[] = allMemories
    .filter(m => ((m.confidence_score as number) ?? 0) < 0.4 && ((m.occurrence_count as number) ?? 0) < 3)
    .slice(0, 10)
    .map(mapMemory);

  const catTop = (cat: string, limit: number): MemorySummary[] =>
    allMemories
      .filter(m => (m.memory_category as string) === cat)
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, limit)
      .map(mapMemory);

  return NextResponse.json({
    stats: {
      totalMemories,
      totalInsights,
      totalDecisions,
      avgConfidence,
      avgStrength,
      memoriesLearntToday,
      memoriesLearntThisWeek,
      crossPlatformMatches,
      pendingReview,
    },
    categories,
    allMemories: allMemories.map(mapMemory),
    todayLearnings,
    topConfident,
    uncertain,
    recentInsights: recentIns.map((i): InsightSummary => ({
      id:            i.id as string,
      title:         (i.title as string) ?? '',
      summary:       (i.summary as string) ?? '',
      confidence:    (i.confidence_score as number) ?? 0,
      category:      (i.category as string) ?? 'general',
      createdAt:     (i.created_at as string) ?? '',
      adminApproved: i.admin_approved as boolean | null,
    })),
    creatorKnowledge: creatorKnow.map((k): KnowledgeSummary => ({
      id:            k.id as string,
      knowledgeType: (k.knowledge_type as string) ?? '',
      key:           (k.key as string) ?? '',
      // actual DB column is 'finding'; fallback to 'summary' for new schema
      summary:       (k.finding as string) ?? (k.summary as string) ?? '',
      confidence:    (k.confidence as number) ?? 0,
      evidenceCount: (k.evidence_count as number) ?? 0,
      strength:      (k.strength as number) ?? 0,
      lastUpdated:   (k.last_seen as string) ?? (k.updated_at as string) ?? '',
    })),
    identityMatches: identities.map((i): IdentityMatch => ({
      id:              i.id as string,
      twitchUsername:  (i.twitch_username as string) ?? null,
      discordUsername: (i.discord_username as string) ?? null,
      confidence:      (i.confidence_score as number) ?? 0,
      matchMethod:     (i.match_method as string) ?? '',
      matchStatus:     (i.match_status as string) ?? '',
    })),
    recentDecisions: recentDec.map((d): DecisionSummary => ({
      id:              d.id as string,
      decisionType:    (d.decision_type as string) ?? '',
      decisionSummary: (d.decision_summary as string) ?? '',
      outcome:         (d.outcome as string) ?? null,
      feedbackScore:   (d.feedback_score as number) ?? null,
      engagementDelta: (d.engagement_delta as number) ?? null,
      createdAt:       (d.created_at as string) ?? '',
    })),
    topMembers:       catTop('community', 10),
    popularInterests: catTop('interests', 10),
    streamPatterns:   catTop('stream', 10),
    humor:            catTop('humor', 10),
    economyInsights:  catTop('economy', 5),
  });
}
