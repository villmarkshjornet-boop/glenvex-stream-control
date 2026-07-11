import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

interface PatchBody {
  isExecuted?:  boolean;
  outcome?:     'positive' | 'negative' | 'pending';
  metricsAfter?: Record<string, unknown>;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isDbAvailable()) return NextResponse.json({ ok: false }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });

  const wsId = getWorkspaceId();
  const { id } = params;
  const body: PatchBody = await req.json();

  const patch: Record<string, unknown> = {};
  if (body.isExecuted !== undefined) {
    patch.is_executed = body.isExecuted;
    if (body.isExecuted) patch.executed_at = new Date().toISOString();
  }
  if (body.outcome !== undefined) patch.outcome = body.outcome;
  if (body.metricsAfter !== undefined) patch.metrics_after = body.metricsAfter;

  const { error } = await db
    .from('stream_coach_tips')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', wsId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
