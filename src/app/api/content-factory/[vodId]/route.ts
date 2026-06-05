import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
    await db.storage.from('glenvex-assets').remove(stier).catch(() => {});
  }

  await db.from('content_transcripts').delete().eq('vod_id', vodId);
  await db.from('content_highlights').delete().eq('vod_id', vodId);
  await db.from('content_copy').delete().eq('vod_id', vodId).catch(() => {});
  await db.from('content_vods').delete().eq('id', vodId);

  return NextResponse.json({ ok: true, slettet: vodId });
}
