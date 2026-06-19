import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({
    sistVurdert: null, sistSendt: null, partnerEksponering: [], sisteDecisions: [],
  });

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [vurdert, sendt, partners, decisions] = await Promise.all([
    db.from('system_events')
      .select('event_type, title, metadata, created_at')
      .eq('workspace_id', wsId)
      .in('event_type', ['PARTNER_PROMOTION_CONSIDERED', 'PARTNER_PROMOTION_SKIPPED'])
      .order('created_at', { ascending: false })
      .limit(1),

    db.from('system_events')
      .select('title, metadata, created_at')
      .eq('workspace_id', wsId)
      .eq('event_type', 'PARTNER_PROPOSAL_SENT')
      .order('created_at', { ascending: false })
      .limit(1),

    db.from('partners')
      .select('navn, siste_promotert, eksponering')
      .eq('workspace_id', wsId)
      .eq('aktiv', true)
      .order('eksponering', { ascending: false })
      .limit(10),

    db.from('ai_agent_decisions')
      .select('id, decision_summary, outcome, input_context, created_at')
      .eq('workspace_id', wsId)
      .eq('agent_type', 'partner_promotion')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const v = vurdert.data?.[0] ?? null;
  const s = sendt.data?.[0] ?? null;

  return NextResponse.json({
    sistVurdert: v ? {
      ts:          v.created_at,
      eventType:   v.event_type,
      reasonCode:  (v.metadata as any)?.reasonCode  ?? null,
      partnerName: (v.metadata as any)?.partnerName ?? null,
      score:       (v.metadata as any)?.score       ?? null,
      triggerType: (v.metadata as any)?.triggerType ?? null,
    } : null,

    sistSendt: s ? {
      ts:          s.created_at,
      partnerName: (s.metadata as any)?.partnerName  ?? null,
      platform:    (s.metadata as any)?.platform     ?? null,
      sentDiscord: (s.metadata as any)?.sentDiscord  ?? null,
      sentTwitch:  (s.metadata as any)?.sentTwitch   ?? null,
    } : null,

    partnerEksponering: (partners.data ?? []).map(p => ({
      navn:          p.navn,
      sistePromotert: p.siste_promotert ?? null,
      eksponering:   p.eksponering ?? 0,
    })),

    sisteDecisions: (decisions.data ?? []).map(d => ({
      id:              d.id,
      decisionSummary: d.decision_summary,
      outcome:         d.outcome,
      inputContext:    d.input_context,
      createdAt:       d.created_at,
    })),
  });
}
