import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const botApiUrl = process.env.BOT_API_URL;

  if (!botApiUrl) {
    return NextResponse.json({
      status: 'unknown',
      melding: 'BOT_API_URL ikke satt i Vercel env vars',
      online: false,
    });
  }

  try {
    const start = Date.now();
    const res = await fetch(`${botApiUrl}/`, {
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;

    if (res.ok) {
      return NextResponse.json({ status: 'online', latency, online: true, botApiUrl });
    }
    return NextResponse.json({ status: 'feil', latency, online: false });
  } catch {
    return NextResponse.json({ status: 'offline', online: false, melding: 'Kan ikke nå Railway-boten' });
  }
}
