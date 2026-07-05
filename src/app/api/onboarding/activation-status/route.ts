import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  // Load workspace row
  const { data: ws, error: wsError } = await db
    .from('workspaces')
    .select('id,alpha_enabled,onboarding_completed_at,twitch_login,twitch_connected_at,discord_guild_id,discord_connected_at')
    .eq('id', workspaceId)
    .single();

  if (wsError || !ws) {
    return NextResponse.json({ error: 'Workspace ikke funnet' }, { status: 404 });
  }

  // All system_events checks use a 15-minute window
  const cutoff15m = new Date(Date.now() - 15 * 60_000).toISOString();

  // Run all system_events checks in parallel
  const [
    botHeartbeatRes,
    botFoundWorkspaceRes,
    discordBotActiveRes,
    twitchBotActiveRes,
  ] = await Promise.all([
    // Any HEARTBEAT in last 15 min (global bot health)
    db.from('system_events')
      .select('id')
      .eq('event_type', 'HEARTBEAT')
      .gte('created_at', cutoff15m)
      .limit(1),

    // Bot found/registered this specific workspace in last 15 min
    db.from('system_events')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['WORKSPACE_STARTED', 'TWITCH_CHAT_CHANNEL_REGISTERED'])
      .gte('created_at', cutoff15m)
      .limit(1),

    // Discord bot active: source=discord_bot + HEARTBEAT in last 15 min
    db.from('system_events')
      .select('id')
      .eq('source', 'discord_bot')
      .eq('event_type', 'HEARTBEAT')
      .gte('created_at', cutoff15m)
      .limit(1),

    // Twitch bot active: source=twitch_bot + HEARTBEAT or TWITCH_CHAT_JOIN_SUCCESS in last 15 min
    db.from('system_events')
      .select('id')
      .eq('source', 'twitch_bot')
      .in('event_type', ['HEARTBEAT', 'TWITCH_CHAT_JOIN_SUCCESS'])
      .gte('created_at', cutoff15m)
      .limit(1),
  ]);

  const checks = {
    workspaceActivated:  !!(ws.onboarding_completed_at && ws.alpha_enabled),
    twitchConnected:     !!ws.twitch_connected_at,
    discordConnected:    !!ws.discord_connected_at,
    botHeartbeat:        (botHeartbeatRes.data?.length ?? 0) > 0,
    botFoundWorkspace:   (botFoundWorkspaceRes.data?.length ?? 0) > 0,
    discordBotActive:    (discordBotActiveRes.data?.length ?? 0) > 0,
    twitchBotActive:     (twitchBotActiveRes.data?.length ?? 0) > 0,
  };

  const checkValues  = Object.values(checks);
  const readyCount   = checkValues.filter(Boolean).length;
  const totalChecks  = checkValues.length;
  const allReady     = readyCount === totalChecks;

  return NextResponse.json({
    workspace: {
      id:                       ws.id,
      alpha_enabled:            !!ws.alpha_enabled,
      onboarding_completed_at:  ws.onboarding_completed_at ?? null,
      twitch_login:             ws.twitch_login ?? null,
      discord_guild_id:         ws.discord_guild_id ?? null,
    },
    checks,
    allReady,
    readyCount,
    totalChecks,
  });
}
