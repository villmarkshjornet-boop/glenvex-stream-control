import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'goals.json');

interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

function loadGoals(): Goal[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

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
  // Krever channel:read:subscriptions scope – prøver med app token, faller tilbake til 0
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return -1; // -1 = ikke tilgang
    const data = await res.json() as any;
    return data.total ?? 0;
  } catch { return -1; }
}

async function getBroadcasterId(token: string): Promise<string | null> {
  const username = process.env.TWITCH_USERNAME;
  if (!username) return null;
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/users?login=${username}`,
      { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    return data.data?.[0]?.id ?? null;
  } catch { return null; }
}

export async function GET() {
  const token = await getTwitchToken();
  let followers = 0;
  let subscribers = -1;

  if (token) {
    const broadcasterId = await getBroadcasterId(token);
    if (broadcasterId) {
      [followers, subscribers] = await Promise.all([
        getFollowers(token, broadcasterId),
        getSubscribers(token, broadcasterId),
      ]);
    }
  }

  const goals = loadGoals();

  const oppdatert = goals.map(g => {
    if (g.type === 'followers') return { ...g, gjeldende: followers };
    if (g.type === 'subscribers' && subscribers >= 0) return { ...g, gjeldende: subscribers };
    return g;
  });

  return NextResponse.json({
    live: { followers, subscribers, harSubData: subscribers >= 0 },
    goals: oppdatert,
  });
}
