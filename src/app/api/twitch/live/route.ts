import { NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { addLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stream = await getStreamInfo();
    addLog(
      'info',
      `Twitch status: ${stream.isLive ? 'LIVE' : 'Offline'}`,
      stream.isLive ? 'LIVE' : 'OK'
    );
    return NextResponse.json(stream);
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved Twitch API: ${msg}`, 'ERROR');
    return NextResponse.json({ error: 'Twitch API feil', detail: msg }, { status: 500 });
  }
}
