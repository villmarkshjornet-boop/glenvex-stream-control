import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthenticatedWorkspace } from '@/lib/requireAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export interface CommunityMember {
  discord_id: string;
  username: string | null;
  display_name: string | null;
  top_role: string | null;
  xp: number;
  level: number;
  coins_balance: number;
  total_coins_earned: number;
  total_coins_spent: number;
  streak_days: number;
  engagement_score: number | null;
  last_seen: string | null;
  member_type: string | null;
  discord_avatar_url: string | null;
}

export async function GET(req: NextRequest) {
  const wsId = getAuthenticatedWorkspace(req);
  if (!wsId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 503 });
  }

  try {
    const { data, error } = await db
      .from('community_members')
      .select(
        'discord_id, username, display_name, top_role, xp, level, coins_balance, total_coins_earned, total_coins_spent, streak_days, engagement_score, last_seen, member_type, discord_avatar_url'
      )
      .eq('workspace_id', wsId)
      .order('coins_balance', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[economy/users] DB error:', error.message);
      return NextResponse.json({ error: 'Databasefeil' }, { status: 500 });
    }

    return NextResponse.json({ users: (data ?? []) as CommunityMember[] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    console.error('[economy/users] Unexpected error:', msg);
    return NextResponse.json({ error: 'Intern serverfeil' }, { status: 500 });
  }
}
