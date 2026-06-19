import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface PartnerStats {
  contentLog: {
    total: number;
    discord: number;
    twitch: number;
    recent7d: number;
    recent30d: number;
    lastPosted: string | null;
    channels: string[];
  };
  proposals: {
    total: number;
    sent: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number | null;
  };
  lastDecision: {
    id: string;
    score: number | null;
    reasonCode: string | null;
    triggerType: string | null;
    outcome: string | null;
    createdAt: string;
  } | null;
  dataStrength: 'god' | 'moderat' | 'svak';
  recommendation: string;
}

function computeDataStrength(
  contentLog: PartnerStats['contentLog'],
  proposals: PartnerStats['proposals']
): PartnerStats['dataStrength'] {
  const total = contentLog.total + proposals.total;
  if (total >= 10) return 'god';
  if (total >= 3)  return 'moderat';
  return 'svak';
}

function computeRecommendation(
  contentLog: PartnerStats['contentLog'],
  proposals: PartnerStats['proposals'],
  lastDecision: PartnerStats['lastDecision']
): string {
  const totalDataPoints = contentLog.total + proposals.total;
  if (totalDataPoints < 3) return 'For lite historikk – test manuelt';

  const daysSinceSend = contentLog.lastPosted
    ? (Date.now() - new Date(contentLog.lastPosted).getTime()) / 86_400_000
    : Infinity;

  const { approvalRate } = proposals;
  const recentlyActive = contentLog.recent7d > 0 || contentLog.recent30d > 0;

  if (approvalRate !== null && approvalRate >= 0.8 && recentlyActive)
    return 'Høy godkjennelsesrate og nylig aktiv – øk frekvens';

  if (approvalRate !== null && approvalRate >= 0.8 && daysSinceSend > 14)
    return 'Godt godkjent historikk – tid for ny promo';

  if (approvalRate !== null && approvalRate < 0.3 && proposals.total >= 3)
    return 'Lav godkjennelsesrate – vurder timing og melding';

  if (lastDecision?.score !== null && (lastDecision?.score ?? 0) >= 0.75)
    return 'AI scorer høyt – prioriter ved neste promo-sjekk';

  if (daysSinceSend > 21)
    return `Ikke sendt på ${Math.floor(daysSinceSend)} dager – vurder ny promo`;

  if (contentLog.total > 10)
    return 'Godt etablert – fortsett nåværende kadence';

  return 'Normalt aktivitetsnivå';
}

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({
    byPartner: {},
    totals: { promosSent: 0, proposalsTotal: 0, approvalRate: null, mostActive: null },
  });

  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();

  const [contentLogRes, proposalsRes, decisionsRes, partnersRes] = await Promise.all([
    db.from('partner_content_log')
      .select('partner_name, platform, channel, posted_at')
      .eq('workspace_id', wsId)
      .gte('posted_at', since90d)
      .order('posted_at', { ascending: false })
      .limit(500),

    db.from('partner_proposals')
      .select('partner_name, partner_id, status, created_at, sent_at')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false })
      .limit(500),

    db.from('ai_agent_decisions')
      .select('id, outcome, input_context, created_at')
      .eq('workspace_id', wsId)
      .eq('agent_type', 'partner_promotion')
      .gte('created_at', since90d)
      .order('created_at', { ascending: false })
      .limit(300),

    db.from('partners')
      .select('id, navn, aktiv')
      .eq('workspace_id', wsId),
  ]);

  // Collect all known partner names from every source
  const allNamesSet = new Set<string>();
  for (const p of (partnersRes.data ?? [])) if ((p as any).navn) allNamesSet.add((p as any).navn);
  for (const p of (proposalsRes.data  ?? [])) if (p.partner_name) allNamesSet.add(p.partner_name);
  for (const l of (contentLogRes.data ?? [])) if (l.partner_name) allNamesSet.add(l.partner_name);
  const allNames = Array.from(allNamesSet);

  // Group content logs by partner_name
  const logsByPartner: Record<string, typeof contentLogRes.data> = {};
  for (const log of (contentLogRes.data ?? [])) {
    if (!log.partner_name) continue;
    (logsByPartner[log.partner_name] ??= []).push(log);
  }

  // Group proposals by partner_name
  const proposalsByPartner: Record<string, typeof proposalsRes.data> = {};
  for (const p of (proposalsRes.data ?? [])) {
    (proposalsByPartner[p.partner_name] ??= []).push(p);
  }

  // Latest decision per partnerName — decisions already sorted DESC so first match wins
  const latestDecisionByPartner: Record<string, any> = {};
  for (const d of (decisionsRes.data ?? [])) {
    const name = (d.input_context as any)?.partnerName as string | undefined;
    if (name && !latestDecisionByPartner[name]) latestDecisionByPartner[name] = d;
  }

  const byPartner: Record<string, PartnerStats> = {};

  for (const name of allNames) {
    const logs  = (logsByPartner[name]      ?? []) as any[];
    const props = (proposalsByPartner[name] ?? []) as any[];
    const decRaw = latestDecisionByPartner[name] ?? null;

    const contentLog: PartnerStats['contentLog'] = {
      total:    logs.length,
      discord:  logs.filter((l: any) => l.platform === 'discord').length,
      twitch:   logs.filter((l: any) => l.platform === 'twitch').length,
      recent7d: logs.filter((l: any) => l.posted_at >= since7d).length,
      recent30d:logs.filter((l: any) => l.posted_at >= since30d).length,
      lastPosted: logs[0]?.posted_at ?? null,
      channels: Array.from(new Set(logs.map((l: any) => l.channel).filter(Boolean))) as string[],
    };

    const sentCount      = props.filter((p: any) => p.status === 'sent').length;
    const approvedCount  = props.filter((p: any) => p.status === 'approved').length;
    const rejectedCount  = props.filter((p: any) => p.status === 'rejected').length;
    const pendingCount   = props.filter((p: any) => p.status === 'pending').length;
    const countedApproved = approvedCount + sentCount;
    const decided = countedApproved + rejectedCount;
    const approvalRate = decided > 0 ? countedApproved / decided : null;

    const proposals: PartnerStats['proposals'] = {
      total: props.length,
      sent: sentCount,
      approved: approvedCount,
      rejected: rejectedCount,
      pending: pendingCount,
      approvalRate,
    };

    const lastDecision: PartnerStats['lastDecision'] = decRaw ? {
      id:          decRaw.id,
      score:       (decRaw.input_context as any)?.score       ?? null,
      reasonCode:  (decRaw.input_context as any)?.reasonCode  ?? null,
      triggerType: (decRaw.input_context as any)?.triggerType ?? null,
      outcome:     decRaw.outcome,
      createdAt:   decRaw.created_at,
    } : null;

    const dataStrength   = computeDataStrength(contentLog, proposals);
    const recommendation = computeRecommendation(contentLog, proposals, lastDecision);

    byPartner[name] = { contentLog, proposals, lastDecision, dataStrength, recommendation };
  }

  // Global totals
  const vals = Object.values(byPartner);
  const promosSent      = vals.reduce((s, p) => s + p.contentLog.total, 0);
  const proposalsTotal  = vals.reduce((s, p) => s + p.proposals.total, 0);
  const totalApproved   = vals.reduce((s, p) => s + p.proposals.approved + p.proposals.sent, 0);
  const totalRejected   = vals.reduce((s, p) => s + p.proposals.rejected, 0);
  const decided         = totalApproved + totalRejected;
  const approvalRate    = decided > 0 ? totalApproved / decided : null;
  const mostActive      = Object.entries(byPartner)
    .sort((a, b) => b[1].contentLog.total - a[1].contentLog.total)[0]?.[0] ?? null;

  return NextResponse.json({
    byPartner,
    totals: { promosSent, proposalsTotal, approvalRate, mostActive },
  });
}
