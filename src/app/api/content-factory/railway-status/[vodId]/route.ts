import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

// Proxy til Railway status-endepunkt
export async function GET(
  _req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const botApiUrl = process.env.BOT_API_URL;
  if (!botApiUrl) {
    return NextResponse.json({ status: 'UNKNOWN', melding: 'BOT_API_URL ikke satt' });
  }

  try {
    const res = await fetch(`${botApiUrl}/content-factory/status/${params.vodId}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ status: 'RAILWAY_OFFLINE', melding: e.message });
  }
}
