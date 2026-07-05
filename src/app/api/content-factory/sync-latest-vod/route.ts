/**
 * POST /api/content-factory/sync-latest-vod
 * Checks Twitch for the latest VOD (last 48h) and ensures a stream_history record exists.
 * Does NOT start the content factory pipeline — use /api/vod/detect-latest for that.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

async function getTwitchToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(8000) }
    );
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function getTwitchUserId(
  clientId: string,
  token: string,
  username: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
      {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = (await res.json()) as { data?: { id: string }[] };
    return data.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveChannel(): Promise<string | null> {
  const db = getDb();
  if (db) {
    try {
      const { data } = await db
        .from('workspaces')
        .select('twitch_channel_name,settings_json')
        .eq('id', getWorkspaceId())
        .single();
      if (data) {
        const cfChannel = (data.settings_json as any)?.contentFactoryChannel as string | undefined;
        if (cfChannel?.trim()) return cfChannel.trim();
        const wsChannel = data.twitch_channel_name as string | undefined;
        if (wsChannel?.trim()) return wsChannel.trim();
      }
    } catch {}
  }
  return process.env.TWITCH_USERNAME ?? null;
}

function parseDurationSeconds(duration: string): number {
  const m = (duration ?? '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  return (
    parseInt(m[1] ?? '0') * 3600 +
    parseInt(m[2] ?? '0') * 60 +
    parseInt(m[3] ?? '0')
  );
}

export async function POST() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const clientId = process.env.TWITCH_CLIENT_ID;
  const channel = await resolveChannel();

  if (!clientId || !channel) {
    return NextResponse.json(
      { error: 'TWITCH_CLIENT_ID mangler eller ingen Twitch-kanal satt i workspace' },
      { status: 500 }
    );
  }

  const token = await getTwitchToken();
  if (!token) {
    return NextResponse.json(
      { error: 'Kunne ikke hente Twitch-token — sjekk TWITCH_CLIENT_SECRET' },
      { status: 500 }
    );
  }

  const userId = await getTwitchUserId(clientId, token, channel);
  if (!userId) {
    return NextResponse.json(
      { error: `Fant ikke Twitch-bruker: ${channel}` },
      { status: 404 }
    );
  }

  // Fetch latest archive VOD from Twitch
  let vodData: { data?: any[] };
  try {
    const vodRes = await fetch(
      `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=3`,
      {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    vodData = (await vodRes.json()) as { data?: any[] };
  } catch {
    return NextResponse.json({ error: 'Twitch API-feil ved henting av VODs' }, { status: 502 });
  }

  const vods: any[] = vodData.data ?? [];

  // Log the lookup attempt
  logSystemEvent({
    source: 'content_factory',
    event_type: 'VOD_LOOKUP_STARTED',
    title: `Manuell VOD-sjekk: ${channel}`,
    severity: 'info',
    metadata: { channel, vodsFound: vods.length },
  }).catch(() => {});

  if (vods.length === 0) {
    return NextResponse.json({ vodFound: false });
  }

  // Check if the latest VOD is within 48 hours
  const latestVod = vods[0];
  const vodPublishedAt = new Date(latestVod.published_at ?? latestVod.created_at);
  const ageMs = Date.now() - vodPublishedAt.getTime();
  const WINDOW_48H = 48 * 3600_000;

  if (ageMs > WINDOW_48H) {
    return NextResponse.json({ vodFound: false });
  }

  const title: string = latestVod.title ?? 'Ukjent tittel';
  const durationSek = parseDurationSeconds(latestVod.duration ?? '');
  const startedAt = vodPublishedAt.toISOString();
  const endedAt = new Date(vodPublishedAt.getTime() + durationSek * 1000).toISOString();
  const ws = getWorkspaceId();

  // Check if a stream_history record already exists near this time (±3h window)
  const windowStart = new Date(vodPublishedAt.getTime() - 3 * 3600_000).toISOString();
  const windowEnd = new Date(vodPublishedAt.getTime() + 3 * 3600_000).toISOString();

  const { data: existing } = await db
    .from('stream_history')
    .select('stream_id,title')
    .eq('workspace_id', ws)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({
      vodFound: true,
      alreadyInDb: true,
      streamHistoryCreated: false,
      title,
    });
  }

  // Create a minimal stream_history record from VOD metadata
  const streamId = `vod_sync_${latestVod.id}`;

  const { error: insertErr } = await db.from('stream_history').insert({
    workspace_id: ws,
    stream_id: streamId,
    title,
    game: 'Ukjent',
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: Math.round(durationSek / 60),
    peak_viewers: 0,
    avg_viewers: 0,
    chat_messages: 0,
    followers_gained: 0,
    subs_gained: 0,
    raids_during: 0,
  });

  if (insertErr) {
    return NextResponse.json(
      { error: `Kunne ikke opprette stream-historikk: ${insertErr.message}` },
      { status: 500 }
    );
  }

  logSystemEvent({
    source: 'content_factory',
    event_type: 'VOD_AUTO_QUEUE_STARTED',
    title: `Stream-historikk opprettet fra VOD: ${title}`,
    severity: 'info',
    metadata: { twitchVodId: latestVod.id, title, startedAt, endedAt, streamId },
  }).catch(() => {});

  return NextResponse.json({
    vodFound: true,
    streamHistoryCreated: true,
    alreadyInDb: false,
    title,
  });
}
