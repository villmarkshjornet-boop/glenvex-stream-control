/** Nullstiller lastNotifiedStreamId slik at neste live-sjekk varsler Discord. */
import { NextRequest, NextResponse } from 'next/server';
import { saveSettings } from '@/lib/settings';
import { requireAuth } from '@/lib/requireAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  saveSettings({ lastNotifiedStreamId: null });
  return NextResponse.json({ ok: true, melding: 'lastNotifiedStreamId nullstilt – boten vil varsle ved neste sjekk (innen 2 min)' });
}
