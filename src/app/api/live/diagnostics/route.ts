/**
 * /api/live/diagnostics – vis nøyaktig hvorfor live-deteksjon feiler.
 * Returnerer full status for alle komponenter i live-stacken.
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const twitchUsername = process.env.TWITCH_USERNAME || 'glenvex';
  const discordToken = process.env.DISCORD_BOT_TOKEN;

  const settings = getSettings();

  const diag: Record<string, { ok: boolean; melding: string; verdi?: string }> = {
    twitch_client_id:     { ok: !!clientId,      melding: clientId     ? 'Satt' : 'MANGLER – live-deteksjon umulig uten dette', verdi: clientId ? `${clientId.slice(0,6)}…` : undefined },
    twitch_client_secret: { ok: !!clientSecret,   melding: clientSecret ? 'Satt' : 'MANGLER', verdi: clientSecret ? '***' : undefined },
    twitch_username:      { ok: !!twitchUsername,  melding: `Bruker: ${twitchUsername}` },
    discord_bot_token:    { ok: !!discordToken,    melding: discordToken ? 'Satt' : 'MANGLER – Discord-varsel umulig uten dette' },
    discord_live_channel: { ok: !!settings.discordLiveChannelId, melding: settings.discordLiveChannelId ? `Kanal: ${settings.discordLiveChannelId}` : 'MANGLER – sett discordLiveChannelId i Innstillinger' },
    auto_post_live:       { ok: !!settings.autoPostLive, melding: settings.autoPostLive ? 'Aktivert' : 'DEAKTIVERT – skru på i Innstillinger' },
    last_notified_id:     { ok: true, melding: settings.lastNotifiedStreamId ? `Blokkert av: ${settings.lastNotifiedStreamId}` : 'Ikke satt – vil varsle neste live', verdi: settings.lastNotifiedStreamId ?? undefined },
  };

  // Test Twitch API live
  let streamInfo: any = null;
  let twitchApiFeil: string | null = null;
  if (clientId && clientSecret) {
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
          `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchUsername)}`,
          { headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) }
        );
        if (!streamRes.ok) {
          twitchApiFeil = `Stream API HTTP ${streamRes.status}`;
          diag.twitch_api = { ok: false, melding: twitchApiFeil };
        } else {
          const data = await streamRes.json() as { data: any[] };
          streamInfo = data.data?.[0] ?? null;
          diag.twitch_api = {
            ok: true,
            melding: streamInfo ? `LIVE: "${streamInfo.title}" (${streamInfo.viewer_count} seere)` : `Ikke live akkurat nå – kanal: ${twitchUsername}`,
            verdi: streamInfo ? 'LIVE' : 'OFFLINE',
          };
        }
      }
    } catch (e: any) {
      twitchApiFeil = e.message;
      diag.twitch_api = { ok: false, melding: `Nettverksfeil: ${e.message}` };
    }
  } else {
    diag.twitch_api = { ok: false, melding: 'Kan ikke teste – credentials mangler' };
  }

  const altOk = Object.values(diag).every(d => d.ok);
  const kritiskeFeil = Object.entries(diag).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.melding}`);

  return NextResponse.json({
    altOk,
    streamInfo,
    erLive: !!streamInfo,
    kritiskeFeil,
    detaljer: diag,
    settings: {
      autoPostLive: settings.autoPostLive,
      discordLiveChannelId: settings.discordLiveChannelId,
      lastNotifiedStreamId: settings.lastNotifiedStreamId,
      twitchUsername: settings.twitchUsername,
    },
  });
}
