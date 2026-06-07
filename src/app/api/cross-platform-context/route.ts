/**
 * GET /api/cross-platform-context
 *
 * Henter ferske Twitch og Discord events fra ai_agent_events for dashboard.
 */
import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isDbAvailable()) {
    return NextResponse.json({ twitchEvents: [], discordEvents: [], contextReads: [] });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ twitchEvents: [], discordEvents: [], contextReads: [] });

  const ws = getWorkspaceId();
  const { searchParams } = new URL(req.url);
  const minutesBack = parseInt(searchParams.get('minutesBack') ?? '60', 10);
  const cutoff = new Date(Date.now() - minutesBack * 60_000).toISOString();

  const [twitchRes, discordRes, contextRes] = await Promise.all([
    db.from('ai_agent_events')
      .select('event_type,username,message_text,importance_score,metadata,created_at')
      .eq('workspace_id', ws)
      .eq('source', 'twitch')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(30),

    db.from('ai_agent_events')
      .select('event_type,username,message_text,importance_score,metadata,created_at')
      .eq('workspace_id', ws)
      .eq('source', 'discord')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(30),

    db.from('ai_agent_events')
      .select('source,event_type,metadata,created_at')
      .eq('workspace_id', ws)
      .eq('event_type', 'cross_platform_context_used')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    twitchEvents:  twitchRes.data  ?? [],
    discordEvents: discordRes.data ?? [],
    contextReads:  contextRes.data ?? [],
    minutesBack,
    generertKl: new Date().toLocaleTimeString('no-NO'),
  });
}
