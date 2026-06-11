import type { StreamInfo } from '@/types';

export interface ClipInfo {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  viewCount: number;
  createdAt: string;
  duration: number;
}

export interface ChannelStats {
  followerCount: number;
  clipCount: number;
  topClips: ClipInfo[];
}

interface TwitchToken {
  access_token: string;
  expires_at: number;
}

let cachedToken: TwitchToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID og TWITCH_CLIENT_SECRET mangler i .env');
  }

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );

  if (!res.ok) {
    throw new Error(`Twitch auth feilet: HTTP ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.access_token;
}

export async function getStreamInfo(username?: string): Promise<StreamInfo> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const twitchUsername = username || process.env.TWITCH_USERNAME;
  // Never fall back to a hardcoded channel — return offline if no identity available
  if (!twitchUsername) return { isLive: false, streamUrl: '', userName: '' };
  const twitchUrl =
    process.env.TWITCH_URL || `https://twitch.tv/${twitchUsername}`;

  if (!clientId) {
    return { isLive: false, streamUrl: twitchUrl, userName: twitchUsername };
  }

  const token = await getAccessToken();

  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchUsername)}`,
    {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Twitch API feil: HTTP ${res.status}`);
  }

  const data = await res.json() as { data: any[] };
  const stream = data.data?.[0];

  if (!stream) {
    return { isLive: false, streamUrl: twitchUrl, userName: twitchUsername };
  }

  const thumbnail = stream.thumbnail_url
    .replace('{width}', '1280')
    .replace('{height}', '720');

  return {
    isLive: true,
    id: stream.id,
    title: stream.title,
    game: stream.game_name,
    viewerCount: stream.viewer_count,
    startedAt: stream.started_at,
    thumbnailUrl: thumbnail,
    streamUrl: twitchUrl,
    userName: twitchUsername,
  };
}

export async function getBroadcasterId(username?: string): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const login = username || process.env.TWITCH_USERNAME;
  if (!clientId || !login) return null;

  const token = await getAccessToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json() as { data: { id: string }[] };
  return data.data?.[0]?.id ?? null;
}

export async function getTopClips(broadcasterId: string, count = 5): Promise<ClipInfo[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return [];

  const token = await getAccessToken();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=${count}&started_at=${weekAgo}`,
    { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];

  const data = await res.json() as { data: any[] };
  return (data.data ?? []).map((c: any) => ({
    id: c.id,
    title: c.title,
    url: c.url,
    thumbnailUrl: c.thumbnail_url,
    viewCount: c.view_count,
    createdAt: c.created_at,
    duration: c.duration,
  }));
}

export async function getChannelStats(broadcasterId: string): Promise<ChannelStats> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return { followerCount: 0, clipCount: 0, topClips: [] };

  const token = await getAccessToken();

  const [followersRes, clipsRes] = await Promise.all([
    fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } }),
    fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=5`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } }),
  ]);

  const followersData = followersRes.ok
    ? await followersRes.json() as { total: number }
    : { total: 0 };

  const clipsData = clipsRes.ok
    ? await clipsRes.json() as { data: any[] }
    : { data: [] };

  const topClips: ClipInfo[] = (clipsData.data ?? []).map((c: any) => ({
    id: c.id,
    title: c.title,
    url: c.url,
    thumbnailUrl: c.thumbnail_url,
    viewCount: c.view_count,
    createdAt: c.created_at,
    duration: c.duration,
  }));

  return {
    followerCount: followersData.total ?? 0,
    clipCount: topClips.length,
    topClips,
  };
}

export async function checkTwitchApiHealth(): Promise<boolean> {
  try {
    await getStreamInfo();
    return true;
  } catch {
    return false;
  }
}
