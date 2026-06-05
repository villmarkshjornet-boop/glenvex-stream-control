import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/content-factory/retry – Reset VOD og prøv Railway på nytt
export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId } = await req.json().catch(() => ({}));
  if (!vodId) return NextResponse.json({ error: 'vodId kreves' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  // Hent eksisterende VOD
  const { data: vod } = await db.from('content_vods').select('*').eq('id', vodId).single();
  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  const twitchVodUrl = vod.vod_url ?? `https://www.twitch.tv/videos/${vod.twitch_vod_id ?? vod.stream_id}`;
  const botApiUrl = process.env.BOT_API_URL;

  if (!botApiUrl) {
    return NextResponse.json({ error: 'BOT_API_URL ikke satt' }, { status: 500 });
  }

  // Reset status
  await db.from('content_vods').update({
    status: 'PENDING',
    current_step: 'DOWNLOAD',
    progress_percent: 5,
    error_message: null,
    status_message: 'Retry startet...',
  }).eq('id', vodId);

  // Kall Railway
  try {
    const res = await fetch(`${botApiUrl}/content-factory/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId, twitchVodUrl, userOauth: process.env.TWITCH_USER_OAUTH }),
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok || res.status === 202) {
      await db.from('content_vods').update({
        status: 'ANALYZING',
        current_step: 'TRANSCRIBING',
        progress_percent: 10,
        status_message: 'Railway laster ned på nytt...',
      }).eq('id', vodId);
      return NextResponse.json({ ok: true });
    }

    const body = await res.text().catch(() => '');
    const feil = `Railway HTTP ${res.status}: ${body.slice(0, 200)}`;
    await db.from('content_vods').update({
      status: 'FAILED', error_message: feil, progress_percent: 0
    }).eq('id', vodId);
    return NextResponse.json({ error: feil }, { status: 500 });
  } catch (e: any) {
    const feil = `Kan ikke nå Railway: ${e.message}`;
    await db.from('content_vods').update({
      status: 'FAILED', error_message: feil, progress_percent: 0
    }).eq('id', vodId);
    return NextResponse.json({ error: feil }, { status: 500 });
  }
}
