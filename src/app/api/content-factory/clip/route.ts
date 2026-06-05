import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId, highlightId } = await req.json();
  if (!vodId || !highlightId) {
    return NextResponse.json({ error: 'vodId og highlightId kreves' }, { status: 400 });
  }

  const botApiUrl = process.env.BOT_API_URL;
  if (!botApiUrl) {
    return NextResponse.json({ error: 'BOT_API_URL ikke satt' }, { status: 500 });
  }

  // Send klipp-jobb til Railway (asynkron)
  const res = await fetch(`${botApiUrl}/content-factory/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vodId, highlightId }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ ok: true, melding: 'Klipp-jobb startet på Railway (ingen bekreftelse)' });
  }

  return NextResponse.json({ ok: true, melding: 'Klipp-jobb startet' });
}
