import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source:       'onboarding',
      event_type:   'WORKSPACE_ONBOARDING_READY',
      title:        `Workspace ${workspaceId} klar for bot-oppstart`,
      severity:     'info',
      metadata:     { alpha_enabled: true, source: 'onboarding_activate' },
    });
  } catch (err: any) {
    console.error('[notify-bot] Klarte ikke skrive system_event:', err?.message);
    // Don't fail the request — best-effort notification
  }

  return NextResponse.json({ ok: true });
}
