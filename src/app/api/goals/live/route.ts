import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getValidBroadcasterToken } from '@/lib/twitchUserToken';

export const dynamic = 'force-dynamic';

interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge?: string;
  icon?: string;
  manuell?: boolean;
  source?: 'auto' | 'manual';
  startValue?: number;
  resetPolicy?: 'never' | 'per_stream' | 'daily' | 'manual';
  lastResetStreamId?: string | null;
  lastResetAt?: string | null;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', icon: '◈', manuell: false, source: 'auto'   },
  { type: 'subscribers', label: 'Subscribers', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf', icon: '★', manuell: false, source: 'auto'   },
  { type: 'donations',   label: 'Donasjoner',  mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47', icon: '♥', manuell: true,  source: 'manual' },
];

const NORMALIZE_TYPE: Record<string, string> = { viewers: 'donations' };

const GOAL_DEFAULTS: Record<string, { icon: string; manuell: boolean; source: 'auto' | 'manual'; farge: string }> = {
  followers:   { icon: '◈', manuell: false, source: 'auto',   farge: '#00ff41' },
  subscribers: { icon: '★', manuell: false, source: 'auto',   farge: '#9b77cf' },
  donations:   { icon: '♥', manuell: true,  source: 'manual', farge: '#ff7b47' },
};

function normalizeSavedGoals(saved: any[]): Goal[] {
  return saved.map(g => {
    const type = NORMALIZE_TYPE[g.type] ?? g.type;
    const def  = GOAL_DEFAULTS[type] ?? { icon: '◆', manuell: true, source: 'manual' as const, farge: '#00ff41' };
    // Derive source from manuell if not explicitly set (backward-compat)
    const source: 'auto' | 'manual' = g.source ?? (g.manuell ? 'manual' : def.source);
    return { ...def, ...g, type, source };
  });
}

function withCache(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
  return res;
}

async function getFollowers(token: string, broadcasterId: string, clientId: string): Promise<{ total: number; apiOk: boolean }> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { total: 0, apiOk: false };
    const data = await res.json() as any;
    return { total: data.total ?? 0, apiOk: true };
  } catch { return { total: 0, apiOk: false }; }
}

async function getSubscribers(token: string, broadcasterId: string, clientId: string): Promise<{ total: number; canRead: boolean }> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { total: 0, canRead: false };
    const data = await res.json() as any;
    return { total: data.total ?? 0, canRead: true };
  } catch { return { total: 0, canRead: false }; }
}

export async function GET(req: NextRequest) {
  const wsParam = req.nextUrl.searchParams.get('ws');
  const wsId    = wsParam || getWorkspaceId();
  const db      = getDb();
  const clientId = process.env.TWITCH_CLIENT_ID ?? '';

  let broadcasterId: string | null = null;
  let goals = DEFAULT_GOALS;

  if (db) {
    const [wsRes, goalsRes] = await Promise.all([
      db.from('workspaces').select('twitch_user_id,twitch_login').eq('id', wsId).single(),
      db.from('workspaces').select('settings_json').eq('id', wsId).single(),
    ]);

    broadcasterId = wsRes.data?.twitch_user_id ?? null;
    const savedGoals = goalsRes.data?.settings_json?.viewer_goals;
    if (Array.isArray(savedGoals) && savedGoals.length > 0) {
      goals = normalizeSavedGoals(savedGoals);
    }

    if (!broadcasterId) {
      return withCache(NextResponse.json({
        connected: false,
        tokenStatus: 'missing' as const,
        live: { followers: 0, subscribers: 0, canReadSubscribers: false, harSubData: false },
        goals: goals.map(g => ({
          ...g,
          gjeldende: (g.source === 'manual' || g.manuell) ? g.gjeldende : 0,
        })),
      }));
    }
  }

  if (!broadcasterId || !clientId) {
    return withCache(NextResponse.json({
      connected: false,
      tokenStatus: 'missing' as const,
      live: { followers: 0, subscribers: 0, canReadSubscribers: false, harSubData: false },
      goals,
    }));
  }

  let userToken = await getValidBroadcasterToken(wsId);
  if (!userToken) {
    const envToken = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
    if (envToken) userToken = envToken;
  }

  let followers          = 0;
  let subscriberTotal    = 0;
  let canReadSubscribers = false;
  let fromSnapshot       = false;
  let followersApiOk     = false;

  if (userToken) {
    const [f, s] = await Promise.all([
      getFollowers(userToken, broadcasterId, clientId),
      getSubscribers(userToken, broadcasterId, clientId),
    ]);
    followers          = f.total;
    followersApiOk     = f.apiOk;
    subscriberTotal    = s.total;
    canReadSubscribers = s.canRead;
  }

  // Snapshot fallback if followers API failed or returned 0
  if (!followersApiOk && db) {
    const { data: ws } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
    const snapshots: { ts: string; total: number }[] = ws?.settings_json?.follower_snapshots ?? [];
    if (snapshots.length > 0) {
      followers    = snapshots[snapshots.length - 1].total;
      fromSnapshot = true;
    }
  }

  // Token status: 'missing' = no token at all, 'snapshot' = token OK but using cached data,
  // 'ok' = token valid and live data fetched. Never return 'missing' just because followers=0.
  const tokenStatus =
    !userToken    ? 'missing'  :
    fromSnapshot  ? 'snapshot' : 'ok';

  // Only override gjeldende for auto-tracked goals; manual goals keep their stored value
  const oppdatert = goals.map(g => {
    const isAuto = g.source === 'auto' || (g.source === undefined && !g.manuell);
    if (isAuto && g.type === 'followers')                         return { ...g, gjeldende: followers };
    if (isAuto && g.type === 'subscribers' && canReadSubscribers) return { ...g, gjeldende: subscriberTotal };
    return g;
  });

  // Hent fx-innstillinger fra settings_json
  let fx: Record<string, unknown> | null = null;
  if (db) {
    const { data: fxRow } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
    fx = fxRow?.settings_json?.viewer_goals_fx ?? null;
  }

  return withCache(NextResponse.json({
    connected: true,
    tokenStatus,
    live: { followers, subscribers: subscriberTotal, canReadSubscribers, harSubData: canReadSubscribers, fromSnapshot },
    goals: oppdatert,
    fx,
  }));
}
