import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB utilgjengelig' }, { status: 503 });

  const ws = getWorkspaceId();

  let body: { decisionId: string; outcome: 'completed' | 'ignored' | 'not_relevant'; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }); }

  const { decisionId, outcome, note } = body;
  if (!decisionId || !['completed', 'ignored', 'not_relevant'].includes(outcome)) {
    return NextResponse.json({ error: 'Mangler decisionId eller ugyldig outcome' }, { status: 400 });
  }

  // Verify the decision belongs to this workspace
  const { data: decision, error: fetchErr } = await db
    .from('ai_agent_decisions')
    .select('id,workspace_id,decision_summary')
    .eq('id', decisionId)
    .eq('workspace_id', ws)
    .single();

  if (fetchErr || !decision) {
    return NextResponse.json({ error: 'Beslutning ikke funnet' }, { status: 404 });
  }

  // Update outcome and feedback_score (no updated_at or metadata column in ai_agent_decisions)
  const { error: updateErr } = await db
    .from('ai_agent_decisions')
    .update({
      outcome,
      feedback_score: outcome === 'completed' ? 1.0 : outcome === 'not_relevant' ? 0 : 0.3,
    })
    .eq('id', decisionId)
    .eq('workspace_id', ws);

  if (updateErr) {
    return NextResponse.json({ error: 'Oppdatering feilet' }, { status: 500 });
  }

  // If completed, write a positive memory signal
  if (outcome === 'completed') {
    try {
      await db.from('ai_agent_memory').upsert({
        workspace_id:     ws,
        agent_type:       'ai_producer',
        memory_type:      'feedback_pattern',
        key:              `completed_recommendation_${Date.now()}`,
        summary:          `Gjennomført: ${(decision as any).decision_summary?.slice(0, 150) ?? ''}`,
        confidence_score: 0.8,
        metadata:         { decisionId, outcome, note: note ?? null },
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'workspace_id,agent_type,memory_type,key' });
    } catch {}
  }

  return NextResponse.json({ ok: true, decisionId, outcome });
}
