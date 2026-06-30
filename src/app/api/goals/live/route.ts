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
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', icon: '◈', manuell: false },
  { type: 'subscribers', label: 'Subscribers', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf', icon: '★', manuell: false },
  { type: 'donations',   label: 'Donasjoner',  mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47', icon: '♥', manuell: true  },
];

const NORMALIZE_TYPE: Record<string, string> = { viewers: 'donations' };

const GOAL_DEFAULTS: Record<string, { icon: string; manuell: boolean; farge: string }> = {
  followers:   { icon: '◈', manuell: false, farge: '#00ff41' },
  subscribers: { icon: '★', manuell: false, farge: '#9b77cf' },
  donations:   { icon: '♥', manuell: true,  farge: '#ff7b47' },
};

function normalizeSavedGoals(saved: any[]): Goal[] {
  return saved.map(g => {
    const type = NORMALIZE_TYPE[g.type] ?? g.type;
    const def  = GOAL_DEFAULTS[type] ?? { icon: '◆', manuell: true, farge: '#00ff41' };
    return { ...def, ...g, type };
  });
}

async function getFollowers(token: string, broadcasterId: string, clientId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return 0;
    const data = await res.json() as any;
    return data.total ?? 0;
  } catch { return 0; }
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
      return NextResponse.json({
        connected: false,
        tokenStatus: 'missing' as const,
        live: { followers: 0, subscribers: 0, canReadSubscribers: false, harSubData: false },
        goals: goals.map(g => ({ ...g, gjeldende: g.type === 'donations' ? g.gjeldende : 0 })),
      });
    }
  }

  if (!broadcasterId || !clientId) {
    return NextResponse.json({
      connected: false,
      tokenStatus: 'missing' as const,
      live: { followers: 0, subscribers: 0, canReadSubscribers: false, harSubData: false },
      goals,
    });
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

  if (userToken) {
    const [f, s] = await Promise.all([
      getFollowers(userToken, broadcasterId, clientId),
      getSubscribers(userToken, broadcasterId, clientId),
    ]);
    followers          = f;
    subscriberTotal    = s.total;
    canReadSubscribers = s.canRead;
  }

  // Snapshot fallback if live followers unavailable
  if (followers === 0 && db) {
    const { data: ws } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
    const snapshots: { ts: string; total: number }[] = ws?.settings_json?.follower_snapshots ?? [];
    if (snapshots.length > 0) {
      followers    = snapshots[snapshots.length - 1].total;
      fromSnapshot = true;
    }
  }

  const tokenStatus =
    !userToken          ? 'missing'  :
    fromSnapshot        ? 'snapshot' :
    followers > 0       ? 'ok'       : 'missing';

  const oppdatert = goals.map(g => {
    if (g.type === 'followers')                         return { ...g, gjeldende: followers };
    if (g.type === 'subscribers' && canReadSubscribers) return { ...g, gjeldende: subscriberTotal };
    return g;
  });

  // Hent fx-innstillinger fra settings_json
  let fx: Record<string, unknown> | null = null;
  if (db) {
    const { data: fxRow } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
    fx = fxRow?.settings_json?.viewer_goals_fx ?? null;
  }

  return NextResponse.json({
    connected: true,
    tokenStatus,
    live: { followers, subscribers: subscriberTotal, canReadSubscribers, harSubData: canReadSubscribers, fromSnapshot },
    goals: oppdatert,
    fx,
  });
}
