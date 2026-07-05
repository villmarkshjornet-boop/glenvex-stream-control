import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/** Picks the most recent event_type match from a sorted list of system_events rows */
function findLast(
  events: Array<{ source: string; event_type: string; created_at: string }>,
  matcher: (e: { source: string; event_type: string }) => boolean,
): string | null {
  const hit = events.find(matcher);
  return hit?.created_at ?? null;
}

export async function GET() {
  const ws = getWorkspaceId();
  const db = getDb();

  if (!ws || !db) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const now = Date.now();
  const ago30d = new Date(now - 30 * 24 * 3600_000).toISOString();
  const ago24h = new Date(now - 24 * 3600_000).toISOString();
  const ago7d  = new Date(now - 7  * 24 * 3600_000).toISOString();
  const todayStart = new Date(new Date().toDateString()).toISOString();

  const [
    eventsRes,
    workspaceRes,
    allWorkspacesRes,
    streamCountRes,
    pollCountRes,
    decisionsCountRes,
    firstHeartbeatTodayRes,
  ] = await Promise.allSettled([
    // Broad system_events query — last 30 days, all relevant sources + event types
    db.from('system_events')
      .select('source,event_type,created_at')
      .eq('workspace_id', ws)
      .gte('created_at', ago30d)
      .order('created_at', { ascending: false })
      .limit(2000),

    // This workspace's alpha_enabled flag
    db.from('workspaces')
      .select('id,alpha_enabled')
      .eq('id', ws)
      .maybeSingle(),

    // All active (alpha-enabled + onboarded) workspaces — service role can see all
    db.from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('alpha_enabled', true)
      .not('onboarding_completed_at', 'is', null),

    // stream_history rows in last 24h for this workspace
    db.from('stream_history')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .gte('started_at', ago24h),

    // poll_events in last 7 days for this workspace
    db.from('poll_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .gte('created_at', ago7d),

    // ai_agent_decisions created today for this workspace
    db.from('ai_agent_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .gte('created_at', todayStart),

    // First heartbeat today (for uptime calculation)
    db.from('system_events')
      .select('created_at')
      .eq('workspace_id', ws)
      .eq('event_type', 'HEARTBEAT')
      .gte('created_at', todayStart)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  // ── system_events result ────────────────────────────────────────────────────
  const events: Array<{ source: string; event_type: string; created_at: string }> =
    eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []) : [];

  // ── Bot heartbeat ───────────────────────────────────────────────────────────
  const BOT_HB_SOURCES = new Set(['twitch_bot', 'discord_bot', 'learning_aggregator', 'scheduler', 'content_factory', 'recovery_engine']);
  const botLastHeartbeat = findLast(events, e => e.event_type === 'HEARTBEAT' && BOT_HB_SOURCES.has(e.source));

  const firstHeartbeatToday: string | null =
    firstHeartbeatTodayRes.status === 'fulfilled'
      ? (firstHeartbeatTodayRes.value.data?.created_at ?? null)
      : null;

  const botUptimeMinutes: number | null = firstHeartbeatToday
    ? Math.round((Date.now() - new Date(firstHeartbeatToday).getTime()) / 60_000)
    : null;

  // ── Last runs — filter events by subsystem rules ────────────────────────────
  const lastRuns = {
    creatorBrain: findLast(events, e =>
      e.event_type === 'LEARNING_STARTED' || e.event_type === 'CREATOR_KNOWLEDGE_UPDATED',
    ),
    learningEngine: findLast(events, e => e.source === 'learning_engine'),
    pollManager: findLast(events, e =>
      e.event_type === 'POLL_CREATED' || e.event_type === 'POLL_ENDED',
    ),
    communityManager: findLast(events, e =>
      e.event_type === 'COMMUNITY_ACTIVITY_PROMPT_SENT' || e.event_type.startsWith('COMMUNITY_MOOD'),
    ),
    aiProducer: findLast(events, e => e.source === 'ai_producer'),
    streamCoach: findLast(events, e => e.event_type === 'STREAM_COACH_LEARNING_SAVED'),
    contentFactory: findLast(events, e => e.source === 'content_factory' && e.event_type !== 'HEARTBEAT'),
    partnerEngine: findLast(events, e =>
      e.event_type === 'PARTNER_PROMOTION_CONSIDERED' || e.event_type === 'PARTNER_PROPOSAL_CREATED',
    ),
    xpSystem: findLast(events, e =>
      e.event_type === 'XP_AWARDED' || e.source === 'xp_system',
    ),
  };

  // ── Workspace ───────────────────────────────────────────────────────────────
  const workspaceRow =
    workspaceRes.status === 'fulfilled' ? workspaceRes.value.data : null;

  const activeWorkspaceCount: number =
    allWorkspacesRes.status === 'fulfilled'
      ? ((allWorkspacesRes.value as any).count ?? 0)
      : 0;

  const streamCount24h: number =
    streamCountRes.status === 'fulfilled'
      ? ((streamCountRes.value as any).count ?? 0)
      : 0;

  const pollCount7d: number =
    pollCountRes.status === 'fulfilled'
      ? ((pollCountRes.value as any).count ?? 0)
      : 0;

  const decisionsToday: number =
    decisionsCountRes.status === 'fulfilled'
      ? ((decisionsCountRes.value as any).count ?? 0)
      : 0;

  return NextResponse.json({
    workspace: {
      id: ws,
      alpha_enabled: workspaceRow?.alpha_enabled ?? false,
      activeWorkspaces: activeWorkspaceCount,
    },
    uptime: {
      botLastHeartbeat,
      botUptimeMinutes,
    },
    lastRuns,
    activeWorkspaceCount,
    streamCount24h,
    pollCount7d,
    decisionsToday,
  });
}
