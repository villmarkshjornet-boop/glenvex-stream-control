import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('community_members')
        .select('*')
        .eq('workspace_id', getWorkspaceId())
        .order('xp', { ascending: false });

      if (data && data.length > 0) {
        return NextResponse.json(data.map(m => ({
          id: m.discord_id,
          username: m.username,
          displayName: m.display_name,
          xp: m.xp ?? 0,
          level: m.level ?? 1,
          messages: m.messages ?? 0,
          reactions: m.reactions ?? 0,
          voiceMinutes: m.voice_minutes ?? 0,
          streamsAttended: m.streams_attended ?? 0,
          subs: m.subs ?? 0,
          giftSubs: m.gift_subs ?? 0,
          raids: m.raids ?? 0,
          engagementScore: m.engagement_score ?? 0,
          communityScore: m.community_score ?? 0,
          badges: m.badges ?? [],
          lastSeen: m.last_seen,
          joinedAt: m.joined_at ?? m.last_seen,
        })));
      }
    }
  }

  // Fallback: Railway bot data
  const data = await hentBotData('members') ?? {};
  return NextResponse.json(
    Object.values(data).sort((a: any, b: any) => b.xp - a.xp)
  );
}
