import { NextResponse } from 'next/server';
import { generatePromo } from '@/lib/openai';
import { getStreamInfo } from '@/lib/twitch';
import { addLog } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const wsId = getWorkspaceId();
    const db = getDb();

    let brandName = 'streameren';
    let twitchLogin: string | null = null;

    if (db) {
      const { data: ws } = await db.from('workspaces').select('brand_name,twitch_login').eq('id', wsId).single();
      brandName  = ws?.brand_name  ?? 'streameren';
      twitchLogin = ws?.twitch_login ?? null;
      if (!ws?.brand_name) {
        void db.from('system_events').insert({ workspace_id: wsId, source: 'ai_promo', event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT', title: 'AI Promo: workspace mangler brand_name', severity: 'warning', metadata: { wsId } });
      }
    }

    let stream;
    try {
      stream = await getStreamInfo(twitchLogin ?? undefined);
    } catch {
      stream = {
        isLive: false,
        game: 'Gaming',
        title: 'Live stream',
        streamUrl: twitchLogin ? `https://twitch.tv/${twitchLogin}` : '',
        userName: twitchLogin ?? '',
      };
    }

    const promo = await generatePromo(stream, { brandName, twitchLogin: twitchLogin ?? undefined });
    addLog('success', 'AI promo generert', 'OK');
    return NextResponse.json(promo);
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved AI promo-generering: ${msg}`, 'ERROR');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
