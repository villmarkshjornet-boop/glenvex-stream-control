import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/content-factory/thumbnail/[highlightId]
// Nullstiller thumbnail_status → PENDING slik at Railway-worker plukker det opp.
// Regenererer IKKE video, captions eller highlight.
export async function POST(
  _req: NextRequest,
  { params }: { params: { highlightId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { highlightId } = params;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const { data: h } = await db
    .from('content_highlights')
    .select('id,clip_status,clip_url,vertical_clip_url,thumbnail_status')
    .eq('id', highlightId)
    .single();

  if (!h) return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json({ error: 'Highlight er ikke ferdig klippet (clip_status != CLIPPED)' }, { status: 400 });
  }
  if (!h.clip_url && !h.vertical_clip_url) {
    return NextResponse.json({ error: 'Ingen video-URL – kan ikke generere thumbnail' }, { status: 400 });
  }
  if (h.thumbnail_status === 'GENERATING') {
    return NextResponse.json({ error: 'Thumbnail genereres allerede' }, { status: 409 });
  }

  await db
    .from('content_highlights')
    .update({ thumbnail_status: 'PENDING', thumbnail_error: null })
    .eq('id', highlightId);

  return NextResponse.json({ ok: true, melding: 'Thumbnail-generering satt i kø' });
}
