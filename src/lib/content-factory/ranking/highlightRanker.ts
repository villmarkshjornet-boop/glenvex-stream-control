import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { hentHighlights } from '../analysis/highlightDiscovery';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ContentHighlight } from '../types';

export async function rangerHighlights(vodId: string): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  await logPipeline({ vodId, step: 'RANK', status: 'STARTED' });

  const highlights = await hentHighlights(vodId);
  if (highlights.length === 0) return [];

  // Sorter etter score, tildel rank
  const rangert = highlights.sort((a, b) => b.score - a.score);

  for (let i = 0; i < rangert.length; i++) {
    await db.from('content_highlights')
      .update({ rank: i + 1 })
      .eq('id', rangert[i].id);
    rangert[i].rank = i + 1;
  }

  await logPipeline({ vodId, step: 'RANK', status: 'COMPLETE', outputCount: rangert.length });

  return rangert;
}

export async function hentToppHighlights(vodId: string, antall = 10): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_highlights').select('*')
    .eq('vod_id', vodId).not('rank', 'is', null)
    .order('rank', { ascending: true }).limit(antall);
  return (data ?? []).map(r => ({
    id: r.id, vodId: r.vod_id, startTime: r.start_time, endTime: r.end_time,
    score: r.score, category: r.category, title: r.title,
    begrunnelse: r.begrunnelse, signals: r.signals ?? [], rank: r.rank, status: r.status,
  }));
}
