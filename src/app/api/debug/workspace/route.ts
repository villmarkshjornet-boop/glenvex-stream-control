/**
 * Diagnostic endpoint — viser workspace_id-mismatchen mellom Railway-boten og dashboardet.
 * Åpen (ingen auth) slik at den kan nås selv uten gyldig sesjon for debugging.
 * GET /api/debug/workspace
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

function countByField(rows: any[] | null, field = 'workspace_id'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    const id = (row[field] as string) ?? '(null)';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a)
  );
}

export async function GET() {
  const db = getDb();
  const vercelWsId = getWorkspaceId();
  const vercelEnvId = process.env.WORKSPACE_ID ?? '(not set)';

  if (!db) {
    return NextResponse.json({
      ok: false,
      error: 'Supabase ikke tilkoblet — sjekk SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY på Vercel',
      vercelWorkspaceId: vercelWsId,
      vercelEnvWorkspaceId: vercelEnvId,
    });
  }

  // Hent siste 500 rader fra hver relevant tabell for å kartlegge workspace_ids
  const [sysRes, agentEvtRes, memRes, histRes, insRes, wsRes] = await Promise.all([
    db.from('system_events')
      .select('workspace_id,source,created_at')
      .order('created_at', { ascending: false })
      .limit(500),

    db.from('ai_agent_events')
      .select('workspace_id,source,created_at')
      .order('created_at', { ascending: false })
      .limit(500),

    db.from('ai_agent_memory')
      .select('workspace_id,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200),

    db.from('stream_history')
      .select('workspace_id,started_at')
      .order('started_at', { ascending: false })
      .limit(100),

    db.from('ai_agent_insights')
      .select('workspace_id,created_at')
      .order('created_at', { ascending: false })
      .limit(100),

    db.from('workspaces')
      .select('id,twitch_channel_name,brand_name,created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const systemEventsByWs   = countByField(sysRes.data);
  const agentEventsByWs    = countByField(agentEvtRes.data);
  const memoryByWs         = countByField(memRes.data);
  const streamHistoryByWs  = countByField(histRes.data);
  const insightsByWs       = countByField(insRes.data);

  const allDataWs = new Set([
    ...Object.keys(systemEventsByWs),
    ...Object.keys(agentEventsByWs),
    ...Object.keys(memoryByWs),
    ...Object.keys(streamHistoryByWs),
    ...Object.keys(insightsByWs),
  ]);

  // Sjekk om dashboardet ser noe
  const dashboardSeesSystemEvents = !!systemEventsByWs[vercelWsId];
  const dashboardSeesAgentEvents  = !!agentEventsByWs[vercelWsId];
  const dashboardSeesStreamHistory = !!streamHistoryByWs[vercelWsId];
  const dashboardSeesAnyData = dashboardSeesSystemEvents || dashboardSeesAgentEvents || dashboardSeesStreamHistory;

  // Finn hvilket workspace_id boten bruker (flest events)
  const botLikelyWsId = Object.entries(systemEventsByWs)
    .filter(([id]) => id !== vercelWsId)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  const mismatch = !dashboardSeesAnyData && Object.keys(systemEventsByWs).length > 0;

  // Siste events per kilde for vercel workspace (om noen)
  const siste24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const sisteEventPerKilde: Record<string, string | null> = {};
  for (const row of sysRes.data ?? []) {
    if (row.workspace_id === vercelWsId && row.created_at > siste24h) {
      if (!sisteEventPerKilde[row.source]) sisteEventPerKilde[row.source] = row.created_at as string;
    }
  }

  const instructions = mismatch
    ? `⚠️ MISMATCH DETEKTERT:\nDashboard leser fra workspace: "${vercelWsId}"\nBot skriver til workspace:    "${botLikelyWsId ?? 'ukjent'}"\n\nFIX: Sett WORKSPACE_ID="${vercelWsId}" i Railway environment variables.`
    : dashboardSeesAnyData
      ? `✅ workspace_id er konsistent: "${vercelWsId}"`
      : `ℹ️ Ingen data funnet for "${vercelWsId}" og ingen andre workspaces med data heller. Kanskje boten aldri har kjørt?`;

  return NextResponse.json({
    ok: true,
    instructions,
    mismatch,
    vercelWorkspaceId: vercelWsId,
    vercelEnvWorkspaceId: vercelEnvId,
    dashboardSeesData: {
      systemEvents: dashboardSeesSystemEvents,
      agentEvents: dashboardSeesAgentEvents,
      streamHistory: dashboardSeesStreamHistory,
    },
    botLikelyWorkspaceId: botLikelyWsId,
    allWorkspaceIdsInDb: Array.from(allDataWs),
    workspaces: (wsRes.data ?? []).map((w: any) => ({
      id: w.id,
      twitchChannel: w.twitch_channel_name,
      brandName: w.brand_name,
      createdAt: w.created_at,
    })),
    rowCounts: {
      system_events:   systemEventsByWs,
      ai_agent_events: agentEventsByWs,
      ai_agent_memory: memoryByWs,
      stream_history:  streamHistoryByWs,
      ai_agent_insights: insightsByWs,
    },
    sisteEventPerKilde,
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Workspace-Vercel': vercelWsId,
    },
  });
}
