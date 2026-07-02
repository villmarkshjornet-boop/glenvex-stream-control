import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface CommunitySnapshotMember {
  discord_id: string;
  display_name: string | null;
  username: string | null;
  xp: number;
  level: number;
  coins_balance: number;
  streak_days: number;
}

export interface CommunitySnapshotData {
  topMembers: CommunitySnapshotMember[];
  totalMembers: number;
  latestTransaction: { user_id: string; amount: number; created_at: string } | null;
}

export async function GET(): Promise<NextResponse> {
  const db = getDb();
  if (!db) {
    return NextResponse.json<CommunitySnapshotData>({
      topMembers: [],
      totalMembers: 0,
      latestTransaction: null,
    });
  }

  const wsId = getWorkspaceId();

  const [membersRes, countRes, txRes] = await Promise.all([
    db
      .from('community_members')
      .select('discord_id,display_name,username,xp,level,coins_balance,streak_days,engagement_score')
      .eq('workspace_id', wsId)
      .order('xp', { ascending: false })
      .limit(5),

    db
      .from('community_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId),

    db
      .from('community_coin_transactions')
      .select('user_id,amount,created_at')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const topMembers: CommunitySnapshotMember[] = (membersRes.data ?? []).map(
    (m: Record<string, unknown>) => ({
      discord_id:    String(m.discord_id ?? ''),
      display_name:  m.display_name != null ? String(m.display_name) : null,
      username:      m.username != null ? String(m.username) : null,
      xp:            Number(m.xp ?? 0),
      level:         Number(m.level ?? 1),
      coins_balance: Number(m.coins_balance ?? 0),
      streak_days:   Number(m.streak_days ?? 0),
    }),
  );

  const txRaw = txRes.data?.[0] ?? null;
  const latestTransaction =
    txRaw != null
      ? {
          user_id:    String(txRaw.user_id ?? ''),
          amount:     Number(txRaw.amount ?? 0),
          created_at: String(txRaw.created_at ?? ''),
        }
      : null;

  return NextResponse.json<CommunitySnapshotData>({
    topMembers,
    totalMembers: countRes.count ?? 0,
    latestTransaction,
  });
}
