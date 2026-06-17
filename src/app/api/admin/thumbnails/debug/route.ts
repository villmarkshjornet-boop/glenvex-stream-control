import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const highlightId = req.nextUrl.searchParams.get('highlightId');
  if (!highlightId) {
    return NextResponse.json({ error: 'highlightId param required' }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB not connected' }, { status: 500 });

  // 1. DB row
  const { data: row, error: rowErr } = await db
    .from('content_highlights')
    .select('id,thumbnail_status,thumbnail_youtube_url,thumbnail_error,thumbnail_headline,thumbnail_ctr_reason,thumbnail_generated_at,thumbnail_reject_count,thumbnail_started_at')
    .eq('id', highlightId)
    .single();

  if (rowErr || !row) {
    return NextResponse.json({ error: `Highlight ikke funnet: ${rowErr?.message}` }, { status: 404 });
  }

  // 2. Latest V7 system_events for this highlight
  const { data: events } = await db
    .from('system_events')
    .select('event_type,title,metadata,created_at')
    .or(`metadata->>highlightId.eq.${highlightId}`)
    .in('event_type', [
      'THUMBNAIL_V7_START', 'THUMBNAIL_V7_RENDER_COMPLETE', 'THUMBNAIL_V7_FAILED',
      'THUMBNAIL_V7_TEXT_TEST', 'THUMBNAIL_V7_HOOK_SELECTED',
    ])
    .order('created_at', { ascending: false })
    .limit(10);

  const latestV7Event = events?.[0] ?? null;
  const doneEvent = events?.find(e => e.event_type === 'THUMBNAIL_V7_RENDER_COMPLETE');
  const latestDoneUrl = (doneEvent?.metadata as any)?.thumbnailUrl ?? null;

  // 3. Derive version and source from thumbnail_ctr_reason (format: "V7 · hook:xxx · font:xxx")
  const ctrReason: string = row.thumbnail_ctr_reason ?? '';
  const thumbnailVersion = ctrReason.startsWith('V7') ? 'V7' : (ctrReason.startsWith('V6') ? 'V6' : null);
  const thumbnailSource  = (latestV7Event?.metadata as any)?.source ?? null;

  // 4. Check if public URL is reachable and get image bytes
  let publicUrlReachable = false;
  let imageBytes: number | null = null;

  const urlToCheck = row.thumbnail_youtube_url ?? latestDoneUrl;
  if (urlToCheck) {
    try {
      const headRes = await fetch(urlToCheck, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8_000),
      });
      publicUrlReachable = headRes.ok;
      const cl = headRes.headers.get('content-length');
      if (cl) imageBytes = parseInt(cl, 10);
    } catch {}
  }

  // Derive frontend expected behaviour
  const thumbnailStatus = row.thumbnail_status;
  const hasUrl = !!row.thumbnail_youtube_url;
  const frontendExpectedStatus =
    thumbnailStatus === 'DONE'       ? 'COMPLETE' :
    thumbnailStatus === 'GENERATING' ? 'GENERATING (poller active)' :
    thumbnailStatus === 'PENDING'    ? 'PENDING (in queue)' :
    thumbnailStatus === 'FAILED'     ? 'FAILED' :
    thumbnailStatus ?? 'NOT_STARTED';

  const frontendShouldShowPreview = hasUrl && publicUrlReachable;

  return NextResponse.json({
    highlightId,
    thumbnail_status:          thumbnailStatus,
    thumbnail_youtube_url:     row.thumbnail_youtube_url,
    thumbnail_error:           row.thumbnail_error,
    thumbnail_version:         thumbnailVersion,
    thumbnail_source:          thumbnailSource,
    thumbnail_generated_at:    row.thumbnail_generated_at,
    thumbnail_started_at:      row.thumbnail_started_at,
    thumbnail_headline:        row.thumbnail_headline,
    thumbnail_ctr_reason:      row.thumbnail_ctr_reason,
    latest_v7_event:           latestV7Event ? {
      event_type: latestV7Event.event_type,
      title:      latestV7Event.title,
      created_at: latestV7Event.created_at,
    } : null,
    latest_done_url:           latestDoneUrl,
    db_matches_latest_done_url: latestDoneUrl ? row.thumbnail_youtube_url === latestDoneUrl : null,
    public_url_reachable:      publicUrlReachable,
    image_bytes:               imageBytes,
    frontend_expected_status:  frontendExpectedStatus,
    frontend_should_show_preview: frontendShouldShowPreview,
  });
}
