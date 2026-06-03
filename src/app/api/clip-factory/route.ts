import { NextResponse } from 'next/server';
import { getBroadcasterId, getTopClips } from '@/lib/twitch';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return NextResponse.json({ clips: [] });
    const clips = await getTopClips(broadcasterId, 20);
    return NextResponse.json({ clips });
  } catch {
    return NextResponse.json({ clips: [] });
  }
}
