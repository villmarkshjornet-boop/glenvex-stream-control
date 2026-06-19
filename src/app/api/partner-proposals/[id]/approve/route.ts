import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const proposalId = params.id;
  const h = headers();
  const wsId = getWorkspaceId();
  const userId = h.get('x-user-id') ?? 'unknown';

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  // Fetch proposal — workspace-scoped so users can only approve their own
  const { data: proposal, error: fetchErr } = await db
    .from('partner_proposals')
    .select('id, status, partner_name, partner_id, platform, message_twitch, message_discord')
    .eq('id', proposalId)
    .eq('workspace_id', wsId)
    .single();

  if (fetchErr || !proposal) {
    return NextResponse.json({ error: 'Forslag ikke funnet' }, { status: 404 });
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { error: `Forslaget er allerede ${proposal.status}` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  const { error: updateErr } = await db
    .from('partner_proposals')
    .update({ status: 'approved', approved_by: userId, approved_at: now })
    .eq('id', proposalId)
    .eq('workspace_id', wsId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Close the latest linked ai_agent_decisions row (by proposalId stored in input_context)
  const { data: decision } = await db
    .from('ai_agent_decisions')
    .select('id')
    .eq('workspace_id', wsId)
    .filter('input_context->>proposalId', 'eq', proposalId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (decision?.id) {
    await db
      .from('ai_agent_decisions')
      .update({ outcome: 'success' })
      .eq('id', decision.id);
  }

  try {
    await db.from('system_events').insert({
      workspace_id: wsId,
      source: 'dashboard',
      event_type: 'PARTNER_PROPOSAL_APPROVED',
      title: `Forslag godkjent: ${proposal.partner_name}`,
      severity: 'info',
      metadata: {
        proposalId,
        partnerName: proposal.partner_name,
        platform: proposal.platform,
        approvedBy: userId,
        decisionId: decision?.id ?? null,
      },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    proposalId,
    partnerName: proposal.partner_name,
    status: 'approved',
    decisionClosed: !!decision?.id,
  });
}
