import { NextResponse } from 'next/server';
import { generatePromo } from '@/lib/openai';
import { getStreamInfo } from '@/lib/twitch';
import { addLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    let stream;
    try {
      stream = await getStreamInfo();
    } catch {
      stream = {
        isLive: false,
        game: 'Gaming',
        title: 'Live stream',
        streamUrl: process.env.TWITCH_URL || 'https://twitch.tv/glenvex',
        userName: process.env.TWITCH_USERNAME || 'glenvex',
      };
    }

    const promo = await generatePromo(stream);
    addLog('success', 'AI promo generert', 'OK');
    return NextResponse.json(promo);
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved AI promo-generering: ${msg}`, 'ERROR');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
