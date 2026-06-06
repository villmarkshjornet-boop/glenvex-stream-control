import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { highlightId } = await req.json();
  if (!highlightId) return NextResponse.json({ error: 'highlightId kreves' }, { status: 400 });

  // Sett til READY_FOR_CLIP i DB (slik at syklus også plukker det opp)
  const db = getDb();
  if (db) {
    await db.from('content_highlights').update({
      clip_status: 'READY_FOR_CLIP',
      clip_error: null,
    }).eq('id', highlightId);
  }

  const botApiUrl = process.env.BOT_API_URL;
  if (!botApiUrl) {
    return NextResponse.json({
      ok: true,
      melding: 'Status satt til READY_FOR_CLIP – Railway plukker opp ved neste syklus (BOT_API_URL ikke satt)',
    });
  }

  // Kall Railway direkte for umiddelbar klipping (bypass 60s polling)
  const railwayRes = await fetch(`${botApiUrl}/content-factory/clip-force/${highlightId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!railwayRes?.ok) {
    return NextResponse.json({
      ok: true,
      melding: 'Status satt til READY_FOR_CLIP – Railway var ikke tilgjengelig direkte, plukkes opp automatisk',
    });
  }

  return NextResponse.json({ ok: true, melding: `Force-klipp trigget direkte på Railway` });
}
