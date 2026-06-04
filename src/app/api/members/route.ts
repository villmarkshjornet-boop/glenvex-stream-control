import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Prøv Supabase først
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('community_members')
        .select('*')
        .eq('workspace_id', 'glenvex-default')
        .order('xp', { ascending: false });

      if (data && data.length > 0) {
        const members = data.map(m => ({
          id: m.discord_id,
          username: m.username,
          displayName: m.display_name,
          xp: m.xp ?? 0,
          level: m.level ?? 1,
          messages: m.messages ?? 0,
          subs: m.subs ?? 0,
          giftSubs: m.gift_subs ?? 0,
          raids: m.raids ?? 0,
          badges: m.badges ?? [],
          lastSeen: m.last_seen,
          lastWelcomed: m.last_welcomed,
        }));
        return NextResponse.json(members);
      }
    }
  }

  // Fallback: Railway BOT_API_URL eller fil
  const data = await hentBotData('members') ?? {};
  const members = Object.values(data).sort((a: any, b: any) => b.xp - a.xp);
  return NextResponse.json(members);
}
