import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getBroadcasterId } from '@/lib/twitch';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface FollowerSnapshot {
  ts: string;       // ISO timestamp
  total: number;
}

interface RecentFollower {
  user_name: string;
  followed_at: string;
}

async function getTwitchToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(6000) }
    );
    const d = await res.json() as any;
    return d.access_token ?? null;
  } catch { return null; }
}

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID mangler' }, { status: 500 });
  }

  // Prøv bruker-token først (gir tilgang til enkeltfølgere), ellers app-token
  const userOauth = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
  const appToken = await getTwitchToken();
  const token = userOauth || appToken;
  if (!token) return NextResponse.json({ error: 'Ingen Twitch-token tilgjengelig' }, { status: 500 });

  const broadcasterId = await getBroadcasterId();
  if (!broadcasterId) return NextResponse.json({ error: 'Fant ikke Twitch-bruker' }, { status: 404 });

  // Hent følger-data fra Twitch
  let total = 0;
  let recentFollowers: RecentFollower[] = [];

  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=20`,
      {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const d = await res.json() as any;
      total = d.total ?? 0;
      recentFollowers = (d.data ?? []).map((f: any) => ({
        user_name: f.user_name,
        followed_at: f.followed_at,
      }));
    }
  } catch {}

  // Les snapshot-historikk fra Supabase workspace settings_json
  const db = getDb();
  let snapshots: FollowerSnapshot[] = [];

  if (db && total > 0) {
    try {
      const { data: ws } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', getWorkspaceId())
        .single();

      const existing = ws?.settings_json ?? {};
      snapshots = (existing.follower_snapshots ?? []) as FollowerSnapshot[];

      // Legg til nytt snapshot (maks 1 per time)
      const nå = new Date();
      const sistSnapshot = snapshots[snapshots.length - 1];
      const minSidenSist = sistSnapshot
        ? (nå.getTime() - new Date(sistSnapshot.ts).getTime()) / 60_000
        : 9999;

      if (minSidenSist >= 55) {
        snapshots.push({ ts: nå.toISOString(), total });
        // Hold 7 dager (168 timer = 168 snapshots)
        if (snapshots.length > 200) snapshots = snapshots.slice(-168);

        await db.from('workspaces').update({
          settings_json: { ...existing, follower_snapshots: snapshots },
        }).eq('id', getWorkspaceId());
      }
    } catch {}
  }

  // Beregn vekst
  const nå = Date.now();
  const dag1Siden = nå - 24 * 60 * 60 * 1000;
  const uke1Siden = nå - 7 * 24 * 60 * 60 * 1000;

  const dagSnapshot = snapshots.findLast(s => new Date(s.ts).getTime() <= dag1Siden);
  const ukeSnapshot = snapshots.findLast(s => new Date(s.ts).getTime() <= uke1Siden);

  const gainDag = dagSnapshot ? total - dagSnapshot.total : null;
  const gainUke = ukeSnapshot ? total - ukeSnapshot.total : null;

  // Bygg chartdata: antall snapshots de siste 7 dagene (1 per time)
  const chartData = snapshots
    .filter(s => new Date(s.ts).getTime() >= uke1Siden)
    .map(s => ({ ts: s.ts, total: s.total }));

  return NextResponse.json({
    total,
    gainDag,
    gainUke,
    recentFollowers,
    chartData,
    harBrukertToken: !!userOauth,
  });
}
