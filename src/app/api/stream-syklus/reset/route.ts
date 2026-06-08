import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

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

  return NextResponse.json({ ok: true });
}
