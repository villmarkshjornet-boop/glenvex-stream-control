// Debug/health route for Creator Brain V3 Phase 1
// Shows: workspace, state (derived from events), recent events, recent memory, health
// GET /api/admin/creator-brain?workspaceId=glenvex-default

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB not connected' }, { status: 500 });

  const workspaceId =
    req.nextUrl.searchParams.get('workspaceId') ??
    process.env.WORKSPACE_ID ??
    'glenvex-default';

  const [workspaceRes, eventsRes, memoryRes, decisionsRes, initEventRes] = await Promise.all([
    db.from('workspaces')
      .select('id,brand_name,twitch_channel_name,created_at')
      .eq('id', workspaceId)
      .limit(1),
    db.from('system_events')
      .select('event_type,title,severity,source,created_at,metadata')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('ai_agent_memory')
      .select('agent_type,memory_type,key,summary,confidence_score,occurrence_count,last_seen_at')
      .eq('workspace_id', workspaceId)
      .order('occurrence_count', { ascending: false })
      .limit(10),
    db.from('ai_agent_decisions')
      .select('id,agent_type,decision_type,decision_summary,outcome,feedback_score,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('system_events')
      .select('created_at,metadata')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'CREATOR_BRAIN_INITIALIZED')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const workspace = workspaceRes.data?.[0] ?? null;
  const recentEvents = eventsRes.data ?? [];
  const recentMemory = memoryRes.data ?? [];
  const recentDecisions = decisionsRes.data ?? [];
  const lastInitEvent = initEventRes.data?.[0] ?? null;

  const lastInitAt = lastInitEvent?.created_at ? new Date(lastInitEvent.created_at) : null;
  const brainAgeMs = lastInitAt ? Date.now() - lastInitAt.getTime() : null;

  const decisionsWithOutcome = recentDecisions.filter(
    (d: Record<string, any>) => d.outcome && d.outcome !== 'pending'
  ).length;
  const decisionsNullOutcome = recentDecisions.filter(
    (d: Record<string, any>) => !d.outcome || d.outcome === 'pending'
  ).length;

  // Fire-and-forget: logg at noen sjekket Creator Brain health
  void db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'creator_brain',
    event_type: 'CREATOR_BRAIN_HEALTH_CHECKED',
    title: 'Creator Brain health sjekket via debug-route',
    severity: 'info',
    metadata: {
      brainInitialized: lastInitAt !== null,
      brainAgeMs,
      memoryItems: recentMemory.length,
      decisions: recentDecisions.length,
    },
  });

  return NextResponse.json({
    workspaceId,
    workspace: workspace
      ? {
          id: workspace.id,
          brandName: workspace.brand_name,
          twitchChannelName: workspace.twitch_channel_name,
          createdAt: workspace.created_at,
        }
      : null,
    health: {
      brainInitialized: lastInitAt !== null,
      lastInitializedAt: lastInitAt,
      brainAgeMs,
      // healthy = initialized within last 10 minutes (Railway restarts bot)
      brainHealthy: brainAgeMs !== null && brainAgeMs < 10 * 60 * 1000,
      phase: 'v3-phase1',
    },
    recentEvents: recentEvents.map((e: Record<string, any>) => ({
      eventType: e.event_type,
      title: e.title,
      severity: e.severity,
      source: e.source,
      createdAt: e.created_at,
    })),
    recentMemory: recentMemory.map((m: Record<string, any>) => ({
      agentType: m.agent_type,
      memoryType: m.memory_type,
      key: m.key,
      summary: (m.summary as string).slice(0, 120),
      confidenceScore: m.confidence_score,
      occurrenceCount: m.occurrence_count,
      lastSeenAt: m.last_seen_at,
    })),
    recentDecisions: recentDecisions.map((d: Record<string, any>) => ({
      id: d.id,
      agentType: d.agent_type,
      decisionType: d.decision_type,
      decisionSummary: d.decision_summary,
      outcome: d.outcome,
      feedbackScore: d.feedback_score,
      createdAt: d.created_at,
    })),
    summary: {
      workspaceFound: !!workspace,
      recentEventsCount: recentEvents.length,
      memoryItemsCount: recentMemory.length,
      decisionsCount: recentDecisions.length,
      decisionsWithOutcome,
      decisionsNullOutcome,
      outcomeCoverage:
        recentDecisions.length > 0
          ? `${Math.round((decisionsWithOutcome / recentDecisions.length) * 100)}%`
          : 'n/a',
    },
  });
}
