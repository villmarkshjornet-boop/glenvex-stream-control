/**
 * AI Learning Health API
 * Returnerer helsestatus for hele AI-læringssystemet.
 * Kalles av dashboardet for å vise om systemet er friskt.
 *
 * GET /api/ai-learning-health
 */

import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

type HealthStatus = 'ok' | 'warning' | 'broken';

interface MetricResult {
  status: HealthStatus;
  ts: string | null;
  label: string;
  value?: number;
}

function alderLabel(ts: string | null): string {
  if (!ts) return 'aldri';
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 2) return 'akkurat nå';
  if (min < 60) return `${min} min siden`;
  const timer = Math.floor(min / 60);
  if (timer < 24) return `${timer}t siden`;
  return `${Math.floor(timer / 24)}d siden`;
}

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ status: 'broken', error: 'Supabase ikke konfigurert' }, { status: 200 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ status: 'broken' }, { status: 200 });

  const ws = getWorkspaceId();
  const now = Date.now();
  const cut60min = new Date(now - 60 * 60_000).toISOString();
  const cut2h = new Date(now - 2 * 60 * 60_000).toISOString();

  const [
    lastEventRes,
    lastAggrRes,
    lastMemoryRes,
    lastInsightRes,
    eventsLast60minRes,
    lastDecisionRes,
    lastFeedbackRes,
  ] = await Promise.all([
    db.from('ai_agent_events').select('created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(1),
    db.from('system_events').select('created_at,metadata').eq('workspace_id', ws).eq('event_type', 'AGGREGATION_COMPLETE').order('created_at', { ascending: false }).limit(1),
    db.from('ai_agent_memory').select('updated_at').eq('workspace_id', ws).order('updated_at', { ascending: false }).limit(1),
    db.from('ai_agent_insights').select('created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(1),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', cut60min),
    db.from('ai_agent_decisions').select('created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(1),
    db.from('system_events').select('created_at').eq('workspace_id', ws).eq('event_type', 'DECISION_FEEDBACK_LEARNED').order('created_at', { ascending: false }).limit(1),
  ]);

  const lastEventTs = lastEventRes.data?.[0]?.created_at ?? null;
  const lastAggrTs = lastAggrRes.data?.[0]?.created_at ?? null;
  const lastAggrMeta = lastAggrRes.data?.[0]?.metadata ?? null;
  const lastMemoryTs = lastMemoryRes.data?.[0]?.updated_at ?? null;
  const lastInsightTs = lastInsightRes.data?.[0]?.created_at ?? null;
  const eventsCount = eventsLast60minRes.count ?? 0;
  const lastDecisionTs = lastDecisionRes.data?.[0]?.created_at ?? null;
  const lastFeedbackTs = lastFeedbackRes.data?.[0]?.created_at ?? null;

  function ageTsStatus(ts: string | null, warnMs: number, breakMs: number): HealthStatus {
    if (!ts) return 'broken';
    const age = now - new Date(ts).getTime();
    if (age > breakMs) return 'broken';
    if (age > warnMs) return 'warning';
    return 'ok';
  }

  const metrics: Record<string, MetricResult> = {
    lastEvent: {
      status: ageTsStatus(lastEventTs, 2 * 3600_000, 6 * 3600_000),
      ts: lastEventTs,
      label: `Siste hendelse: ${alderLabel(lastEventTs)}`,
    },
    lastAggregation: {
      status: ageTsStatus(lastAggrTs, 20 * 60_000, 60 * 60_000),
      ts: lastAggrTs,
      label: `Siste aggregering: ${alderLabel(lastAggrTs)}`,
      value: lastAggrMeta?.eventsAnalysert ?? undefined,
    },
    lastMemoryUpdate: {
      status: ageTsStatus(lastMemoryTs, 30 * 60_000, 3 * 3600_000),
      ts: lastMemoryTs,
      label: `Siste memory-oppdatering: ${alderLabel(lastMemoryTs)}`,
    },
    lastInsightUpdate: {
      status: ageTsStatus(lastInsightTs, 30 * 60_000, 3 * 3600_000),
      ts: lastInsightTs,
      label: `Siste innsikt: ${alderLabel(lastInsightTs)}`,
    },
    eventsLast60min: {
      status: eventsCount === 0 ? 'broken' : eventsCount < 5 ? 'warning' : 'ok',
      ts: null,
      label: `${eventsCount} hendelser siste 60 min`,
      value: eventsCount,
    },
    lastDecision: {
      status: lastDecisionTs ? 'ok' : 'warning',
      ts: lastDecisionTs,
      label: `Siste AI-beslutning: ${alderLabel(lastDecisionTs)}`,
    },
    lastFeedbackLoop: {
      status: lastFeedbackTs ? 'ok' : 'warning',
      ts: lastFeedbackTs,
      label: `Siste feedback-analyse: ${alderLabel(lastFeedbackTs)}`,
    },
  };

  const statuses = Object.values(metrics).map(m => m.status);
  const overallStatus: HealthStatus =
    statuses.includes('broken') ? 'broken' :
    statuses.includes('warning') ? 'warning' : 'ok';

  // Skriv systemhendelse hvis noe er brutt (maks én per time)
  if (overallStatus !== 'ok') {
    const brudteMetrics = Object.entries(metrics)
      .filter(([, m]) => m.status !== 'ok')
      .map(([k, m]) => `${k}: ${m.status} (${m.label})`)
      .join('; ');

    await logSystemEvent({
      source: 'ai_learning_health',
      event_type: 'AI_LEARNING_HEALTH_DEGRADED',
      title: `AI-læringsystem: ${overallStatus}`,
      severity: overallStatus === 'broken' ? 'error' : 'warning',
      description: brudteMetrics,
      metadata: { status: overallStatus, metrics: Object.fromEntries(Object.entries(metrics).map(([k, m]) => [k, m.status])) },
    });
  }

  return NextResponse.json({
    status: overallStatus,
    metrics,
    summary: {
      ok:      statuses.filter(s => s === 'ok').length,
      warning: statuses.filter(s => s === 'warning').length,
      broken:  statuses.filter(s => s === 'broken').length,
    },
    ts: new Date().toISOString(),
  });
}
