/**
 * POST /api/content-factory/thumbnails/generate-v2
 *
 * Setter thumbnail_status = PENDING og signalerer Railway via HTTP.
 * Railway gjør alt: frame extraction, Vision-utvalg, Sharp compositing.
 * Returnerer umiddelbart – UI poller DB for DONE/FAILED.
 *
 * clip_status røres ALDRI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  let highlightId: string;
  try {
    const body = await req.json();
    highlightId = body.highlight_id;
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON – send { highlight_id }' }, { status: 400 });
  }
  if (!highlightId) return NextResponse.json({ error: 'highlight_id kreves' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  // Valider highlight
  const { data: h, error: hErr } = await db
    .from('content_highlights')
    .select('id,clip_status,clip_url,vertical_clip_url')
    .eq('id', highlightId)
    .single();

  if (hErr || !h) return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  if (h.clip_status !== 'CLIPPED') {
    return NextResponse.json({ error: `clip_status = ${h.clip_status}, ikke CLIPPED` }, { status: 400 });
  }
  if (!h.clip_url && !h.vertical_clip_url) {
    return NextResponse.json({ error: 'Ingen video-URL på highlightet' }, { status: 400 });
  }

  // Sett PENDING – Railway-worker claimer jobben og setter GENERATING
  // clip_status røres ALDRI
  const { error: pendingErr } = await db.from('content_highlights').update({
    thumbnail_status: 'PENDING',
    thumbnail_error:  null,
  }).eq('id', highlightId);
  if (pendingErr) {
    return NextResponse.json({ error: 'Klarte ikke sette PENDING: ' + pendingErr.message }, { status: 500 });
  }
  // V2b: reset stale-timer – ignorer feil (kolonne krever thumbnail-v2b-migration.sql)
  await db.from('content_highlights').update({ thumbnail_started_at: null }).eq('id', highlightId);

  // Signal Railway om å starte umiddelbart (fast-path).
  // Hvis HTTP feiler: status forblir PENDING og Railway-polleren plukker opp innen 90s.
  const botUrl = process.env.BOT_API_URL;
  if (!botUrl) {
    // Ingen Railway – ingen som kan plukke opp PENDING-jobben
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  'BOT_API_URL ikke satt – Railway ikke tilkoblet',
      }).eq('id', highlightId);
    } catch {}
    return NextResponse.json({ error: 'BOT_API_URL mangler' }, { status: 500 });
  }

  fetch(`${botUrl}/content-factory/thumbnail-build-v2/${highlightId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    // HTTP-signal feilet – status er fortsatt PENDING, Railway-poller tar det opp
    console.warn(`[ThumbnailV2] Railway HTTP-signal feilet for ${highlightId} – poller tar det opp`);
  });

  return NextResponse.json({ ok: true, status: 'PENDING' });
}
