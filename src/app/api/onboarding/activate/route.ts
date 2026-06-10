import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const now = new Date().toISOString();
  const { error } = await db.from('workspaces').update({
    onboarding_completed_at: now,
    onboarding_step: 5,
    updated_at: now,
  }).eq('id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try { await db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'onboarding',
    event_type: 'ONBOARDING_COMPLETED',
    title: `Onboarding fullført for workspace ${workspaceId}`,
    severity: 'info',
    metadata: { workspaceId, completedAt: now },
  }); } catch {}

  return NextResponse.json({ ok: true });
}
