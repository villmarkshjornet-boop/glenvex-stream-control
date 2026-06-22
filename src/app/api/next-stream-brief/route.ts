import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface BriefAction {
  id: string;
  stars: 1 | 2 | 3;
  timing: string;
  action: string;
  expectedEffect: string | null;
  reason: string;
  confidence: 'høy' | 'middels' | 'lav';
  dataSource: string;
}

export interface NextStreamBriefData {
  actions: BriefAction[];
  basedOnStreams: number;
  avgStreamDurationMin: number | null;
  generatedAt: string;
}

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ actions: [], basedOnStreams: 0, avgStreamDurationMin: null, generatedAt: new Date().toISOString() });
  const ws = getWorkspaceId();
  const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

  // x_post_memory may not exist yet — isolate its query
  let xPosts: any[] = [];
  try {
    const r = await db
      .from('x_post_memory')
      .select('stream_elapsed_min,viewer_delta_10min,viewer_delta_5min,variant_label,hook_score')
      .eq('workspace_id', ws)
      .eq('status', 'posted')
      .not('viewer_delta_10min', 'is', null)
      .order('viewer_delta_10min', { ascending: false })
      .limit(20);
    xPosts = r.data ?? [];
  } catch { /* table may not exist yet */ }

  const [streamHistoryRes, knowledgeRes] = await Promise.all([
    db
      .from('stream_history')
      .select('duration_minutes,peak_viewers,avg_viewers,started_at')
      .eq('workspace_id', ws)
      .gte('started_at', cutoff90d)
      .gt('duration_minutes', 14)
      .order('started_at', { ascending: false })
      .limit(20),
    db
      .from('creator_knowledge')
      .select('knowledge_type,key,finding,confidence,evidence_count')
      .eq('workspace_id', ws)
      .in('knowledge_type', ['timing_pattern', 'stream_behaviour', 'creator_preference'])
      .order('confidence', { ascending: false })
      .limit(10),
  ]);

  const streams = streamHistoryRes.data ?? [];
  const knowledge = knowledgeRes.data ?? [];

  const avgDuration = streams.length > 0
    ? Math.round(streams.reduce((sum: number, r: any) => sum + (r.duration_minutes ?? 0), 0) / streams.length)
    : null;

  const actions: BriefAction[] = [];

  // ── 1. X post timing ───────────────────────────────────────────────────────
  const postsWithDelta = xPosts.filter(p => (p.viewer_delta_10min ?? 0) !== null);
  if (postsWithDelta.length >= 1) {
    const best = postsWithDelta[0];
    const avgDelta = Math.round(
      postsWithDelta.reduce((s: number, p: any) => s + (p.viewer_delta_10min ?? 0), 0) / postsWithDelta.length,
    );
    const positiveCount = postsWithDelta.filter(p => (p.viewer_delta_10min ?? 0) > 0).length;

    const elapsed = best.stream_elapsed_min ?? 10;
    const timing = elapsed <= 5
      ? '5–10 min etter streamstart'
      : `ca. ${elapsed} min etter streamstart`;

    const confidence: BriefAction['confidence'] =
      postsWithDelta.length >= 5 && avgDelta > 0 ? 'høy'
      : postsWithDelta.length >= 2                ? 'middels'
      : 'lav';

    actions.push({
      id: 'x_post',
      stars: 3,
      timing,
      action: 'Post på X/Twitter',
      expectedEffect: avgDelta > 0
        ? `+${avgDelta} seere snitt`
        : positiveCount > 0 ? 'Positiv effekt' : null,
      reason: postsWithDelta.length >= 2
        ? `${positiveCount} av ${postsWithDelta.length} poster ga positiv effekt`
        : 'Basert på 1 X-post med målt data',
      confidence,
      dataSource: `${postsWithDelta.length} X-poster`,
    });
  } else {
    actions.push({
      id: 'x_post',
      stars: 2,
      timing: '10 min etter streamstart',
      action: 'Post på X/Twitter',
      expectedEffect: null,
      reason: 'AI Producer foreslår tekst under stream',
      confidence: 'lav',
      dataSource: 'Standard',
    });
  }

  // ── 2. Poll timing — from Creator Knowledge or default ─────────────────────
  const pollLearning = knowledge.find(
    (k: any) => k.key?.toLowerCase().includes('poll') || k.finding?.toLowerCase().includes('poll'),
  );
  if (pollLearning && pollLearning.confidence >= 40) {
    actions.push({
      id: 'poll',
      stars: 2,
      timing: '20–40 min inn',
      action: 'Kjør en viewer-poll',
      expectedEffect: 'Økt chat-aktivitet',
      reason: pollLearning.finding,
      confidence: pollLearning.confidence >= 70 ? 'høy' : 'middels',
      dataSource: `${pollLearning.evidence_count} datapunkt`,
    });
  } else {
    actions.push({
      id: 'poll',
      stars: 2,
      timing: '20–35 min inn',
      action: 'Kjør en viewer-poll',
      expectedEffect: 'Økt chat-aktivitet',
      reason: 'Viewers er engasjerte, men ikke slitne ennå',
      confidence: 'lav',
      dataSource: 'Standard',
    });
  }

  // ── 3. Sponsor/partner post ────────────────────────────────────────────────
  const sponsorTiming = avgDuration
    ? `${Math.min(45, Math.round(avgDuration * 0.25))}–${Math.min(55, Math.round(avgDuration * 0.3))} min inn`
    : '35–45 min inn';

  actions.push({
    id: 'sponsor',
    stars: 2,
    timing: sponsorTiming,
    action: 'Post partnerpromo',
    expectedEffect: null,
    reason: avgDuration
      ? `Etter oppvarmingsfasen — viewer-topp i uke ${Math.round(avgDuration / 60)} times snittlengde`
      : 'Høyest viewer-retention etter innkjøringsperioden',
    confidence: avgDuration ? 'middels' : 'lav',
    dataSource: avgDuration ? `Snitt av ${streams.length} streams` : 'Standard',
  });

  // ── 4. Raid timing ────────────────────────────────────────────────────────
  if (avgDuration) {
    const raidMin = Math.max(90, Math.round(avgDuration * 0.75));
    const raidH = Math.floor(raidMin / 60);
    const raidM = raidMin % 60;
    const timingStr = raidH > 0
      ? `etter ${raidH}t${raidM > 0 ? ` ${raidM}m` : ''}`
      : `etter ${raidMin} min`;

    actions.push({
      id: 'raid',
      stars: 2,
      timing: timingStr,
      action: 'Finn raid-kandidat',
      expectedEffect: null,
      reason: `75% av snittlengde (${Math.floor(avgDuration / 60)}t${avgDuration % 60 > 0 ? ` ${avgDuration % 60}m` : ''})`,
      confidence: streams.length >= 5 ? 'høy' : 'middels',
      dataSource: `${streams.length} streams`,
    });
  } else {
    actions.push({
      id: 'raid',
      stars: 1,
      timing: 'etter 1t 30m',
      action: 'Finn raid-kandidat',
      expectedEffect: null,
      reason: 'Standard minimum — data samles over tid',
      confidence: 'lav',
      dataSource: 'Standard',
    });
  }

  // ── 5. Clip rule ──────────────────────────────────────────────────────────
  actions.push({
    id: 'clip',
    stars: 1,
    timing: 'Under hele streamen',
    action: 'Clip øyeblikk med score over 80',
    expectedEffect: null,
    reason: 'Content Factory markerer automatisk',
    confidence: 'høy',
    dataSource: 'Standard',
  });

  const result: NextStreamBriefData = {
    actions,
    basedOnStreams: streams.length,
    avgStreamDurationMin: avgDuration,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(result);
}
