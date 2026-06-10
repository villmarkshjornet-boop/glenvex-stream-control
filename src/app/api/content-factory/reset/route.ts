import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { logSystemEvent } from '@/lib/systemEvents';

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

  await db.from('content_vods').update({
    status: 'PENDING',
    current_step: null,
    progress_percent: 0,
    error_message: null,
    status_message: 'Tilstand nullstilt — klar for ny prosessering',
    updated_at: new Date().toISOString(),
  }).eq('id', vodId);

  await logSystemEvent({
    source: 'content_factory',
    event_type: 'CONTENT_FACTORY_JOB_RESET',
    title: `Jobb nullstilt: ${vod.title?.slice(0, 60) ?? vodId}`,
    severity: 'info',
    metadata: { vodId, twitchVodId: vod.twitch_vod_id, prevStatus: vod.status, workspace_id: vod.workspace_id },
  });

  return NextResponse.json({ ok: true });
}
