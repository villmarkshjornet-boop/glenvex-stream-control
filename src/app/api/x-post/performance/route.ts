/**
 * POST /api/x-post/performance
 *
 * Records 5-minute or 10-minute viewer count after an X post was sent.
 * Called by the dashboard component via timers after mark-posted.
 *
 * Body: { post_id: string, type: '5min' | '10min', viewer_count: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB utilgjengelig' }, { status: 503 });

  const ws = getWorkspaceId();

  let body: { post_id?: string; type?: '5min' | '10min'; viewer_count?: number };
  try { body = await req.json() as typeof body; }
  catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }); }

  const { post_id, type, viewer_count = 0 } = body;
  if (!post_id || !type) return NextResponse.json({ error: 'post_id og type er påkrevd' }, { status: 400 });

  // Fetch the row to compute delta
  const { data: row } = await db
    .from('x_post_memory')
    .select('viewer_count_before,viewer_count_5min,viewer_count_10min,posted_at,game,post_text')
    .eq('id', post_id)
    .eq('workspace_id', ws)
    .single();

  if (!row) return NextResponse.json({ error: 'Fant ikke X-post rad' }, { status: 404 });

  const before = row.viewer_count_before ?? 0;
  const delta  = viewer_count - before;

  if (type === '5min') {
    const { error } = await db
      .from('x_post_memory')
      .update({
        viewer_count_5min:  viewer_count,
        viewer_delta_5min:  delta,
        perf_5min_at:       new Date().toISOString(),
      })
      .eq('id', post_id)
      .eq('workspace_id', ws);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logSystemEvent({
      source: 'x_post_agent', event_type: 'X_POST_PERFORMANCE_5MIN',
      title: `X-post +5 min: ${delta >= 0 ? '+' : ''}${delta} seere (${before} → ${viewer_count})`,
      severity: 'info',
      metadata: { post_id, before, after_5min: viewer_count, delta_5min: delta, game: row.game },
    });

  } else {
    const { error } = await db
      .from('x_post_memory')
      .update({
        viewer_count_10min: viewer_count,
        viewer_delta_10min: delta,
        perf_10min_at:      new Date().toISOString(),
      })
      .eq('id', post_id)
      .eq('workspace_id', ws);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logSystemEvent({
      source: 'x_post_agent', event_type: 'X_POST_PERFORMANCE_10MIN',
      title: `X-post +10 min: ${delta >= 0 ? '+' : ''}${delta} seere (${before} → ${viewer_count})`,
      severity: delta >= 2 ? 'info' : 'info',
      metadata: {
        post_id, before,
        after_5min:  row.viewer_count_5min,
        after_10min: viewer_count,
        delta_5min:  row.viewer_count_5min != null ? (row.viewer_count_5min - before) : null,
        delta_10min: delta,
        game:        row.game,
        hook:        (row.post_text ?? '').slice(0, 80),
        verdict:     delta >= 3 ? 'strong_uplift' : delta >= 1 ? 'slight_uplift' : delta === 0 ? 'no_change' : 'decline',
      },
    });
  }

  return NextResponse.json({ ok: true, type, delta, viewer_count });
}
