/**
 * POST /api/content-factory/thumbnails/generate-v2
 *
 * Setter thumbnail_status = GENERATING og delegerer til Railway.
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

  // Sett GENERATING umiddelbart – ALDRI rør clip_status
  try {
    await db.from('content_highlights').update({
      thumbnail_status: 'GENERATING',
      thumbnail_error:  null,
    }).eq('id', highlightId);
  } catch {}

  // Fyr Railway asynkront (fire and forget)
  const botUrl = process.env.BOT_API_URL;
  if (botUrl) {
    fetch(`${botUrl}/content-factory/thumbnail-build-v2/${highlightId}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
    }).catch(async () => {
      // Railway ikke tilgjengelig – sett FAILED
      try {
        await db.from('content_highlights').update({
          thumbnail_status: 'FAILED',
          thumbnail_error:  'Railway (BOT_API_URL) ikke tilgjengelig',
        }).eq('id', highlightId);
      } catch {}
    });
  } else {
    // Ingen BOT_API_URL – sett FAILED
    try {
      await db.from('content_highlights').update({
        thumbnail_status: 'FAILED',
        thumbnail_error:  'BOT_API_URL ikke satt – kan ikke starte thumbnail-generering',
      }).eq('id', highlightId);
    } catch {}
    return NextResponse.json({ error: 'BOT_API_URL mangler' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'GENERATING' });
}
