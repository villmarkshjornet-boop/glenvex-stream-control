import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { highlightId } = await req.json();
  if (!highlightId) return NextResponse.json({ error: 'highlightId kreves' }, { status: 400 });

  const botApiUrl = process.env.BOT_API_URL;
  if (!botApiUrl) return NextResponse.json({ error: 'BOT_API_URL ikke satt' }, { status: 500 });

  const res = await fetch(`${botApiUrl}/content-factory/clip-retry/${highlightId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ error: 'Kunne ikke nå Railway' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
