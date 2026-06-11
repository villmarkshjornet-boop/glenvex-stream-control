import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { postLiveEmbed } from '@/lib/discord';
import { getLiveKanalId } from '@/lib/discordChannel';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import type { StreamInfo } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function POST() {
  const wsId = getWorkspaceId();
  const db   = getDb();

  // Load workspace Twitch identity from DB — never use env/hardcode fallback
  let twitchLogin: string | null = null;
  let brandName:   string        = 'Stream';

  if (db) {
    const { data: ws } = await db
      .from('workspaces')
      .select('twitch_login,brand_name')
      .eq('id', wsId)
      .single();
    twitchLogin = ws?.twitch_login ?? null;
    brandName   = ws?.brand_name   ?? 'Stream';

    if (!twitchLogin) {
      void db.from('system_events').insert({
        workspace_id: wsId,
        source:       'force_notify',
        event_type:   'WORKSPACE_MISSING_TWITCH',
        title:        'Force-notify: workspace mangler twitch_login',
        severity:     'warning',
        metadata:     { wsId, field: 'twitch_login' },
      });
    }
  }

  if (!twitchLogin) {
    return NextResponse.json({
      ok: false,
      feil: 'Twitch ikke koblet for dette workspace. Fullfør onboarding → Koble Twitch.',
      konfig: false,
    }, { status: 400 });
  }

  const settings   = getSettings();
  const liveKanalId = await getLiveKanalId().catch(() => null) || settings.discordLiveChannelId;

  if (!liveKanalId) {
    return NextResponse.json({
      ok: false,
      feil: 'Live-kanal ikke konfigurert. Gå til Dashboard → Settings → Discord → Velg live-kanal.',
      konfig: false,
    }, { status: 400 });
  }

  const clientId     = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  let stream: StreamInfo;

  if (clientId && clientSecret) {
    try {
      const tokenRes = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
        { method: 'POST', signal: AbortSignal.timeout(8000) }
      );
      const { access_token } = await tokenRes.json() as { access_token: string };
      const streamRes = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchLogin)}`,
        { headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) }
      );
      const data = await streamRes.json() as { data: any[] };
      const s = data.data?.[0];
      stream = s ? {
        isLive:       true,
        id:           s.id,
        title:        s.title,
        game:         s.game_name,
        viewerCount:  s.viewer_count,
        startedAt:    s.started_at,
        thumbnailUrl: s.thumbnail_url,
        streamUrl:    `https://twitch.tv/${twitchLogin}`,
        userName:     twitchLogin,
      } : {
        isLive:       true,
        id:           `force-${Date.now()}`,
        title:        `${brandName} er LIVE`,
        game:         'Twitch',
        viewerCount:  0,
        startedAt:    new Date().toISOString(),
        streamUrl:    `https://twitch.tv/${twitchLogin}`,
        userName:     twitchLogin,
      };
    } catch {
      stream = {
        isLive:      true,
        id:          `force-${Date.now()}`,
        title:       `${brandName} er LIVE`,
        game:        'Twitch',
        viewerCount: 0,
        startedAt:   new Date().toISOString(),
        streamUrl:   `https://twitch.tv/${twitchLogin}`,
        userName:    twitchLogin,
      };
    }
  } else {
    stream = {
      isLive:      true,
      id:          `force-${Date.now()}`,
      title:       `${brandName} er LIVE`,
      game:        'Twitch',
      viewerCount: 0,
      startedAt:   new Date().toISOString(),
      streamUrl:   `https://twitch.tv/${twitchLogin}`,
      userName:    twitchLogin,
    };
  }

  try {
    await postLiveEmbed(stream, { ...settings, discordLiveChannelId: liveKanalId }, { brandName, twitchLogin });
    if (stream.id) saveSettings({ lastNotifiedStreamId: stream.id });

    return NextResponse.json({
      ok:     true,
      melding: 'Live-varsel sendt til Discord!',
      stream: { title: stream.title, game: stream.game, viewers: stream.viewerCount },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, feil: e.message, konfig: true }, { status: 500 });
  }
}
