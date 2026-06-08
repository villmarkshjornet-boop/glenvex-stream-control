import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { hentBotData } from '@/lib/botData';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Prøv Supabase først
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('stream_history')
        .select('*')
        .eq('workspace_id', getWorkspaceId())
        .order('started_at', { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        const history = data.map(s => ({
          id: s.stream_id,
          title: s.title,
          game: s.game,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          durationMinutes: s.duration_minutes ?? 0,
          peakViewers: s.peak_viewers ?? 0,
          avgViewers: s.avg_viewers ?? 0,
          chatMessages: s.chat_messages ?? 0,
          followerGain: s.followers_gained ?? 0,
          subsGained: s.subs_gained ?? 0,
          raidsDuring: s.raids_during ?? 0,
        }));
        return NextResponse.json(history);
      }
    }
  }

  // Fallback
  const data = await hentBotData('stream-history');
  return NextResponse.json(data ?? []);
}
