import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId, highlightId } = await req.json();
  if (!vodId || !highlightId) {
    return NextResponse.json({ error: 'vodId og highlightId kreves' }, { status: 400 });
  }

  // Oppdater clip_status direkte i Supabase – clip worker på Railway plukker det opp
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const { error } = await db.from('content_highlights').update({
    clip_status: 'READY_FOR_CLIP',
    clip_error: null,
  }).eq('id', highlightId);

  if (error) {
    return NextResponse.json({ error: `DB-feil: ${error.message}` }, { status: 500 });
  }

  // Prøv å varsle Railway (best effort – ikke kritisk)
  const botApiUrl = process.env.BOT_API_URL;
  if (botApiUrl) {
    fetch(`${botApiUrl}/content-factory/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId, highlightId }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {}); // Ikke avvent – bare ping
  }

  return NextResponse.json({ ok: true, melding: 'Klipp-jobb lagt i kø – Railway starter innen 1 minutt' });
}
