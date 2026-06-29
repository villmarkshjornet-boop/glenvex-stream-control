import { NextResponse } from 'next/server';
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
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',       mal: 400,  gjeldende: 0, aktiv: true  },
  { type: 'subscribers', label: 'Subscribers',   mal: 10,   gjeldende: 0, aktiv: false },
  { type: 'donations',   label: 'Donasjoner',    mal: 1000, gjeldende: 0, aktiv: false },
];

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

async function getSubscribers(token: string, broadcasterId: string, clientId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return -1;
    const data = await res.json() as any;
    return data.total ?? 0;
  } catch { return -1; }
}

export async function GET() {
  const wsId = getWorkspaceId();
  const db   = getDb();
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
    if (savedGoals?.length > 0) goals = savedGoals;

    if (!broadcasterId) {
      return NextResponse.json({
        connected: false,
        live: { followers: 0, subscribers: -1, harSubData: false },
        goals: goals.map(g => ({ ...g, gjeldende: g.type === 'donations' ? g.gjeldende : 0 })),
      });
    }
  }

  if (!broadcasterId || !clientId) {
    return NextResponse.json({
      connected: false,
      live: { followers: 0, subscribers: -1, harSubData: false },
      goals,
    });
  }

  // Use broadcaster user token (required for followers since Aug 2023)
  const userToken = await getValidBroadcasterToken(wsId);

  let followers   = 0;
  let subscribers = -1;

  if (userToken) {
    [followers, subscribers] = await Promise.all([
      getFollowers(userToken, broadcasterId, clientId),
      getSubscribers(userToken, broadcasterId, clientId),
    ]);
  }

  const oppdatert = goals.map(g => {
    if (g.type === 'followers')                       return { ...g, gjeldende: followers };
    if (g.type === 'subscribers' && subscribers >= 0) return { ...g, gjeldende: subscribers };
    return g; // donations and others keep their saved value
  });

  return NextResponse.json({
    connected: true,
    live: { followers, subscribers, harSubData: subscribers >= 0 },
    goals: oppdatert,
  });
}
