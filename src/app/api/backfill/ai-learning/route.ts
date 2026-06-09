/**
 * POST /api/backfill/ai-learning
 * Backfiller historisk data fra:
 *   1. Twitch API (siste 20 streams fra /helix/videos)
 *   2. content_highlights + content_transcripts (Vercel-skrevet data)
 *
 * Trygt å kjøre flere ganger — sjekker duplikater.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getBroadcasterId } from '@/lib/twitch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function parseTwitchDuration(d: string): number {
  const m = d.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? '0')) * 60 + parseInt(m[2] ?? '0') + Math.round(parseInt(m[3] ?? '0') / 60);
}

async function importTwitchHistory(db: any, ws: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const result = { imported: 0, skipped: 0, errors: [] as string[] };

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    result.errors.push('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET mangler på Vercel');
    return result;
  }

  // Hent app-token
  let token = '';
  try {
    const tokRes = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );
    if (!tokRes.ok) {
      const body = await tokRes.text().catch(() => '');
      result.errors.push(`Twitch auth feilet HTTP ${tokRes.status}: ${body.slice(0, 100)}`);
      return result;
    }
    const tok = await tokRes.json() as any;
    token = tok.access_token;
  } catch (e: any) {
    result.errors.push(`Twitch auth exception: ${e.message?.slice(0, 80)}`);
    return result;
  }

  // Finn broadcaster ID
  const broadcasterId = await getBroadcasterId().catch((e: any) => {
    result.errors.push(`getBroadcasterId exception: ${e?.message?.slice(0, 60)}`);
    return null;
  });
  if (!broadcasterId) {
    result.errors.push(`Broadcaster ID null — sjekk TWITCH_USERNAME (${process.env.TWITCH_USERNAME ?? 'ikke satt'}) og TWITCH_CLIENT_ID på Vercel`);
    return result;
  }

  // Hent siste 20 arkiverte streams (type=archive = lagrede past broadcasts på Twitch)
  let videos: any[] = [];
  try {
    const vRes = await fetch(
      `https://api.twitch.tv/helix/videos?user_id=${broadcasterId}&type=archive&first=20`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } }
    );
    if (!vRes.ok) {
      const body = await vRes.text().catch(() => '');
      result.errors.push(`Twitch /videos feilet HTTP ${vRes.status}: ${body.slice(0, 100)}`);
      return result;
    }
    const vData = await vRes.json() as any;
    videos = vData.data ?? [];
    if (videos.length === 0) {
      result.errors.push(`Twitch /videos returnerte 0 arkiver for broadcaster ${broadcasterId}. VOD-lagring kanskje ikke aktivert på Twitch-kontoen (Creator Dashboard → Settings → Stream → Store past broadcasts).`);
    }
  } catch (e: any) {
    result.errors.push(`Twitch videos exception: ${e.message?.slice(0, 80)}`);
    return result;
  }

  for (const v of videos) {
    const streamId = v.stream_id ?? v.id;
    const startedAt = v.created_at ?? v.published_at;
    const durationMin = parseTwitchDuration(v.duration ?? '0m');
    const endedAt = startedAt ? new Date(new Date(startedAt).getTime() + durationMin * 60_000).toISOString() : null;

    // Sjekk duplikat i stream_history
    const { count: existingHistory } = await db
      .from('stream_history')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('id', streamId);

    if ((existingHistory ?? 0) === 0) {
      // Skriv til stream_history
      const { error: histErr } = await db.from('stream_history').upsert({
        id: streamId,
        workspace_id: ws,
        title: v.title ?? '',
        game: null, // Twitch /videos gir ikke game_name
        started_at: startedAt,
        ended_at: endedAt,
        peak_viewers: v.view_count ?? 0,
        avg_viewers: Math.round((v.view_count ?? 0) * 0.3), // estimat
        duration_minutes: durationMin,
        follower_gain: 0,
        chat_messages: 0,
        raids_during: 0,
        subs_gained: 0,
      }, { onConflict: 'id' });

      if (histErr) {
        result.errors.push(`stream_history ${streamId}: ${histErr.message?.slice(0, 80)}`);
        continue;
      }
    }

    // Sjekk duplikat i ai_agent_events
    const { count: existingEvent } = await db
      .from('ai_agent_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('event_type', 'twitch_stream_backfill')
      .contains('metadata', { stream_id: streamId });

    if ((existingEvent ?? 0) > 0) {
      result.skipped++;
      continue;
    }

    const { error: evtErr } = await db.from('ai_agent_events').insert({
      workspace_id: ws,
      source: 'twitch',
      event_type: 'twitch_stream_backfill',
      message_text: `Stream: "${v.title ?? ''}" — ${durationMin} min, ${v.view_count ?? 0} visninger`,
      importance_score: Math.min(90, 40 + Math.round((v.view_count ?? 0) / 20)),
      created_at: startedAt ?? new Date().toISOString(),
      metadata: {
        stream_id: streamId,
        title: v.title,
        duration_minutes: durationMin,
        view_count: v.view_count,
        url: v.url,
        started_at: startedAt,
        ended_at: endedAt,
        backfilled: true,
        source: 'twitch_api',
      },
    });

    if (evtErr) {
      result.errors.push(`ai_agent_events ${streamId}: ${evtErr.message?.slice(0, 80)}`);
    } else {
      result.imported++;
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const ws = getWorkspaceId();
  const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const now = new Date().toISOString();

  const stats = {
    twitchStreamsImported: 0,
    twitchStreamsSkipped: 0,
    highlightsBackfilled: 0,
    transcriptChunksBackfilled: 0,
    errors: [] as string[],
  };

  // ── 1. Twitch historikk (siste 20 streams fra Twitch API) ─────────────────────
  const twitchResult = await importTwitchHistory(db, ws);
  stats.twitchStreamsImported = twitchResult.imported;
  stats.twitchStreamsSkipped = twitchResult.skipped;
  stats.errors.push(...twitchResult.errors);

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
      if (!error) stats.highlightsBackfilled++;
      else stats.errors.push(`highlight ${h.id}: ${error.message?.slice(0, 60)}`);
    }
  } catch (err: any) {
    stats.errors.push(`content_highlights: ${err.message?.slice(0, 80)}`);
  }

  // ── 3. content_vods → ai_agent_events (bruker metadata + transcript om det finnes) ──
  try {
    const { data: vods } = await db
      .from('content_vods')
      .select('id,title,category,status,duration_seconds,created_at,started_at')
      .eq('workspace_id', ws)
      .gte('created_at', cutoff90d)
      .order('created_at', { ascending: false })
      .limit(20);

    for (const vod of vods ?? []) {
      // Sjekk duplikat
      const { count: existing } = await db
        .from('ai_agent_events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('event_type', 'vod_backfill')
        .contains('metadata', { vod_id: vod.id });

      if ((existing ?? 0) > 0) continue;

      // Prøv å hente transcript-tekst for rikere kontekst
      const { data: segs } = await db
        .from('content_transcripts')
        .select('text,start_time')
        .eq('vod_id', vod.id)
        .order('start_time', { ascending: true })
        .limit(5);

      const transcriptTekst = segs && segs.length > 0
        ? ` Transkripsjon: ${segs.map((s: any) => s.text).join(' ').slice(0, 400)}`
        : '';

      const durationMin = vod.duration_seconds ? Math.round(vod.duration_seconds / 60) : 0;
      const messageText = `VOD: "${vod.title?.slice(0, 100) ?? ''}" — ${vod.category ?? 'Ukjent spill'}, ${durationMin} min, status: ${vod.status}.${transcriptTekst}`;

      const { error } = await db.from('ai_agent_events').insert({
        workspace_id: ws,
        source: 'content_factory',
        event_type: 'vod_backfill',
        message_text: messageText.slice(0, 600),
        importance_score: 65,
        created_at: vod.started_at ?? vod.created_at,
        metadata: {
          vod_id: vod.id,
          vod_title: vod.title,
          category: vod.category,
          status: vod.status,
          duration_minutes: durationMin,
          has_transcript: (segs?.length ?? 0) > 0,
          segment_count: segs?.length ?? 0,
          backfilled: true,
        },
      });
      if (!error) stats.transcriptChunksBackfilled++;
      else stats.errors.push(`vod ${vod.id}: ${error.message?.slice(0, 60)}`);

      // Lag også stream_history-rad om den mangler
      if (vod.started_at) {
        const { count: histExists } = await db
          .from('stream_history')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws)
          .eq('id', vod.id);

        if ((histExists ?? 0) === 0) {
          try {
            await db.from('stream_history').upsert({
              id: vod.id,
              workspace_id: ws,
              title: vod.title ?? '',
              game: vod.category ?? null,
              started_at: vod.started_at,
              ended_at: vod.duration_seconds
                ? new Date(new Date(vod.started_at).getTime() + vod.duration_seconds * 1000).toISOString()
                : null,
              peak_viewers: 0,
              avg_viewers: 0,
              duration_minutes: durationMin,
              follower_gain: 0,
              chat_messages: 0,
              raids_during: 0,
              subs_gained: 0,
            }, { onConflict: 'id' });
          } catch {}
        }
      }
    }
  } catch (err: any) {
    stats.errors.push(`content_vods: ${err.message?.slice(0, 80)}`);
  }

  // ── 4. Logg backfill-kjøringen ────────────────────────────────────────────────
  const total = stats.twitchStreamsImported + stats.highlightsBackfilled + stats.transcriptChunksBackfilled;
  try {
    await db.from('system_events').insert({
      workspace_id: ws,
      source: 'learning_aggregator',
      event_type: 'BACKFILL_COMPLETED',
      title: `Backfill ferdig: ${total} events opprettet (${stats.twitchStreamsImported} streams fra Twitch)`,
      severity: total > 0 ? 'info' : 'warning',
      metadata: { ...stats, workspaceId: ws, ranAt: now },
    });
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

  const [streamsRes, vodsRes, eventsRes, backfillsRes, twitchStreamsRes] = await Promise.all([
    db.from('stream_history').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('started_at', cutoff90d),
    db.from('content_vods').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', cutoff90d),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).contains('metadata', { backfilled: true }),
    db.from('ai_agent_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).eq('event_type', 'twitch_stream_backfill'),
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
      from_twitch_api: twitchStreamsRes.count ?? 0,
    },
    instructions: 'POST til dette endepunktet for å kjøre backfill. Henter siste 20 streams fra Twitch API automatisk.',
  });
}
