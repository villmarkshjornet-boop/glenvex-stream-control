import { NextResponse }    from 'next/server';
import { getDb }           from '@/lib/db';
import { getWorkspaceId }  from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const db = getDb();
  const ws = getWorkspaceId();

  let body: { missionId: string; label?: string; startIso?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 });
  }

  const { missionId, label, startIso } = body;
  if (!missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

  if (!db) return NextResponse.json({ ok: true }); // silent — no DB, localStorage is enough

  try {
    await db.from('system_events').insert({
      workspace_id: ws,
      source:       'mission_queue',
      event_type:   'MISSION_COMPLETED',
      title:        `Mission fullført: ${label ?? missionId}`,
      severity:     'info',
      metadata:     { missionId, label, startIso: startIso ?? null },
    });
  } catch {}

  return NextResponse.json({ ok: true });
}
