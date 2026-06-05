import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ totaleVods: 0, totaleHighlights: 0 });

  const wsId = getWorkspaceId();
  const nå = new Date();
  const iDag = new Date(nå.getFullYear(), nå.getMonth(), nå.getDate()).toISOString();
  const ukeStart = new Date(nå.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [vodsRes, highlightsRes, logsRes, dagRes, ukesRes] = await Promise.all([
    db.from('content_vods').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'COMPLETE'),
    db.from('content_highlights').select('score,category').eq('vod_id', 'any' as any),
    db.from('content_pipeline_logs').select('cost_estimate,duration_ms,created_at'),
    db.from('content_pipeline_logs').select('cost_estimate').gte('created_at', iDag),
    db.from('content_pipeline_logs').select('cost_estimate').gte('created_at', ukeStart),
  ]);

  // Alle highlights
  const alleHighlightsRes = await db.from('content_highlights').select('score,category');
  const alleHighlights = alleHighlightsRes.data ?? [];
  const totaleHighlights = alleHighlights.length;
  const gjennomsnittsScore = totaleHighlights > 0
    ? Math.round(alleHighlights.reduce((s, h) => s + (h.score ?? 0), 0) / totaleHighlights)
    : 0;

  // Kategori-fordeling
  const katMap = new Map<string, number>();
  for (const h of alleHighlights) {
    if (h.category) katMap.set(h.category, (katMap.get(h.category) ?? 0) + 1);
  }
  const kategorier = Array.from(katMap.entries())
    .map(([kategori, antall]) => ({ kategori, antall }))
    .sort((a, b) => b.antall - a.antall);
  const mestBrukteKategori = kategorier[0]?.kategori ?? '–';

  // Kostnader
  const logs = logsRes.data ?? [];
  const totalKostnad = logs.reduce((s, l) => s + (l.cost_estimate ?? 0), 0);
  const dagensKostnad = (dagRes.data ?? []).reduce((s: number, l: any) => s + (l.cost_estimate ?? 0), 0);
  const ukensKostnad = (ukesRes.data ?? []).reduce((s: number, l: any) => s + (l.cost_estimate ?? 0), 0);

  // Gjennomsnittlig kjøretid per VOD
  const kjøretider = logs.filter(l => l.duration_ms).map(l => l.duration_ms ?? 0);
  const gjennomsnittsKjøretid = kjøretider.length > 0
    ? kjøretider.reduce((s, v) => s + v, 0) / kjøretider.length
    : 0;

  return NextResponse.json({
    totaleVods: vodsRes.count ?? 0,
    totaleHighlights,
    gjennomsnittsScore,
    mestBrukteKategori,
    gjennomsnittsKjøretid,
    totalKostnad,
    dagensKostnad,
    ukensKostnad,
    kategorier,
    sisteUkeStat: [],
  });
}
