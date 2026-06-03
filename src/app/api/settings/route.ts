import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const updated = saveSettings(body);
    addLog('info', 'Innstillinger oppdatert', 'OK');
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
}
