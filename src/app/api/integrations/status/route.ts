import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { evaluateIntegrationStatus } from '@/lib/integrationStatus';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db unavailable' }, { status: 500 });

  const h           = headers();
  const workspaceId = h.get('x-workspace-id') ?? null;
  const userId      = h.get('x-user-id') ?? null;

  // ── Workspace-oppslag ─────────────────────────────────────────────────────
  let workspace: any = null;
  if (workspaceId) {
    const { data } = await db
      .from('workspaces')
      .select('id,twitch_login,twitch_connected_at,twitch_access_token,twitch_refresh_token,discord_guild_id,discord_guild_name,discord_connected_at,live_channel_id,settings_json,alpha_enabled,onboarding_completed_at')
      .eq('id', workspaceId)
      .single();
    workspace = data;
  } else if (userId) {
    const { data } = await db
      .from('workspaces')
      .select('id,twitch_login,twitch_connected_at,twitch_access_token,twitch_refresh_token,discord_guild_id,discord_guild_name,discord_connected_at,live_channel_id,settings_json,alpha_enabled,onboarding_completed_at')
      .eq('owner_user_id', userId)
      .limit(1)
      .single();
    workspace = data;
  }

  const wsId = workspace?.id ?? workspaceId ?? 'unknown';

  // ── Latest event per bot source (siste 24t gir nok kontekst) ─────────────
  const cutoff24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [twitchEvRes, discordEvRes] = await Promise.all([
    db.from('system_events')
      .select('created_at')
      .eq('workspace_id', wsId)
      .eq('source', 'twitch_bot')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(1),

    db.from('system_events')
      .select('created_at')
      .eq('workspace_id', wsId)
      .eq('source', 'discord_bot')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const twitchBotLastEventAt  = twitchEvRes.data?.[0]?.created_at  ?? null;
  const discordBotLastEventAt = discordEvRes.data?.[0]?.created_at ?? null;

  // ── Evaluer via shared function ───────────────────────────────────────────
  const status = evaluateIntegrationStatus({
    workspace: workspace ?? {
      twitch_connected_at: null, twitch_login: null,
      discord_connected_at: null, discord_guild_id: null, discord_guild_name: null,
    },
    twitchBotLastEventAt,
    discordBotLastEventAt,
  });

  // ── Rate-limited event-logging (maks 1 per time per type) ────────────────
  if (workspace) {
    const cutoff1h = new Date(Date.now() - 3_600_000).toISOString();
    const cutoff6h = new Date(Date.now() - 6 * 3_600_000).toISOString();

    const allGood = status.readyForRuntime;
    const eventTypes = [
      'INTEGRATION_STATUS_CHECKED',
      'TWITCH_CONNECTION_INVALID',
      'DISCORD_CONNECTION_INVALID',
      'BOT_RUNTIME_HEARTBEAT_MISSING',
      'INTEGRATION_STATUS_FIXED',
    ];

    const { data: recent } = await db
      .from('system_events')
      .select('event_type,created_at')
      .eq('workspace_id', wsId)
      .in('event_type', eventTypes)
      .gte('created_at', cutoff6h)
      .order('created_at', { ascending: false })
      .limit(30);

    const recentByType = new Map<string, string>();
    for (const r of recent ?? []) {
      if (!recentByType.has(r.event_type)) recentByType.set(r.event_type, r.created_at);
    }

    const toInsert: any[] = [];
    const meta = {
      twitchBotActive: status.twitch.botWatching,
      discordBotActive: status.discord.botInGuild,
      twitchOauthDone: status.twitch.oauthDone,
      discordOauthDone: status.discord.oauthDone,
    };

    if (!recentByType.has('INTEGRATION_STATUS_CHECKED') || recentByType.get('INTEGRATION_STATUS_CHECKED')! < cutoff1h) {
      toInsert.push({
        workspace_id: wsId, source: 'integration_status',
        event_type: 'INTEGRATION_STATUS_CHECKED',
        title: allGood ? 'Integrasjonsstatus: OK' : 'Integrasjonsstatus: Problem detektert',
        description: `Twitch: ${status.twitch.reason} | Discord: ${status.discord.reason}`,
        severity: allGood ? 'info' : 'warning', metadata: meta,
      });
    }

    const problems: Array<{ event_type: string; title: string; reason: string }> = [];
    if (!status.twitch.connected)   problems.push({ event_type: 'TWITCH_CONNECTION_INVALID', title: 'Twitch ikke koblet til', reason: status.twitch.reason });
    if (!status.discord.connected)  problems.push({ event_type: 'DISCORD_CONNECTION_INVALID', title: 'Discord ikke koblet til', reason: status.discord.reason });
    if (status.twitch.connected  && !status.twitch.botWatching)  problems.push({ event_type: 'BOT_RUNTIME_HEARTBEAT_MISSING', title: 'Twitch bot heartbeat mangler', reason: status.twitch.reason });
    if (status.discord.connected && !status.discord.botInGuild)  problems.push({ event_type: 'BOT_RUNTIME_HEARTBEAT_MISSING', title: 'Discord bot heartbeat mangler', reason: status.discord.reason });

    for (const p of problems) {
      const lastSeen = recentByType.get(p.event_type);
      if (!lastSeen || lastSeen < cutoff1h) {
        toInsert.push({ workspace_id: wsId, source: 'integration_status', event_type: p.event_type, title: p.title, description: p.reason, severity: 'warning', metadata: meta });
      }
    }

    if (allGood) {
      const hadPriorError = ['TWITCH_CONNECTION_INVALID', 'DISCORD_CONNECTION_INVALID', 'BOT_RUNTIME_HEARTBEAT_MISSING'].some(t => recentByType.has(t));
      if (hadPriorError && !recentByType.has('INTEGRATION_STATUS_FIXED')) {
        toInsert.push({ workspace_id: wsId, source: 'integration_status', event_type: 'INTEGRATION_STATUS_FIXED', title: 'Integrasjonsfeil løst', description: 'Twitch og Discord er nå koblet til og bot er aktiv', severity: 'info', metadata: meta });
      }
    }

    if (toInsert.length > 0) await db.from('system_events').insert(toInsert);
  }

  return NextResponse.json({
    twitch: {
      connected:   status.twitch.connected,
      oauthValid:  status.twitch.oauthValid,
      botWatching: status.twitch.botWatching,
      login:       status.twitch.login,
      lastEventAt: twitchBotLastEventAt,
      reason:      status.twitch.reason,
    },
    discord: {
      connected:          status.discord.connected,
      botInGuild:         status.discord.botInGuild,
      channelsConfigured: status.discord.channelsConfigured,
      canPost:            status.discord.canPost,
      guildName:          status.discord.guildName,
      lastEventAt:        discordBotLastEventAt,
      reason:             status.discord.reason,
    },
    workspace: {
      id:                 wsId,
      alphaEnabled:       !!workspace?.alpha_enabled,
      onboardingComplete: !!workspace?.onboarding_completed_at,
    },
  });
}
