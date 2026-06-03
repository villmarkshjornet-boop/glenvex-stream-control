import { NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import type { StreamInfo } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    let stream: StreamInfo;

    try {
      const live = await getStreamInfo();
      stream = live.isLive
        ? live
        : {
            isLive: true,
            id: 'test-' + Date.now(),
            title: '⚠️ TEST: Kaoset starter nå',
            game: 'Just Chatting',
            viewerCount: 0,
            startedAt: new Date().toISOString(),
            streamUrl: process.env.TWITCH_URL || 'https://twitch.tv/glenvex',
            userName: process.env.TWITCH_USERNAME || 'glenvex',
          };
    } catch {
      stream = {
        isLive: true,
        id: 'test-' + Date.now(),
        title: '⚠️ TEST: Kaoset starter nå',
        game: 'Just Chatting',
        viewerCount: 0,
        startedAt: new Date().toISOString(),
        streamUrl: process.env.TWITCH_URL || 'https://twitch.tv/glenvex',
        userName: process.env.TWITCH_USERNAME || 'glenvex',
      };
    }

    const settings = getSettings();
    await postLiveEmbed(stream, settings);

    addLog('success', 'Test live-varsel sendt til Discord', 'OK');
    return NextResponse.json({ success: true, message: 'Test varsel sendt til Discord!' });
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved test live-varsel: ${msg}`, 'ERROR');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
