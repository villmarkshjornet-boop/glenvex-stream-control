import { NextRequest, NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ||
    new URL(req.url).searchParams.get('secret');

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
        return NextResponse.json({
          status: 'already_notified',
          streamId: stream.id,
        });
      }

      if (settings.autoPostLive) {
        await postLiveEmbed(stream, settings);
        addLog('success', 'Discord live-varsel sendt til #live', 'OK');
      }

      if (stream.id) {
        saveSettings({ lastNotifiedStreamId: stream.id });
      }

      return NextResponse.json({ status: 'notified', stream });
    } else {
      if (settings.lastNotifiedStreamId) {
        saveSettings({ lastNotifiedStreamId: null });
        addLog('info', 'Stream er offline – varslings-ID nullstilt', 'OK');
      }
      return NextResponse.json({ status: 'offline', stream });
    }
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved cron-sjekk: ${msg}`, 'ERROR');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
