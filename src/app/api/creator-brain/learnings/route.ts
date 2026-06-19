import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  promotion_pattern:  'Godkjenningsmønster',
  rejection_pattern:  'Avvisningsmønster',
  platform_preference:'Plattform-preferanse',
  decision_accuracy:  'AI-treffsikkerhet',
  stream_behaviour:   'Stream-atferd',
  creator_preference: 'Streamer-preferanse',
  partner_performance:'Partner-ytelse',
  timing_pattern:     'Tidspunkt-mønster',
};

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({ learnings: [], summary: null });

  const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [recentRes, allRes, lastRunRes] = await Promise.all([
    // Learnings updated in last 7 days, sorted by confidence
    db.from('creator_knowledge')
      .select('id, knowledge_type, key, title, finding, confidence, evidence_count, evidence_summary, first_seen, last_seen')
      .eq('workspace_id', wsId)
      .gte('updated_at', since7d)
      .order('confidence', { ascending: false })
      .limit(10),

    // All learnings for summary stats
    db.from('creator_knowledge')
      .select('knowledge_type, key, confidence, evidence_count, evidence_summary, updated_at')
      .eq('workspace_id', wsId)
      .order('updated_at', { ascending: false })
      .limit(200),

    // Last learning run
    db.from('system_events')
      .select('title, metadata, created_at')
      .eq('workspace_id', wsId)
      .eq('event_type', 'LEARNING_COMPLETED')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const recent = (recentRes.data ?? []).map(r => ({
    id:            r.id,
    knowledgeType: r.knowledge_type,
    typeLabel:     TYPE_LABEL[r.knowledge_type] ?? r.knowledge_type,
    key:           r.key,
    title:         r.title,
    finding:       r.finding,
    confidence:    r.confidence,
    evidenceCount: r.evidence_count,
    firstSeen:     r.first_seen,
    lastSeen:      r.last_seen,
  }));

  const all = allRes.data ?? [];

  // Most approved partner
  const promotionEntries = all.filter(r => r.knowledge_type === 'promotion_pattern');
  const topPartner = promotionEntries.sort((a: any, b: any) =>
    ((b.evidence_summary as any)?.approvalRate ?? 0) - ((a.evidence_summary as any)?.approvalRate ?? 0)
  )[0];

  // Best timing window (stream_behaviour)
  const bestTiming = all
    .filter(r => r.knowledge_type === 'stream_behaviour')
    .sort((a: any, b: any) =>
      ((b.evidence_summary as any)?.approvalRate ?? 0) - ((a.evidence_summary as any)?.approvalRate ?? 0)
    )[0];

  // Best platform
  const bestPlatform = all
    .filter(r => r.knowledge_type === 'platform_preference')
    .sort((a: any, b: any) => b.evidence_count - a.evidence_count)[0];

  // Avg confidence trend (recent vs older 30d)
  const recent30d = all.filter(r => r.updated_at >= since30d);
  const avgConfidence = recent30d.length > 0
    ? Math.round(recent30d.reduce((s: number, r: any) => s + r.confidence, 0) / recent30d.length)
    : null;

  const lastRun = lastRunRes.data?.[0] ?? null;

  const summary = {
    totalLearnings:    all.length,
    recentCount:       recent.length,
    avgConfidence,
    topPartner: topPartner ? {
      name:         (topPartner.evidence_summary as any)?.partner ?? topPartner.key.replace('partner:', ''),
      approvalRate: (topPartner.evidence_summary as any)?.approvalRate ?? null,
      evidenceCount: topPartner.evidence_count,
    } : null,
    bestTimingWindow: bestTiming ? {
      label:        (bestTiming.evidence_summary as any)?.label ?? bestTiming.key,
      approvalRate: (bestTiming.evidence_summary as any)?.approvalRate ?? null,
      evidenceCount: bestTiming.evidence_count,
    } : null,
    bestPlatform: bestPlatform ? {
      platform:    (bestPlatform.evidence_summary as any)?.platform ?? bestPlatform.key.replace('platform:', ''),
      percentage:  (bestPlatform.evidence_summary as any)?.percentage ?? null,
      evidenceCount: bestPlatform.evidence_count,
    } : null,
    lastRun: lastRun ? {
      ts:      lastRun.created_at,
      total:   (lastRun.metadata as any)?.total          ?? null,
      created: (lastRun.metadata as any)?.created        ?? null,
      updated: (lastRun.metadata as any)?.updated        ?? null,
      proposalsAnalyzed: (lastRun.metadata as any)?.proposalsAnalyzed ?? null,
      decisionsAnalyzed: (lastRun.metadata as any)?.decisionsAnalyzed ?? null,
    } : null,
  };

  return NextResponse.json({ learnings: recent, summary });
}
