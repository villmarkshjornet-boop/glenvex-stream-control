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

// ─── Typed error so callers can distinguish auth failures from other errors ───

export class TwitchApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly kind: 'token_fetch_failed' | 'auth_failed' | 'rate_limit' | 'api_error',
    message: string,
  ) {
    super(message);
    this.name = 'TwitchApiError';
  }
}

// ─── App access token (client credentials, not user OAuth) ────────────────────

interface CachedToken { access_token: string; expires_at: number; }
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new TwitchApiError(0, 'token_fetch_failed',
      'TWITCH_CLIENT_ID og TWITCH_CLIENT_SECRET mangler i miljøet');
  }

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' },
  );

  if (!res.ok) {
    throw new TwitchApiError(res.status, 'token_fetch_failed',
      res.status === 401 || res.status === 400
        ? `Twitch token feilet: HTTP ${res.status} — sjekk TWITCH_CLIENT_SECRET i Railway`
        : `Twitch token feilet: HTTP ${res.status}`,
    );
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return cachedToken.access_token;
}

// Exported so bot-side code (raid evaluator etc.) can share the same app token
// instead of relying on TWITCH_ACCESS_TOKEN (user OAuth) which expires.
export async function getAppAccessToken(): Promise<string> {
  return getAccessToken();
}

// ─── Helix helper: auto-retry once on 401 (handles revoked/rotated tokens) ───

async function helixGet(clientId: string, url: string, isRetry = false): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    if (!isRetry) {
      cachedToken = null;           // invalidate stale token
      return helixGet(clientId, url, true);
    }
    // Log to system_events as critical — this surfaces in dashboard system health
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const ws    = process.env.WORKSPACE_ID ?? '';
    if (sbUrl && sbKey) {
      fetch(`${sbUrl}/rest/v1/system_events`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          workspace_id: ws, source: 'twitch_api', event_type: 'TWITCH_API_AUTH_FAILED',
          title: 'Twitch API 401 — app access token ugyldig etter retry',
          description: 'TWITCH_CLIENT_SECRET kan være feil eller utløpt. Sjekk Railway/Vercel env vars.',
          severity: 'critical',
          metadata: { endpoint: url.replace(/\?.*$/, ''), tokenType: 'app_access_token', clientId },
        }),
      }).catch(() => {});
    }
    throw new TwitchApiError(401, 'auth_failed',
      'Twitch Helix autentisering feilet etter retry (401) — sjekk TWITCH_CLIENT_SECRET i Railway');
  }

  if (res.status === 429) {
    throw new TwitchApiError(429, 'rate_limit', 'Twitch API rate limit: HTTP 429');
  }

  if (!res.ok) {
    throw new TwitchApiError(res.status, 'api_error', `Twitch API feil: HTTP ${res.status}`);
  }

  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getStreamInfo(username?: string): Promise<StreamInfo> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const twitchUsername = username || process.env.TWITCH_USERNAME;
  if (!twitchUsername) return { isLive: false, streamUrl: '', userName: '' };

  const twitchUrl = process.env.TWITCH_URL || `https://twitch.tv/${twitchUsername}`;
  if (!clientId) return { isLive: false, streamUrl: twitchUrl, userName: twitchUsername };

  const data = await helixGet(
    clientId,
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchUsername)}`,
  ) as { data: any[] };

  const stream = data.data?.[0];
  if (!stream) return { isLive: false, streamUrl: twitchUrl, userName: twitchUsername };

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

  try {
    const data = await helixGet(
      clientId,
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    ) as { data: { id: string }[] };
    return data.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function getTopClips(broadcasterId: string, count = 5): Promise<ClipInfo[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return [];

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const data = await helixGet(
      clientId,
      `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=${count}&started_at=${weekAgo}`,
    ) as { data: any[] };
    return (data.data ?? []).map((c: any) => ({
      id: c.id, title: c.title, url: c.url,
      thumbnailUrl: c.thumbnail_url, viewCount: c.view_count,
      createdAt: c.created_at, duration: c.duration,
    }));
  } catch {
    return [];
  }
}

export interface TwitchVod {
  vodId:          string;
  streamId:       string | null;
  title:          string;
  createdAt:      string;
  durationMinutes: number;
  viewCount:      number;
  url:            string;
}

function parseTwitchDuration(d: string): number {
  const h = parseInt(d.match(/(\d+)h/)?.[1] ?? '0', 10);
  const m = parseInt(d.match(/(\d+)m/)?.[1] ?? '0', 10);
  const s = parseInt(d.match(/(\d+)s/)?.[1] ?? '0', 10);
  return h * 60 + m + Math.round(s / 60);
}

export async function getRecentVods(broadcasterId: string, count = 10): Promise<TwitchVod[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return [];
  try {
    const data = await helixGet(
      clientId,
      `https://api.twitch.tv/helix/videos?user_id=${broadcasterId}&type=archive&first=${count}`,
    ) as { data: any[] };
    return (data.data ?? []).map((v: any) => ({
      vodId:           v.id,
      streamId:        v.stream_id ?? null,
      title:           v.title ?? '',
      createdAt:       v.created_at,
      durationMinutes: parseTwitchDuration(v.duration ?? ''),
      viewCount:       v.view_count ?? 0,
      url:             v.url,
    }));
  } catch {
    return [];
  }
}

// userToken: broadcaster's user access token (required for /helix/channels/followers since Aug 2023).
// Clips use the app token (still allowed); followers are skipped gracefully when no userToken given.
export async function getChannelStats(broadcasterId: string, userToken?: string): Promise<ChannelStats> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return { followerCount: 0, clipCount: 0, topClips: [] };

  try {
    let followerCount = 0;

    if (userToken) {
      const followersRes = await fetch(
        `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
        { headers: { 'Client-ID': clientId, Authorization: `Bearer ${userToken}` } }
      ).catch(() => null);
      if (followersRes?.ok) {
        const d = await followersRes.json() as { total?: number };
        followerCount = d.total ?? 0;
      }
    }

    const clipsData = await helixGet(
      clientId,
      `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=5`,
    ) as { data: any[] };

    const topClips: ClipInfo[] = (clipsData.data ?? []).map((c: any) => ({
      id: c.id, title: c.title, url: c.url,
      thumbnailUrl: c.thumbnail_url, viewCount: c.view_count,
      createdAt: c.created_at, duration: c.duration,
    }));

    return { followerCount, clipCount: topClips.length, topClips };
  } catch {
    return { followerCount: 0, clipCount: 0, topClips: [] };
  }
}

export async function checkTwitchApiHealth(): Promise<boolean> {
  try {
    await getStreamInfo();
    return true;
  } catch {
    return false;
  }
}
