import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

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

  const { data: h, error: fetchErr } = await db
    .from('content_highlights')
    .select('id,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId)
    .single();

  if (fetchErr || !h) {
    return NextResponse.json(
      { error: `Highlight ikke funnet: ${fetchErr?.message ?? 'ukjent'}` },
      { status: 404 }
    );
  }
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json(
      { error: `Highlight er ikke ferdig klippet (clip_status = ${h.clip_status})` },
      { status: 400 }
    );
  }
  if (!h.clip_url && !h.vertical_clip_url) {
    return NextResponse.json({ error: 'Ingen video-URL – kan ikke generere thumbnail' }, { status: 400 });
  }

  // Sett PENDING i DB
  const { error: updateErr } = await db
    .from('content_highlights')
    .update({ thumbnail_status: 'PENDING', thumbnail_error: null })
    .eq('id', highlightId);

  if (updateErr) {
    const melding = updateErr.message?.includes('column')
      ? 'Databasekolonner mangler – kjør supabase/thumbnail-migration.sql i Supabase SQL Editor først'
      : `DB-oppdatering feilet: ${updateErr.message}`;
    return NextResponse.json({ error: melding }, { status: 500 });
  }

  // Kall Railway direkte for umiddelbar generering (bypass 90s polling)
  const botApiUrl = process.env.BOT_API_URL;
  if (botApiUrl) {
    const railwayRes = await fetch(`${botApiUrl}/content-factory/thumbnail-force/${highlightId}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);

    if (railwayRes?.ok) {
      return NextResponse.json({ ok: true, melding: 'Thumbnail-generering startet direkte på Railway' });
    }
  }

  return NextResponse.json({ ok: true, melding: 'Thumbnail satt i kø – Railway plukker opp innen 90s' });
}
