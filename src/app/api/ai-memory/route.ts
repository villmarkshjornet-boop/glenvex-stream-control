import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const workspaceId = getWorkspaceId();

  const [memoryRes, insightsRes, decisionsRes, eventsCountRes] = await Promise.all([
    db.from('ai_agent_memory')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('occurrence_count', { ascending: false })
      .limit(500),

    db.from('ai_agent_insights')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50),

    db.from('ai_agent_decisions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(30),

    db.from('ai_agent_events')
      .select('source,event_type,created_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .limit(1000),
  ]);

  const memory: any[] = memoryRes.data ?? [];
  const insights: any[] = insightsRes.data ?? [];
  const decisions: any[] = decisionsRes.data ?? [];
  const recentEvents: any[] = eventsCountRes.data ?? [];

  // Grupper memory etter type
  const byType = (type: string) => memory.filter(m => m.memory_type === type);
  const byAgent = (agent: string) => memory.filter(m => m.agent_type === agent);

  // Event-statistikk siste 7 dager
  const eventStats: Record<string, number> = {};
  for (const e of recentEvents) {
    const k = `${e.source}/${e.event_type}`;
    eventStats[k] = (eventStats[k] ?? 0) + 1;
  }

  return NextResponse.json({
    summary: {
      totalMemories: memory.length,
      totalInsights: insights.length,
      totalDecisions: decisions.length,
      recentEvents7d: recentEvents.length,
      streamCount: byType('stream_pattern').filter(m => m.key !== 'channel_profile').length,
    },
    // Kategorisert minne
    viewers: byType('viewer').slice(0, 30),
    members: byType('member').slice(0, 30),
    jokes: byType('joke').slice(0, 20),
    topics: byType('topic').slice(0, 20),
    contentPatterns: byType('content_pattern').slice(0, 20),
    gamePatterns: byType('game_pattern').slice(0, 20),
    streamPatterns: byType('stream_pattern').slice(0, 20),
    communityPatterns: byType('community_pattern').slice(0, 10),
    // Agent-fordelt minne
    twitchMemory: byAgent('twitch').slice(0, 50),
    discordMemory: byAgent('discord').slice(0, 50),
    contentMemory: byAgent('content').slice(0, 50),
    globalMemory: byAgent('global').slice(0, 20),
    // Innsikter og beslutninger
    insights: insights.slice(0, 20),
    decisions: decisions.slice(0, 15),
    // Event-statistikk
    eventStats,
    ts: new Date().toISOString(),
  });
}
