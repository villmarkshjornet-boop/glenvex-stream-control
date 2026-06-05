import { getDb } from '@/lib/db';
import type { PipelineLog } from '../types';

export async function logPipeline(log: PipelineLog): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('content_pipeline_logs').insert({
      vod_id: log.vodId || null,
      step: log.step,
      status: log.status,
      message: log.message,
      duration_ms: log.durationMs,
      cost_estimate: log.costEstimate,
      output_count: log.outputCount,
    });
  } catch {}
}

export async function hentPipelineLogs(vodId: string) {
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_pipeline_logs')
    .select('*')
    .eq('vod_id', vodId)
    .order('created_at', { ascending: true });
  return data ?? [];
}
