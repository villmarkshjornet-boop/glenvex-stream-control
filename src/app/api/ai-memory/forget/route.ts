import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const { id, table } = await req.json();
  if (!id) return NextResponse.json({ error: 'id kreves' }, { status: 400 });

  const workspaceId = getWorkspaceId();
  const targetTable = table === 'insights' ? 'ai_agent_insights'
    : table === 'decisions' ? 'ai_agent_decisions'
    : 'ai_agent_memory';

  const { error } = await db
    .from(targetTable)
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
