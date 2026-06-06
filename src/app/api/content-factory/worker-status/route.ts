import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const botApiUrl = process.env.BOT_API_URL;
  if (!botApiUrl) {
    return NextResponse.json({ error: 'BOT_API_URL ikke satt', railwayNådd: false }, { status: 503 });
  }

  const res = await fetch(`${botApiUrl}/content-factory/worker-status`, {
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ error: 'Railway ikke tilgjengelig', railwayNådd: false }, { status: 503 });
  }

  const data = await res.json();
  return NextResponse.json({ ...data, railwayNådd: true });
}
