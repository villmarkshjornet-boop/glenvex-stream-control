import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const workspaceId = getWorkspaceId();

  const { data: vods } = await db
    .from('content_vods')
    .select('id, title, category, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'COMPLETE')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!vods?.length) {
    return NextResponse.json({ ok: true, processed: 0, alreadyDone: 0, toProcess: 0, message: 'Ingen COMPLETE VODer funnet' });
  }

  const { data: existingMemory } = await db
    .from('ai_agent_memory')
    .select('key')
    .eq('workspace_id', workspaceId)
    .eq('memory_type', 'stream_pattern')
    .neq('key', 'channel_profile');

  const processedVodIds = new Set((existingMemory ?? []).map((m: any) => m.key as string));
  const toProcess = vods.filter(v => !processedVodIds.has(v.id));

  let processed = 0;
  let failed = 0;
  const results: { vodId: string; title: string; status: 'ok' | 'failed' | 'skipped'; reason?: string }[] = [];

  const { kjørLearningLoop } = await import('@/lib/content-factory/ai-producer/learningLoop');

  for (const vod of toProcess) {
    try {
      await kjørLearningLoop(vod.id);

      const { data: written } = await db
        .from('ai_agent_memory')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('memory_type', 'stream_pattern')
        .eq('key', vod.id)
        .single();

      if (written) {
        processed++;
        results.push({ vodId: vod.id, title: vod.title ?? vod.id, status: 'ok' });
      } else {
        results.push({ vodId: vod.id, title: vod.title ?? vod.id, status: 'skipped', reason: 'Ingen highlights eller transkripsjon funnet' });
      }
    } catch (err: any) {
      failed++;
      results.push({ vodId: vod.id, title: vod.title ?? vod.id, status: 'failed', reason: err?.message?.slice(0, 100) });
    }
  }

  await logSystemEvent({
    source: 'ai_memory',
    event_type: 'AI_MEMORY_BACKFILL_DONE',
    title: `AI Memory backfill: ${processed} streams analysert, ${failed} feilet`,
    severity: processed > 0 ? 'info' : 'warning',
    metadata: { processed, failed, alreadyDone: processedVodIds.size, toProcess: toProcess.length, workspaceId },
  });

  return NextResponse.json({
    ok: true,
    processed,
    failed,
    alreadyDone: processedVodIds.size,
    toProcess: toProcess.length,
    results,
  });
}
