import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({ proposals: [] });

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Proposals
  const { data: proposals } = await db
    .from('partner_proposals')
    .select('id, partner_name, platform, confidence, scoring_detail, message_twitch, message_discord, status, expires_at, approved_at, sent_at, created_at')
    .eq('workspace_id', wsId)
    .in('status', ['pending', 'approved', 'sent', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (!proposals || proposals.length === 0) return NextResponse.json({ proposals: [] });

  const proposalIds = proposals.map(p => p.id as string);

  // 2. Related events — single batch query, joined client-side
  const { data: events } = await db
    .from('system_events')
    .select('event_type, title, metadata, created_at')
    .eq('workspace_id', wsId)
    .in('event_type', [
      'PARTNER_PROPOSAL_CREATED',
      'PARTNER_DECISION_TRACE',
      'PARTNER_PROPOSAL_APPROVED',
      'PARTNER_PROPOSAL_REJECTED',
      'PARTNER_PROPOSAL_SENT',
      'PARTNER_PROPOSAL_SEND_FAILED',
    ])
    .gte('created_at', since7d)
    .order('created_at', { ascending: true })
    .limit(500);

  // 3. Related decisions — batch, joined client-side
  const { data: decisions } = await db
    .from('ai_agent_decisions')
    .select('id, decision_summary, outcome, input_context, created_at')
    .eq('workspace_id', wsId)
    .eq('agent_type', 'partner_promotion')
    .gte('created_at', since7d)
    .order('created_at', { ascending: false })
    .limit(100);

  // Group events by proposalId
  const eventsByProposal: Record<string, any[]> = {};
  for (const e of (events ?? [])) {
    const pid = (e.metadata as any)?.proposalId as string | undefined;
    if (pid && proposalIds.includes(pid)) {
      (eventsByProposal[pid] ??= []).push({
        eventType: e.event_type,
        title:     e.title,
        metadata:  e.metadata,
        createdAt: e.created_at,
      });
    }
  }

  // Pick latest decision per proposal (decisions are DESC, so first match wins)
  const decisionByProposal: Record<string, any> = {};
  for (const d of (decisions ?? [])) {
    const pid = (d.input_context as any)?.proposalId as string | undefined;
    if (pid && proposalIds.includes(pid) && !decisionByProposal[pid]) {
      decisionByProposal[pid] = {
        id:              d.id,
        decisionSummary: d.decision_summary,
        outcome:         d.outcome,
        inputContext:    d.input_context,
        createdAt:       d.created_at,
      };
    }
  }

  return NextResponse.json({
    proposals: proposals.map(p => ({
      ...p,
      events:   eventsByProposal[p.id] ?? [],
      decision: decisionByProposal[p.id] ?? null,
    })),
  });
}
