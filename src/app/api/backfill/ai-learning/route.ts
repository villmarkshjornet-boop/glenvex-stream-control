/**
 * POST /api/backfill/ai-learning
 * Backfiller historisk data fra stream_history, content_transcripts og content_highlights
 * til ai_agent_events slik at learningAggregator kan analysere dem retroaktivt.
 *
 * Kjøres én gang manuelt — trygt å kjøre flere ganger (sjekker duplikater via event_type+metadata match).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const ws = getWorkspaceId();
  const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const now = new Date().toISOString();

  const stats = {
    streamSessionsBackfilled: 0,
    highlightsBackfilled: 0,
    transcriptChunksBackfilled: 0,
    insightsGenerated: 0,
    errors: [] as string[],
  };

  // ── 1. stream_history → ai_agent_events ──────────────────────────────────────
  try {
    const { data: streams } = await db
      .from('stream_history')
      .select('*')
      .eq('workspace_id', ws)
      .gte('started_at', cutoff90d)
      .order('started_at', { ascending: false })
      .limit(50);

    for (const s of streams ?? []) {
      // Sjekk duplikat
      const { count } = await db
        .from('ai_agent_events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('event_type', 'stream_session_backfill')
        .contains('metadata', { stream_id: s.id });

      if ((count ?? 0) > 0) continue;

      const rows: any[] = [
        {
          workspace_id: ws,
          source: 'twitch',
          event_type: 'stream_session_backfill',
          username: null,
          message_text: `Stream: ${s.game ?? 'Ukjent'} — ${s.title ?? ''}. Snitt ${s.avg_viewers ?? 0} seere, peak ${s.peak_viewers ?? 0}, ${s.duration_minutes ?? 0} min.`,
          importance_score: Math.min(90, 40 + (s.peak_viewers ?? 0) / 10),
          created_at: s.started_at,
          metadata: {
            stream_id: s.id,
            game: s.game,
            title: s.title,
            avg_viewers: s.avg_viewers,
            peak_viewers: s.peak_viewers,
            duration_minutes: s.duration_minutes,
            subs_gained: s.subs_gained,
            raids_during: s.raids_during,
            backfilled: true,
          },
        },
      ];

      if ((s.subs_gained ?? 0) > 0) {
        rows.push({
          workspace_id: ws,
          source: 'twitch',
          event_type: 'subs_gained_backfill',
          message_text: `${s.subs_gained} subs under ${s.game ?? 'stream'}`,
          importance_score: 70,
          created_at: s.ended_at ?? s.started_at,
          metadata: { stream_id: s.id, count: s.subs_gained, game: s.game, backfilled: true },
        });
      }

      if ((s.raids_during ?? 0) > 0) {
        rows.push({
          workspace_id: ws,
          source: 'twitch',
          event_type: 'raid_received_backfill',
          message_text: `${s.raids_during} raid(s) under ${s.game ?? 'stream'}`,
          importance_score: 75,
          created_at: s.ended_at ?? s.started_at,
          metadata: { stream_id: s.id, count: s.raids_during, game: s.game, backfilled: true },
        });
      }

      const { error } = await db.from('ai_agent_events').insert(rows);
      if (error) {
        stats.errors.push(`stream ${s.id}: ${error.message}`);
      } else {
        stats.streamSessionsBackfilled++;
      }
    }
  } catch (err: any) {
    stats.errors.push(`stream_history: ${err.message?.slice(0, 100)}`);
  }

  // ── 2. content_highlights → ai_agent_events ───────────────────────────────────
  try {
    const { data: highlights } = await db
      .from('content_highlights')
      .select('id,vod_id,title,rank_score,clip_status,created_at')
      .gte('created_at', cutoff90d)
      .not('title', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    for (const h of highlights ?? []) {
      const { count } = await db
        .from('ai_agent_events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('event_type', 'highlight_backfill')
        .contains('metadata', { highlight_id: h.id });

      if ((count ?? 0) > 0) continue;

      const { error } = await db.from('ai_agent_events').insert({
        workspace_id: ws,
        source: 'content_factory',
        event_type: 'highlight_backfill',
        message_text: `Highlight: ${h.title?.slice(0, 200) ?? ''}`,
        importance_score: Math.min(85, 50 + (h.rank_score ?? 0) / 2),
        created_at: h.created_at,
        metadata: {
          highlight_id: h.id,
          vod_id: h.vod_id,
          title: h.title,
          rank_score: h.rank_score,
          clipped: h.clip_status === 'CLIPPED',
          backfilled: true,
        },
      });
      if (error) {
        stats.errors.push(`highlight ${h.id}: ${error.message}`);
      } else {
        stats.highlightsBackfilled++;
      }
    }
  } catch (err: any) {
    stats.errors.push(`content_highlights: ${err.message?.slice(0, 100)}`);
  }

  // ── 3. content_transcripts (samples) → ai_agent_events ────────────────────────
  // Tar max 5 segmenter per VOD for å ikke flomme AI med alle 300+
  try {
    const { data: vods } = await db
      .from('content_vods')
      .select('id,title,created_at')
      .eq('workspace_id', ws)
      .gte('created_at', cutoff90d)
      .order('created_at', { ascending: false })
      .limit(20);

    for (const vod of vods ?? []) {
      // Sjekk om vi allerede har backfill for denne VOD
      const { count: existing } = await db
        .from('ai_agent_events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('event_type', 'transcript_backfill')
        .contains('metadata', { vod_id: vod.id });

      if ((existing ?? 0) > 0) continue;

      // Hent 5 representative segmenter (start, midten, slutt)
      const { data: segs } = await db
        .from('content_transcripts')
        .select('text,start_time')
        .eq('vod_id', vod.id)
        .order('start_time', { ascending: true })
        .limit(5);

      if (!segs || segs.length === 0) continue;

      const kombinert = segs.map((s: any) => s.text).join(' ').slice(0, 500);

      const { error } = await db.from('ai_agent_events').insert({
        workspace_id: ws,
        source: 'content_factory',
        event_type: 'transcript_backfill',
        message_text: `VOD "${vod.title?.slice(0, 80) ?? ''}" transkripsjon: ${kombinert}`,
        importance_score: 55,
        created_at: vod.created_at,
        metadata: {
          vod_id: vod.id,
          vod_title: vod.title,
          segment_count: segs.length,
          backfilled: true,
        },
      });

      if (error) {
        stats.errors.push(`transcript vod ${vod.id}: ${error.message}`);
      } else {
        stats.transcriptChunksBackfilled++;
      }
    }
  } catch (err: any) {
    stats.errors.push(`content_transcripts: ${err.message?.slice(0, 100)}`);
  }

  // ── 4. Logg backfill-kjøringen som system_event ────────────────────────────────
  const total = stats.streamSessionsBackfilled + stats.highlightsBackfilled + stats.transcriptChunksBackfilled;
  try {
    await db.from('system_events').insert({
      workspace_id: ws,
      source: 'learning_aggregator',
      event_type: 'BACKFILL_COMPLETED',
      title: `Backfill ferdig: ${total} events opprettet`,
      severity: total > 0 ? 'info' : 'warning',
      metadata: {
        ...stats,
        workspaceId: ws,
        ranAt: now,
      },
    });
    stats.insightsGenerated = total > 0 ? 1 : 0;
  } catch {}

  return NextResponse.json({
    ok: true,
    workspace_id: ws,
    stats,
    totalEventsCreated: total,
    message: total > 0
      ? `${total} historiske events lagt til — aggregatoren plukker dem opp i løpet av 15 min`
      : 'Ingen nye events — enten alt er allerede backfilled, eller det finnes ingen historisk data',
  });
}

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase ikke tilkoblet' });

  const ws = getWorkspaceId();
  const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

  const [streamsRes, vodsRes, eventsRes, backfillsRes] = await Promise.all([
    db.from('stream_history').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('started_at', cutoff90d),
    db.from('content_vods').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', cutoff90d),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).contains('metadata', { backfilled: true }),
  ]);

  return NextResponse.json({
    workspace_id: ws,
    available: {
      stream_history_90d: streamsRes.count ?? 0,
      content_vods_90d: vodsRes.count ?? 0,
    },
    in_ai_agent_events: {
      total: eventsRes.count ?? 0,
      backfilled: backfillsRes.count ?? 0,
    },
    instructions: 'POST til dette endepunktet for å kjøre backfill. GET for å se status.',
  });
}
