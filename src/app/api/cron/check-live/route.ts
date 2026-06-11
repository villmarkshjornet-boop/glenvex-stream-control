import { NextRequest, NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getLiveKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

async function logEvent(source: string, event_type: string, title: string, severity = 'info', metadata?: Record<string, any>) {
  try {
    const db = getDb();
    if (!db) return;
    await db.from('system_events').insert({
      workspace_id: getWorkspaceId(),
      source,
      event_type,
      title,
      severity,
      metadata: metadata ?? null,
    });
  } catch {}
}

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ||
    new URL(req.url).searchParams.get('secret');

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await logEvent('scheduler', 'HEARTBEAT', 'Cron check-live kjørte', 'info', {
    trigger: 'vercel_cron',
    ts: new Date().toISOString(),
  });

  try {
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
    }

    if (!twitchLogin) {
      await logEvent('scheduler', 'WORKSPACE_MISSING_TWITCH', 'Cron check-live: workspace mangler twitch_login', 'warning', {
        wsId, field: 'twitch_login',
      });
      return NextResponse.json({ status: 'skipped', reason: 'twitch_not_connected' });
    }

    const settings = getSettings();
    const stream   = await getStreamInfo(twitchLogin);

    addLog('info', `System sjekk fullført – ${stream.isLive ? 'LIVE' : 'Offline'}`, 'OK');

    if (stream.isLive) {
      if (stream.id && stream.id === settings.lastNotifiedStreamId) {
        await logEvent('scheduler', 'LIVE_ALREADY_NOTIFIED', `Stream allerede varslet: ${stream.id}`, 'info', {
          streamId: stream.id,
          game: stream.game,
          viewerCount: stream.viewerCount,
        });
        return NextResponse.json({ status: 'already_notified', streamId: stream.id });
      }

      await logEvent('scheduler', 'LIVE_DETECTED', `Stream er live: ${stream.title?.slice(0, 60) ?? 'Ingen tittel'}`, 'info', {
        streamId: stream.id,
        game: stream.game,
        viewerCount: stream.viewerCount,
        title: stream.title,
      });

      if (settings.autoPostLive) {
        const liveKanalId = await getLiveKanalId();
        if (!liveKanalId) {
          await logEvent('scheduler', 'DISCORD_LIVE_ANNOUNCEMENT_SKIPPED', 'Live-varsel hoppet over — ingen kanal konfigurert', 'warning', {
            reason: 'missing_channel_preference',
            streamId: stream.id,
            workspaceId: wsId,
          });
        } else {
          const liveSettings = { ...settings, discordLiveChannelId: liveKanalId };
          await postLiveEmbed(stream, liveSettings, { brandName, twitchLogin });
          addLog('success', 'Discord live-varsel sendt', 'OK');
          await logEvent('scheduler', 'DISCORD_LIVE_ANNOUNCEMENT_SENT', `Discord varslet: ${stream.title?.slice(0, 60) ?? ''}`, 'info', {
            workspaceId: wsId,
            channelId: liveKanalId,
            streamId: stream.id,
          });
        }
      }

      if (stream.id) saveSettings({ lastNotifiedStreamId: stream.id });
      return NextResponse.json({ status: 'notified', stream });
    } else {
      if (settings.lastNotifiedStreamId) {
        saveSettings({ lastNotifiedStreamId: null });
        addLog('info', 'Stream er offline – varslings-ID nullstilt', 'OK');
        await logEvent('scheduler', 'STREAM_OFFLINE_DETECTED', 'Stream er offline', 'info');
      }
      return NextResponse.json({ status: 'offline', stream });
    }
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved cron-sjekk: ${msg}`, 'ERROR');
    await logEvent('scheduler', 'CRON_FAILED', `check-live feilet: ${msg.slice(0, 120)}`, 'error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
