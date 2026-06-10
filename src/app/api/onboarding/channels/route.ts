import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const body = await req.json() as Record<string, string>;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { data: ws } = await db.from('workspaces').select('settings_json').eq('id', workspaceId).single();
  const current = (ws?.settings_json ?? {}) as Record<string, any>;

  const { error } = await db.from('workspaces').update({
    settings_json: { ...current, kanalPreferanser: body },
    live_channel_id: body.live ?? null,
    onboarding_step: 4,
    updated_at: new Date().toISOString(),
  }).eq('id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try { await db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'onboarding',
    event_type: 'CHANNEL_PREFERENCES_SAVED',
    title: 'Kanalpreferanser lagret',
    severity: 'info',
    metadata: { channels: Object.keys(body).filter(k => body[k]) },
  }); } catch {}

  return NextResponse.json({ ok: true });
}
