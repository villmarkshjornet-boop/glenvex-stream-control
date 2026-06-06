import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export async function lagreStreamMemory(
  vodId: string,
  data: {
    streamTitle?: string;
    game?: string;
    streamedAt?: string;
    durationSeconds?: number;
    highlightsCount?: number;
    topCategories?: string[];
    summary?: string;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.from('ai_producer_stream_memory').upsert(
    {
      workspace_id: getWorkspaceId(),
      vod_id: vodId,
      stream_title: data.streamTitle ?? null,
      game: data.game ?? null,
      streamed_at: data.streamedAt ?? new Date().toISOString(),
      duration_seconds: data.durationSeconds ?? null,
      highlights_count: data.highlightsCount ?? 0,
      top_categories: data.topCategories ?? [],
      summary: data.summary ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'vod_id' }
  );
}

export async function oppdaterContentPatterns(
  highlights: Array<{ category: string; score: number }>
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const workspaceId = getWorkspaceId();

  const kategorier: Record<string, number[]> = {};
  for (const h of highlights) {
    if (!kategorier[h.category]) kategorier[h.category] = [];
    kategorier[h.category].push(h.score);
  }

  for (const [category, scores] of Object.entries(kategorier)) {
    const sumScore = scores.reduce((a, b) => a + b, 0);
    const { data: existing } = await db
      .from('ai_producer_content_memory')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('category', category)
      .single();

    if (existing) {
      const newCount = existing.occurrence_count + scores.length;
      const newAvg = (existing.avg_score * existing.occurrence_count + sumScore) / newCount;
      await db
        .from('ai_producer_content_memory')
        .update({
          avg_score: Math.round(newAvg * 10) / 10,
          occurrence_count: newCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await db.from('ai_producer_content_memory').insert({
        workspace_id: workspaceId,
        category,
        avg_score: Math.round((sumScore / scores.length) * 10) / 10,
        occurrence_count: scores.length,
        updated_at: new Date().toISOString(),
      });
    }
  }
}
