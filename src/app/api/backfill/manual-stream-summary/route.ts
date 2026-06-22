/**
 * POST /api/backfill/manual-stream-summary
 *
 * Manual patch for a single stream_history row from official Twitch email summary data.
 * Used when the bot crashed and didn't capture live stats.
 *
 * Body: { stream_id, unique_viewers, peak_viewers, avg_viewers, unique_chatters,
 *         followers_gained, source }
 *
 * ?dryRun=true → shows before/after without writing anything.
 *
 * Auth: session cookie (browser) or ?secret=CRON_SECRET (curl).
 *
 * Side effects (non-dry):
 *   1. UPDATE stream_history: peak_viewers, avg_viewers, followers_gained
 *   2. INSERT ai_agent_events AUDIENCE_SESSION_COMPLETE — lets dashboard show unique chatters
 *   3. INSERT system_events STREAM_HISTORY_MANUAL_BACKFILL — audit trail
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

interface Body {
  stream_id?: string;
  use_latest?: boolean;
  unique_viewers: number;
  peak_viewers: number;
  avg_viewers: number;
  unique_chatters: number;
  followers_gained: number;
  duration_minutes?: number;
  source?: string;
}

function checkAuth(req: NextRequest): boolean {
  if (req.headers.get('x-workspace-id')) return true;
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
  return !!(process.env.CRON_SECRET && secret === process.env.CRON_SECRET);
}

function validate(b: Body): string | null {
  if (!b.stream_id?.trim() && !b.use_latest) return 'Enten stream_id eller use_latest:true er påkrevd';
  for (const k of ['unique_viewers','peak_viewers','avg_viewers','unique_chatters','followers_gained'] as const) {
    if (typeof b[k] !== 'number' || b[k] < 0 || !Number.isInteger(b[k])) return `${k} må være et ikke-negativt heltall`;
  }
  if (b.peak_viewers > b.unique_viewers) return 'peak_viewers kan ikke overstige unique_viewers';
  if (b.avg_viewers  > b.peak_viewers)   return 'avg_viewers kan ikke overstige peak_viewers';
  if (b.unique_chatters > b.unique_viewers) return 'unique_chatters kan ikke overstige unique_viewers';
  return null;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true';

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }); }

  const validationError = validate(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 503 });

  const ws = getWorkspaceId();
  const { unique_viewers, peak_viewers, avg_viewers, unique_chatters, followers_gained, duration_minutes } = body;
  const source = body.source ?? 'manual';

  // ── Find the row ─────────────────────────────────────────────────────────────
  let query = db
    .from('stream_history')
    .select('id, stream_id, title, game, duration_minutes, peak_viewers, avg_viewers, followers_gained, chat_messages, started_at, ended_at')
    .eq('workspace_id', ws)
    .order('ended_at', { ascending: false })
    .limit(1);

  if (!body.use_latest && body.stream_id?.trim()) {
    query = db
      .from('stream_history')
      .select('id, stream_id, title, game, duration_minutes, peak_viewers, avg_viewers, followers_gained, chat_messages, started_at, ended_at')
      .eq('workspace_id', ws)
      .eq('stream_id', body.stream_id.trim())
      .limit(1);
  }

  const { data: rows, error: fetchErr } = await query;

  if (fetchErr) return NextResponse.json({ error: `DB-feil ved oppslag: ${fetchErr.message}` }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: body.use_latest ? 'Ingen stream_history-rader funnet for denne workspace' : `Ingen stream_history-rad funnet for stream_id: ${body.stream_id}` }, { status: 404 });

  const row = rows[0];
  const stream_id = row.stream_id ?? body.stream_id ?? 'unknown';

  const before = {
    peak_viewers:     row.peak_viewers     ?? 0,
    avg_viewers:      row.avg_viewers      ?? 0,
    followers_gained: row.followers_gained ?? 0,
    chat_messages:    row.chat_messages    ?? 0,
    duration_minutes: row.duration_minutes ?? 0,
  };

  const historyUpdate: Record<string, number> = { peak_viewers, avg_viewers, followers_gained };
  if (duration_minutes !== undefined) historyUpdate.duration_minutes = duration_minutes;

  const diff: Record<string, unknown> = {
    peak_viewers:     { before: before.peak_viewers,     after: peak_viewers },
    avg_viewers:      { before: before.avg_viewers,      after: avg_viewers },
    followers_gained: { before: before.followers_gained, after: followers_gained },
    unique_chatters:  { before: 'ukjent (fra ai_agent_events)', after: unique_chatters, note: 'Skrives til ai_agent_events som AUDIENCE_SESSION_COMPLETE' },
    unique_viewers:   { before: 'ukjent', after: unique_viewers, note: 'Ingen kolonne i stream_history — lagres kun i system_events metadata' },
  };
  if (duration_minutes !== undefined) {
    diff.duration_minutes = { before: before.duration_minutes, after: duration_minutes };
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      stream_id,
      row: { title: row.title, started_at: row.started_at, duration_minutes: row.duration_minutes },
      changes: diff,
      wouldWrite: ['stream_history', 'ai_agent_events (AUDIENCE_SESSION_COMPLETE)', 'system_events (STREAM_HISTORY_MANUAL_BACKFILL)'],
    });
  }

  // ── 1. Oppdater stream_history — matcher på UUID (row.id) for å unngå null stream_id-problemer ──
  const { error: updateErr } = await db
    .from('stream_history')
    .update(historyUpdate)
    .eq('id', row.id);

  if (updateErr) return NextResponse.json({ error: `Kunne ikke oppdatere stream_history: ${updateErr.message}` }, { status: 500 });

  // ── 2. Skriv AUDIENCE_SESSION_COMPLETE → dashboard leser uniqueChatters herfra ─
  try {
    await db.from('ai_agent_events').insert({
      workspace_id:      ws,
      source:            'twitch',
      event_type:        'AUDIENCE_SESSION_COMPLETE',
      importance_score:  80,
      metadata: {
        stream_id,
        total:             unique_chatters,
        viewers:           [],
        new_viewers:       0,
        returning_viewers: 0,
        backfill_source:   source,
        unique_viewers,
        note: 'Manuelt backfill fra Twitch email summary',
      },
    });
  } catch {}

  // ── 3. Audit trail i system_events ──────────────────────────────────────────
  try {
    await db.from('system_events').insert({
      workspace_id: ws,
      source:       'backfill',
      event_type:   'STREAM_HISTORY_MANUAL_BACKFILL',
      title:        `Manuelt backfill av stream-statistikk: ${row.title ?? stream_id}`,
      severity:     'info',
      metadata: {
        stream_id,
        source,
        before,
        after: { ...historyUpdate, unique_viewers, unique_chatters },
      },
    });
  } catch {}

  return NextResponse.json({
    ok:      true,
    dryRun:  false,
    stream_id,
    row:     { title: row.title, started_at: row.started_at, duration_minutes: row.duration_minutes },
    changes: diff,
    written: ['stream_history', 'ai_agent_events (AUDIENCE_SESSION_COMPLETE)', 'system_events (STREAM_HISTORY_MANUAL_BACKFILL)'],
  });
}
