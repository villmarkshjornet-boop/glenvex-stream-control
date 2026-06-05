/** Nullstiller lastNotifiedStreamId slik at neste live-sjekk varsler Discord. */
import { NextResponse } from 'next/server';
import { saveSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST() {
  saveSettings({ lastNotifiedStreamId: null });
  return NextResponse.json({ ok: true, melding: 'lastNotifiedStreamId nullstilt – boten vil varsle ved neste sjekk (innen 2 min)' });
}
