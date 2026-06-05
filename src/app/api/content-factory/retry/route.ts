import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId } = await req.json().catch(() => ({}));
  if (!vodId) return NextResponse.json({ error: 'vodId kreves' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const { data: vod } = await db.from('content_vods').select('*').eq('id', vodId).single();
  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  const twitchVodUrl = vod.vod_url ?? `https://www.twitch.tv/videos/${vod.twitch_vod_id ?? vod.stream_id}`;
  const botApiUrl = process.env.BOT_API_URL;

  if (!botApiUrl) {
    return NextResponse.json({ error: 'BOT_API_URL ikke satt' }, { status: 500 });
  }

  // Reset til ANALYZING umiddelbart
  await db.from('content_vods').update({
    status: 'ANALYZING',
    current_step: 'DOWNLOAD',
    progress_percent: 10,
    error_message: null,
    status_message: 'Retry startet – sender til Railway...',
  }).eq('id', vodId);

  // Fire-and-forget – ikke vent på Railway
  fetch(`${botApiUrl}/content-factory/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vodId, twitchVodUrl, userOauth: process.env.TWITCH_USER_OAUTH }),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
