import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',        mal: 1000, gjeldende: 0, aktiv: true  },
  { type: 'subscribers', label: 'Subscribers',    mal: 50,   gjeldende: 0, aktiv: true  },
  { type: 'viewers',     label: 'Seere (snitt)',  mal: 20,   gjeldende: 0, aktiv: false },
];

async function getTwitchAppToken(): Promise<string | null> {
  const clientId     = process.env.TWITCH_CLIENT_ID;
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

async function getFollowers(token: string, broadcasterId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return 0;
    const data = await res.json() as any;
    return data.total ?? 0;
  } catch { return 0; }
}

async function getSubscribers(token: string, broadcasterId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return -1; // -1 = scope mangler
    const data = await res.json() as any;
    return data.total ?? 0;
  } catch { return -1; }
}

export async function GET() {
  const wsId = getWorkspaceId();
  const db   = getDb();

  // Load workspace Twitch identity — never use env-based fallback in SaaS context
  let broadcasterId: string | null = null;
  let goals = DEFAULT_GOALS;

  if (db) {
    const [wsRes, goalsRes] = await Promise.all([
      db.from('workspaces').select('twitch_user_id,twitch_login').eq('id', wsId).single(),
      db.from('workspaces').select('settings_json').eq('id', wsId).single(),
    ]);

    broadcasterId = wsRes.data?.twitch_user_id ?? null;
    goals         = goalsRes.data?.settings_json?.viewer_goals ?? DEFAULT_GOALS;

    // Observability: log when Twitch is not connected
    if (!broadcasterId) {
      void db.from('system_events').insert({
        workspace_id: wsId,
        source:       'goals_live',
        event_type:   'WORKSPACE_MISSING_TWITCH',
        title:        'Goals API: workspace mangler twitch_user_id — ingen Twitch-statistikk',
        severity:     'warning',
        metadata:     { wsId, twitchLogin: wsRes.data?.twitch_login ?? null, field: 'twitch_user_id' },
      });

      return NextResponse.json({
        connected: false,
        live:  { followers: 0, subscribers: -1, harSubData: false },
        goals: goals.map(g => ({ ...g, gjeldende: 0 })),
      });
    }
  }

  if (!broadcasterId) {
    return NextResponse.json({
      connected: false,
      live:  { followers: 0, subscribers: -1, harSubData: false },
      goals: goals.map(g => ({ ...g, gjeldende: 0 })),
    });
  }

  const token = await getTwitchAppToken();
  let followers   = 0;
  let subscribers = -1;

  if (token) {
    [followers, subscribers] = await Promise.all([
      getFollowers(token, broadcasterId),
      getSubscribers(token, broadcasterId),
    ]);
  }

  const oppdatert = goals.map(g => {
    if (g.type === 'followers')                       return { ...g, gjeldende: followers };
    if (g.type === 'subscribers' && subscribers >= 0) return { ...g, gjeldende: subscribers };
    return g;
  });

  return NextResponse.json({
    connected: true,
    live: { followers, subscribers, harSubData: subscribers >= 0 },
    goals: oppdatert,
  });
}
