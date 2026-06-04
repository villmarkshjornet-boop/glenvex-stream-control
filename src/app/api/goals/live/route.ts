import { NextResponse } from 'next/server';
import { getBroadcasterId, getChannelStats } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
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

export async function GET() {
  const [broadcasterId, guild] = await Promise.all([
    getBroadcasterId(),
    getGuildInfo(),
  ]);

  const stats = broadcasterId ? await getChannelStats(broadcasterId) : null;

  const live = {
    followers: stats?.followerCount ?? 0,
    discordMembres: guild?.approximate_member_count ?? guild?.member_count ?? 0,
  };

  const goals = loadGoals();

  // Auto-oppdater gjeldende tall
  const oppdatert = goals.map(g => {
    if (g.type === 'followers') return { ...g, gjeldende: live.followers };
    if (g.type === 'subscribers') return { ...g };
    if (g.type === 'viewers') return { ...g };
    return g;
  });

  return NextResponse.json({ live, goals: oppdatert });
}
