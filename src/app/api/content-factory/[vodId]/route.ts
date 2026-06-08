import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';

export async function GET(
  _req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  const { vodId } = params;
  if (!vodId) return NextResponse.json({ error: 'vodId mangler' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const [highlightsRes, copyRes] = await Promise.all([
    db.from('content_highlights')
      .select('*')
      .eq('vod_id', vodId)
      .order('rank', { ascending: true }),
    db.from('content_copy')
      .select('*')
      .eq('vod_id', vodId),
  ]);

  return NextResponse.json({
    vodId,
    highlights: highlightsRes.data ?? [],
    copy: copyRes.data ?? [],
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }
  const { vodId } = params;
  if (!vodId) return NextResponse.json({ error: 'vodId mangler' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const { data: highlights } = await db
    .from('content_highlights')
    .select('id')
    .eq('vod_id', vodId);

  if (highlights && highlights.length > 0) {
    const stier = highlights.flatMap((h: any) => [
      `content-factory/clips/${vodId}/${h.id}_16x9.mp4`,
      `content-factory/clips/${vodId}/${h.id}_9x16.mp4`,
    ]);
    await db.storage.from(STORAGE_BUCKET).remove(stier).catch(() => {});
  }

  // Delete in FK-safe order: leaf tables first, then parents
  await db.from('content_review_queue').delete().eq('vod_id', vodId);
  const highlightIds = (highlights ?? []).map((h: any) => h.id);
  if (highlightIds.length > 0) {
    await db.from('content_captions').delete().in('highlight_id', highlightIds);
  }
  await db.from('content_assets').delete().eq('vod_id', vodId);
  await db.from('content_copy').delete().eq('vod_id', vodId);
  await db.from('content_transcripts').delete().eq('vod_id', vodId);
  await db.from('content_highlights').delete().eq('vod_id', vodId);
  await db.from('content_pipeline_logs').delete().eq('vod_id', vodId);

  const { error: slettError } = await db.from('content_vods').delete().eq('id', vodId);
  if (slettError) return NextResponse.json({ error: slettError.message }, { status: 500 });

  return NextResponse.json({ ok: true, slettet: vodId });
}
