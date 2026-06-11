import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  const clientId     = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const discordToken = process.env.DISCORD_BOT_TOKEN;

  const wsId = getWorkspaceId();
  const db   = getDb();

  // Load Twitch identity from workspace — never fall back to env/hardcode
  let twitchLogin:  string | null = null;
  let liveChannel:  string | null = null;
  let liveRoleId:   string | null = null;
  let discordGuild: string | null = null;

  if (db) {
    const { data: ws } = await db
      .from('workspaces')
      .select('twitch_login,twitch_user_id,discord_guild_id,live_channel_id,settings_json')
      .eq('id', wsId)
      .single();

    twitchLogin  = ws?.twitch_login    ?? null;
    discordGuild = ws?.discord_guild_id ?? null;
    liveChannel  = ws?.settings_json?.kanalPreferanser?.live ?? ws?.live_channel_id ?? null;
    liveRoleId   = ws?.settings_json?.liveRoleId ?? null;
  }

  const settings = getSettings();

  const diag: Record<string, { ok: boolean; melding: string; verdi?: string }> = {
    twitch_client_id:     { ok: !!clientId,      melding: clientId     ? 'Satt' : 'MANGLER – live-deteksjon umulig', verdi: clientId ? `${clientId.slice(0,6)}…` : undefined },
    twitch_client_secret: { ok: !!clientSecret,   melding: clientSecret ? 'Satt' : 'MANGLER',                        verdi: clientSecret ? '***' : undefined },
    twitch_login:         { ok: !!twitchLogin,    melding: twitchLogin  ? `Kanal: ${twitchLogin}` : 'MANGLER – koble Twitch under onboarding' },
    discord_bot_token:    { ok: !!discordToken,   melding: discordToken ? 'Satt' : 'MANGLER – Discord-varsel umulig' },
    discord_guild:        { ok: !!discordGuild,   melding: discordGuild ? `Guild: ${discordGuild}` : 'MANGLER – koble Discord under onboarding' },
    discord_live_channel: { ok: !!liveChannel,    melding: liveChannel  ? `Kanal: ${liveChannel}` : 'MANGLER – sett live-kanal i Innstillinger' },
    discord_live_role:    { ok: !!liveRoleId,     melding: liveRoleId   ? `Role: ${liveRoleId}`   : 'Ikke satt (valgfritt)' },
    auto_post_live:       { ok: !!settings.autoPostLive, melding: settings.autoPostLive ? 'Aktivert' : 'DEAKTIVERT' },
    last_notified_id:     { ok: true, melding: settings.lastNotifiedStreamId ? `Blokkert av: ${settings.lastNotifiedStreamId}` : 'Ikke satt – vil varsle neste live', verdi: settings.lastNotifiedStreamId ?? undefined },
  };

  // Test Twitch API live (only if workspace has a login)
  let streamInfo: any = null;
  let twitchApiFeil: string | null = null;

  if (clientId && clientSecret && twitchLogin) {
    try {
      const tokenRes = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
        { method: 'POST', signal: AbortSignal.timeout(8000) }
      );
      if (!tokenRes.ok) {
        twitchApiFeil = `Token-feil: HTTP ${tokenRes.status}`;
        diag.twitch_api = { ok: false, melding: twitchApiFeil };
      } else {
        const { access_token } = await tokenRes.json() as { access_token: string };
        const streamRes = await fetch(
          `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchLogin)}`,
          { headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) }
        );
        if (!streamRes.ok) {
          twitchApiFeil = `Stream API HTTP ${streamRes.status}`;
          diag.twitch_api = { ok: false, melding: twitchApiFeil };
        } else {
          const data = await streamRes.json() as { data: any[] };
          streamInfo = data.data?.[0] ?? null;
          diag.twitch_api = {
            ok:    true,
            melding: streamInfo ? `LIVE: "${streamInfo.title}" (${streamInfo.viewer_count} seere)` : `Ikke live – kanal: ${twitchLogin}`,
            verdi: streamInfo ? 'LIVE' : 'OFFLINE',
          };
        }
      }
    } catch (e: any) {
      twitchApiFeil = e.message;
      diag.twitch_api = { ok: false, melding: `Nettverksfeil: ${e.message}` };
    }
  } else if (!twitchLogin) {
    diag.twitch_api = { ok: false, melding: 'Kan ikke teste – Twitch ikke koblet for dette workspace' };
  } else {
    diag.twitch_api = { ok: false, melding: 'Kan ikke teste – credentials mangler' };
  }

  const altOk       = Object.values(diag).every(d => d.ok);
  const kritiskeFeil = Object.entries(diag).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.melding}`);

  return NextResponse.json({
    altOk,
    wsId,
    streamInfo,
    erLive: !!streamInfo,
    kritiskeFeil,
    detaljer: diag,
    workspace: {
      twitchLogin,
      discordGuild,
      liveChannel,
      liveRoleId,
    },
  });
}
