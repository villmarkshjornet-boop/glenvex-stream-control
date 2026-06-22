/**
 * POST /api/x-post/mark-posted
 *
 * Records that a user manually posted an X post.
 * Stores viewer_count_before and posted_at so performance can be tracked later.
 *
 * Body: { post_id: string, viewer_count: number }
 * Returns: { ok: true, post_id, posted_at }
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

  let body: { post_id?: string; viewer_count?: number };
  try { body = await req.json() as typeof body; }
  catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }); }

  const { post_id, viewer_count = 0 } = body;
  if (!post_id) return NextResponse.json({ error: 'post_id er påkrevd' }, { status: 400 });

  const postedAt = new Date().toISOString();

  const { error } = await db
    .from('x_post_memory')
    .update({
      status:               'posted',
      posted_at:            postedAt,
      viewer_count_before:  viewer_count,
    })
    .eq('id', post_id)
    .eq('workspace_id', ws);

  if (error) return NextResponse.json({ error: `DB feil: ${error.message}` }, { status: 500 });

  await logSystemEvent({
    source: 'x_post_agent', event_type: 'X_POST_MARKED_POSTED',
    title: `X-post markert som postet (${viewer_count} seere nå)`,
    severity: 'info',
    metadata: { post_id, viewer_count_before: viewer_count, posted_at: postedAt },
  });

  return NextResponse.json({ ok: true, post_id, posted_at: postedAt });
}
