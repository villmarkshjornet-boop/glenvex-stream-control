/**
 * /api/live/force-notify POST – tving Discord live-varsel uten å sjekke autoPostLive
 * eller lastNotifiedStreamId. Brukes ved nødstilfeller og manuelle triggers.
 */
import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { postLiveEmbed } from '@/lib/discord';
import { getLiveKanalId } from '@/lib/discordChannel';
import type { StreamInfo } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function POST() {
  const settings = getSettings();

  // Source of truth: Supabase kanalPreferanser, ikke lokal fil/env
  const liveKanalId = await getLiveKanalId().catch(() => null) || settings.discordLiveChannelId;

  if (!liveKanalId) {
    return NextResponse.json({
      ok: false,
      feil: 'Live-kanal ikke konfigurert. Gå til Dashboard → Settings → Discord → Velg live-kanal.',
      konfig: false,
    }, { status: 400 });
  }

  // Hent ekte stream-data om mulig, bruk fallback hvis Twitch API feiler
  let stream: StreamInfo;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const twitchUsername = process.env.TWITCH_USERNAME || 'glenvex';

  if (clientId && clientSecret) {
    try {
      const tokenRes = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
        { method: 'POST', signal: AbortSignal.timeout(8000) }
      );
      const { access_token } = await tokenRes.json() as { access_token: string };
      const streamRes = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchUsername)}`,
        { headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) }
      );
      const data = await streamRes.json() as { data: any[] };
      const s = data.data?.[0];
      if (s) {
        stream = {
          isLive: true,
          id: s.id,
          title: s.title,
          game: s.game_name,
          viewerCount: s.viewer_count,
          startedAt: s.started_at,
          thumbnailUrl: s.thumbnail_url,
          streamUrl: `https://twitch.tv/${twitchUsername}`,
          userName: twitchUsername,
        };
      } else {
        // Ikke live akkurat nå, men brukeren sier de er live – lag fallback
        stream = {
          isLive: true,
          id: `force-${Date.now()}`,
          title: `GLENVEX er LIVE`,
          game: 'Twitch',
          viewerCount: 0,
          startedAt: new Date().toISOString(),
          streamUrl: `https://twitch.tv/${twitchUsername}`,
          userName: twitchUsername,
        };
      }
    } catch {
      stream = {
        isLive: true,
        id: `force-${Date.now()}`,
        title: `GLENVEX er LIVE`,
        game: 'Twitch',
        viewerCount: 0,
        startedAt: new Date().toISOString(),
        streamUrl: `https://twitch.tv/${twitchUsername}`,
        userName: twitchUsername,
      };
    }
  } else {
    stream = {
      isLive: true,
      id: `force-${Date.now()}`,
      title: `GLENVEX er LIVE`,
      game: 'Twitch',
      viewerCount: 0,
      startedAt: new Date().toISOString(),
      streamUrl: `https://twitch.tv/${twitchUsername}`,
      userName: twitchUsername,
    };
  }

  try {
    await postLiveEmbed(stream, { ...settings, discordLiveChannelId: liveKanalId });
    // Oppdater lastNotifiedStreamId så vi ikke sender dobbelt
    if (stream.id) saveSettings({ lastNotifiedStreamId: stream.id });

    return NextResponse.json({
      ok: true,
      melding: 'Live-varsel sendt til Discord!',
      stream: { title: stream.title, game: stream.game, viewers: stream.viewerCount },
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      feil: e.message,
      konfig: true,
    }, { status: 500 });
  }
}
