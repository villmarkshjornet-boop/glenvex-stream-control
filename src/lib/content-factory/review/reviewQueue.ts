import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ReviewQueueItem, ReviewStatus } from '../types';

export async function leggIReviewKø(
  vodId: string,
  items: { highlightId?: string; assetId?: string; type: string }[]
): Promise<ReviewQueueItem[]> {
  assertContentFactoryEnabled();

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  await logPipeline({ vodId, step: 'QUEUE', status: 'STARTED', outputCount: items.length });

  const result: ReviewQueueItem[] = [];

  for (const item of items) {
    const { data } = await db.from('content_review_queue').insert({
      vod_id: vodId,
      highlight_id: item.highlightId ?? null,
      asset_id: item.assetId ?? null,
      type: item.type,
      status: 'PENDING' as ReviewStatus,
    }).select().single();

    if (data) {
      result.push({
        id: data.id, vodId, highlightId: data.highlight_id,
        assetId: data.asset_id, type: data.type, status: 'PENDING',
      });
    }
  }

  await logPipeline({ vodId, step: 'QUEUE', status: 'COMPLETE', outputCount: result.length });
  return result;
}

export async function hentReviewKø(
  filter?: { status?: ReviewStatus; vodId?: string }
): Promise<ReviewQueueItem[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];

  let q = db.from('content_review_queue').select('*');
  if (filter?.status) q = q.eq('status', filter.status);
  if (filter?.vodId) q = q.eq('vod_id', filter.vodId);

  const { data } = await q.order('created_at', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id, vodId: r.vod_id, highlightId: r.highlight_id,
    assetId: r.asset_id, type: r.type, status: r.status, notes: r.notes,
  }));
}

export async function godkjenn(id: string, notes?: string): Promise<void> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return;
  await db.from('content_review_queue').update({
    status: 'APPROVED' as ReviewStatus,
    notes,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
}

export async function avvis(id: string, notes?: string): Promise<void> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return;
  await db.from('content_review_queue').update({
    status: 'REJECTED' as ReviewStatus,
    notes,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
}
