/**
 * Backfill av stream_history fra ai_agent_events / system_events.
 *
 * GET  → dry-run: viser hvilke streams som ville blitt opprettet, uten å skrive noe.
 * POST → kjører backfillen. Trygt å kjøre flere ganger: hopper over stream_id som
 *        allerede finnes i stream_history (ingen duplikater), sletter aldri noe,
 *        og lar Postgres generere stream_history.id (UUID) — stream_id-kolonnen
 *        får Twitch sin stream-id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RawEvent {
  event_type: string;
  metadata: any;
  created_at: string;
}

async function loadGroups(db: NonNullable<ReturnType<typeof getDb>>, workspaceId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();

  const [agentEventsRes, systemEventsRes, existingRes] = await Promise.all([
    db.from('ai_agent_events')
      .select('event_type, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['AUDIENCE_SESSION_COMPLETE', 'RETENTION_CURVE', 'stream_offline'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(2000),
    db.from('system_events')
      .select('event_type, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['AUDIENCE_TRACKING_STARTED', 'AUDIENCE_TRACKING_STOPPED'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(2000),
    db.from('stream_history')
      .select('stream_id')
      .eq('workspace_id', workspaceId)
      .not('stream_id', 'is', null),
  ]);

  const agentEvents = (agentEventsRes.data ?? []) as RawEvent[];
  const systemEvts = (systemEventsRes.data ?? []) as RawEvent[];
  const existingStreamIds = new Set((existingRes.data ?? []).map((r: any) => r.stream_id));

  // ai_agent_events bruker snake_case metadata.stream_id
  const groups = new Map<string, RawEvent[]>();
  for (const e of agentEvents) {
    const sid = (e.metadata as any)?.stream_id;
    if (!sid) continue;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push(e);
  }

  // system_events bruker camelCase metadata.streamId
  const startedByStream = new Map<string, any>();
  const stoppedByStream = new Map<string, any>();
  for (const e of systemEvts) {
    const sid = (e.metadata as any)?.streamId;
    if (!sid) continue;
    if (e.event_type === 'AUDIENCE_TRACKING_STARTED') startedByStream.set(sid, { ...e.metadata, created_at: e.created_at });
    if (e.event_type === 'AUDIENCE_TRACKING_STOPPED') stoppedByStream.set(sid, { ...e.metadata, created_at: e.created_at });
  }

  return { groups, startedByStream, stoppedByStream, existingStreamIds };
}

function buildRow(streamId: string, group: RawEvent[], startedMeta: any, stoppedMeta: any, workspaceId: string) {
  // Bruk SISTE AUDIENCE_SESSION_COMPLETE (heartbeat-writes er preliminary, stream-end-write er final).
  // [...group].reverse() er trygt siden vi ikke muterer originalen.
  const sessionComplete = [...group].reverse().find(e => e.event_type === 'AUDIENCE_SESSION_COMPLETE');
  const retention = group.find(e => e.event_type === 'RETENTION_CURVE');
  const offline = group.find(e => e.event_type === 'stream_offline');

  const meta = (sessionComplete?.metadata ?? {}) as any;
  const retentionMeta = (retention?.metadata ?? {}) as any;
  const snapshots: Array<{ ts: string; count: number }> = retentionMeta.snapshots ?? [];

  const startedAt = startedMeta?.created_at ?? snapshots[0]?.ts ?? group[0]?.created_at;
  const endedAt = stoppedMeta?.created_at ?? offline?.created_at ?? sessionComplete?.created_at ?? group[group.length - 1]?.created_at;

  const durationMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));
  const peak = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.count)) : (meta.total ?? 0);
  const avg = snapshots.length > 0 ? Math.round(snapshots.reduce((sum, s) => sum + s.count, 0) / snapshots.length) : (meta.total ?? 0);
  const chatMessages = Array.isArray(meta.viewers)
    ? meta.viewers.reduce((sum: number, v: any) => sum + (v.messagesSent ?? v.messages_sent ?? 0), 0)
    : 0;

  return {
    workspace_id: workspaceId,
    stream_id: streamId,
    title: startedMeta?.title ?? '',
    game: startedMeta?.game ?? '',
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: durationMinutes,
    peak_viewers: peak,
    avg_viewers: avg,
    chat_messages: chatMessages,
    followers_gained: 0,
    subs_gained: meta.subscribers ?? 0,
    raids_during: 0,
  };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB ikke tilkoblet' }, { status: 500 });

  const workspaceId = getWorkspaceId();
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') ?? '90');

  try {
    const { groups, startedByStream, stoppedByStream, existingStreamIds } = await loadGroups(db, workspaceId, days);

    const wouldInsert: any[] = [];
    const wouldSkip: string[] = [];
    for (const [streamId, group] of Array.from(groups.entries())) {
      if (existingStreamIds.has(streamId)) {
        wouldSkip.push(streamId);
        continue;
      }
      wouldInsert.push(buildRow(streamId, group, startedByStream.get(streamId), stoppedByStream.get(streamId), workspaceId));
    }

    return NextResponse.json({
      workspaceId,
      windowDays: days,
      groupsFoundInEvents: groups.size,
      alreadyInStreamHistory: existingStreamIds.size,
      wouldInsert,
      wouldSkip,
      instructions: 'POST til dette endepunktet for å faktisk skrive disse radene til stream_history.',
    });
  } catch (err: any) {
    console.error('[backfill/stream-history-from-events] dry-run failed:', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Ukjent feil under dry-run' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB ikke tilkoblet' }, { status: 500 });

  const workspaceId = getWorkspaceId();
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') ?? '90');

  try {
    const { groups, startedByStream, stoppedByStream, existingStreamIds } = await loadGroups(db, workspaceId, days);

    const inserted: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ streamId: string; error: string }> = [];

    for (const [streamId, group] of Array.from(groups.entries())) {
      if (existingStreamIds.has(streamId)) {
        skipped.push(streamId);
        continue;
      }

      const row = buildRow(streamId, group, startedByStream.get(streamId), stoppedByStream.get(streamId), workspaceId);
      const { error } = await db.from('stream_history').upsert(row, { onConflict: 'stream_id' });

      if (error) {
        failed.push({ streamId, error: error.message });
        void db.from('system_events').insert({
          workspace_id: workspaceId,
          source: 'stream_coach_backfill',
          event_type: 'STREAM_HISTORY_BACKFILL_FAILED',
          title: `Backfill feilet for stream ${streamId}: ${error.message.slice(0, 100)}`,
          severity: 'error',
          metadata: { workspaceId, streamId, error: error.message },
        });
      } else {
        inserted.push(streamId);
        void db.from('system_events').insert({
          workspace_id: workspaceId,
          source: 'stream_coach_backfill',
          event_type: 'STREAM_HISTORY_BACKFILLED',
          title: `Backfilled stream_history for stream ${streamId}`,
          severity: 'info',
          metadata: { workspaceId, streamId },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      workspaceId,
      windowDays: days,
      groupsFoundInEvents: groups.size,
      alreadyInStreamHistory: existingStreamIds.size,
      inserted,
      skipped,
      failed,
    });
  } catch (err: any) {
    console.error('[backfill/stream-history-from-events] POST failed:', err);
    void db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'stream_coach_backfill',
      event_type: 'STREAM_HISTORY_BACKFILL_FAILED',
      title: `Backfill kastet exception: ${err?.message?.slice(0, 150) ?? 'ukjent feil'}`,
      severity: 'error',
      metadata: { workspaceId, error: err?.message, stack: err?.stack?.slice(0, 2000) },
    });
    return NextResponse.json({ ok: false, error: err?.message ?? 'Ukjent feil under backfill' }, { status: 500 });
  }
}
