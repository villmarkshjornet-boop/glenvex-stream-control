import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import type { ContentVod, VodStatus } from '../types';
import { logPipeline } from '../jobs/pipelineLogger';

const WORKSPACE_ID = getWorkspaceId();

async function getTwitchToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );
    const data = await res.json() as any;
    return data.access_token ?? null;
  } catch { return null; }
}

export async function hentVodMetadata(streamId: string): Promise<Partial<ContentVod> | null> {
  assertContentFactoryEnabled();

  const token = await getTwitchToken();
  if (!token) return null;

  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/videos?user_id=${streamId}&type=archive&first=1`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID!,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;
    const vod = data.data?.[0];
    if (!vod) return null;

    // Parse duration (f.eks "3h12m44s")
    let durationSeconds = 0;
    const durMatch = vod.duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (durMatch) {
      durationSeconds =
        (parseInt(durMatch[1] ?? '0') * 3600) +
        (parseInt(durMatch[2] ?? '0') * 60) +
        parseInt(durMatch[3] ?? '0');
    }

    return {
      twitchVodId: vod.id,
      title: vod.title,
      category: vod.game_name ?? 'Ukjent',
      durationSeconds,
      vodUrl: vod.url,
      thumbnailUrl: vod.thumbnail_url?.replace('%{width}', '640').replace('%{height}', '360'),
      startedAt: vod.created_at,
    };
  } catch { return null; }
}

export async function opprettVod(streamId: string): Promise<ContentVod | null> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  await logPipeline({ vodId: '', step: 'DOWNLOAD', status: 'STARTED', message: `Starter VOD-henting for stream ${streamId}` });

  const metadata = await hentVodMetadata(streamId);

  const { data, error } = await db.from('content_vods').insert({
    workspace_id: WORKSPACE_ID,
    stream_id: streamId,
    twitch_vod_id: metadata?.twitchVodId,
    title: metadata?.title ?? 'Ukjent stream',
    category: metadata?.category ?? 'Ukjent',
    duration_seconds: metadata?.durationSeconds ?? 0,
    vod_url: metadata?.vodUrl,
    thumbnail_url: metadata?.thumbnailUrl,
    started_at: metadata?.startedAt,
    status: 'PENDING' as VodStatus,
  }).select().single();

  if (error) throw new Error(`VOD-oppretting feilet: ${error.message}`);

  await logPipeline({ vodId: data.id, step: 'DOWNLOAD', status: 'COMPLETE', message: 'VOD-metadata lagret' });

  return mapVod(data);
}

export async function oppdaterVodStatus(vodId: string, status: VodStatus): Promise<void> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return;
  await db.from('content_vods').update({ status, updated_at: new Date().toISOString() }).eq('id', vodId);
}

export async function hentVod(vodId: string): Promise<ContentVod | null> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from('content_vods').select('*').eq('id', vodId).single();
  return data ? mapVod(data) : null;
}

export async function hentAlleVods(): Promise<ContentVod[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_vods').select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: false });
  return (data ?? []).map(mapVod);
}

function mapVod(r: any): ContentVod {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    streamId: r.stream_id,
    twitchVodId: r.twitch_vod_id,
    title: r.title,
    category: r.category,
    durationSeconds: r.duration_seconds ?? 0,
    status: r.status,
    vodUrl: r.vod_url,
    thumbnailUrl: r.thumbnail_url,
    startedAt: r.started_at,
    createdAt: r.created_at,
  };
}
