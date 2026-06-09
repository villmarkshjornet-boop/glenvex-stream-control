import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const ws = getWorkspaceId();
  const { data } = await db.from('workspaces').select('settings_json').eq('id', ws).single();
  const current = (data as any)?.settings_json ?? {};

  await db.from('workspaces').update({
    settings_json: {
      ...current,
      stream_syklus: {},
    },
    updated_at: new Date().toISOString(),
  }).eq('id', ws);

  await logSystemEvent({
    source: 'stream_syklus',
    event_type: 'STREAM_CYCLE_RESET',
    title: 'Stream-syklus nullstilt manuelt',
    severity: 'info',
    metadata: { resetAt: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true });
}
