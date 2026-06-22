/**
 * POST /api/backfill/stream-history-from-twitch
 *
 * Fetches recent archived VODs from Twitch and patches stream_history rows
 * that have missing/zero data (duration_minutes = 0 or 3).
 * Matches on stream_id (Twitch live stream ID is stored on both VOD and stream_history).
 *
 * GET → dry-run: shows what would be updated without writing anything.
 * POST → applies the patches.
 *
 * Only updates title and duration_minutes — viewer stats that the bot failed
 * to capture cannot be recovered from the Twitch API.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getBroadcasterId, getRecentVods } from '@/lib/twitch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(dryRun: boolean) {
  const db = getDb();
  const ws = getWorkspaceId();

  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 503 });

  const broadcasterId = await getBroadcasterId();
  if (!broadcasterId) return NextResponse.json({ error: 'Klarte ikke hente broadcaster_id fra Twitch' }, { status: 500 });

  const vods = await getRecentVods(broadcasterId, 10);
  if (!vods.length) return NextResponse.json({ error: 'Ingen VODs funnet fra Twitch' }, { status: 404 });

  // Load existing stream_history rows for this workspace
  const { data: rows } = await db
    .from('stream_history')
    .select('id, stream_id, title, duration_minutes, peak_viewers')
    .eq('workspace_id', ws)
    .order('started_at', { ascending: false })
    .limit(20);

  const historyMap = new Map<string, any>();
  for (const row of (rows ?? [])) {
    if (row.stream_id) historyMap.set(row.stream_id, row);
  }

  const patches: Array<{ stream_id: string; title: string; durationMinutes: number; old_duration: number }> = [];
  const skipped: Array<{ stream_id: string; reason: string }> = [];

  for (const vod of vods) {
    if (!vod.streamId) { skipped.push({ stream_id: vod.vodId, reason: 'VOD mangler stream_id' }); continue; }
    const row = historyMap.get(vod.streamId);
    if (!row) { skipped.push({ stream_id: vod.streamId, reason: 'Ingen stream_history-rad med denne stream_id' }); continue; }
    // Only patch rows with clearly broken/missing data (duration ≤ 5 min or title mismatch)
    const needsDurationFix = (row.duration_minutes ?? 0) <= 5 && vod.durationMinutes > 5;
    const needsTitleFix = !row.title && vod.title;
    if (!needsDurationFix && !needsTitleFix) {
      skipped.push({ stream_id: vod.streamId, reason: `Data ser OK ut (varighet: ${row.duration_minutes}min)` });
      continue;
    }
    patches.push({ stream_id: vod.streamId, title: vod.title, durationMinutes: vod.durationMinutes, old_duration: row.duration_minutes ?? 0 });
  }

  if (dryRun) {
    return NextResponse.json({ dryRun: true, wouldPatch: patches, skipped, vodsFromTwitch: vods.length });
  }

  const results: any[] = [];
  for (const p of patches) {
    const { error } = await db
      .from('stream_history')
      .update({ title: p.title, duration_minutes: p.durationMinutes })
      .eq('workspace_id', ws)
      .eq('stream_id', p.stream_id);
    results.push({ stream_id: p.stream_id, ok: !error, error: error?.message });
  }

  return NextResponse.json({ patched: results.length, results, skipped });
}

export async function GET() { return run(true); }
export async function POST() { return run(false); }
