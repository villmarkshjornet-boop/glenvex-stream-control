import { NextRequest, NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

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

  // Heartbeat: cron kjørte (vises i System Coverage → Scheduler)
  await logEvent('scheduler', 'HEARTBEAT', 'Cron check-live kjørte', 'info', {
    trigger: 'vercel_cron',
    ts: new Date().toISOString(),
  });

  try {
    const settings = getSettings();
    const stream = await getStreamInfo(settings.twitchUsername);

    addLog(
      'info',
      `System sjekk fullført – ${stream.isLive ? 'LIVE' : 'Offline'}`,
      'OK'
    );

    if (stream.isLive) {
      if (stream.id && stream.id === settings.lastNotifiedStreamId) {
        await logEvent('scheduler', 'LIVE_ALREADY_NOTIFIED', `Stream allerede varslet: ${stream.id}`, 'info', {
          streamId: stream.id,
          game: stream.game,
          viewerCount: stream.viewerCount,
        });
        return NextResponse.json({
          status: 'already_notified',
          streamId: stream.id,
        });
      }

      await logEvent('scheduler', 'LIVE_DETECTED', `Stream er live: ${stream.title?.slice(0, 60) ?? 'Ingen tittel'}`, 'info', {
        streamId: stream.id,
        game: stream.game,
        viewerCount: stream.viewerCount,
        title: stream.title,
      });

      if (settings.autoPostLive) {
        await postLiveEmbed(stream, settings);
        addLog('success', 'Discord live-varsel sendt til #live', 'OK');
        await logEvent('scheduler', 'DISCORD_LIVE_ANNOUNCEMENT_SENT', `Discord varslet: ${stream.title?.slice(0, 60) ?? ''}`, 'info', {
          streamId: stream.id,
        });
      }

      if (stream.id) {
        saveSettings({ lastNotifiedStreamId: stream.id });
      }

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
