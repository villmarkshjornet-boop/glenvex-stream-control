import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getStreamInfo } from '@/lib/twitch';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const db = getDb();

  const [stream, aktiveJobber, sisteFerdige] = await Promise.all([
    getStreamInfo().catch(() => null),
    db ? db.from('content_vods').select('id,title,status,created_at')
      .eq('workspace_id', getWorkspaceId())
      .in('status', ['PENDING', 'ANALYZING'])
      .order('created_at', { ascending: false })
      .limit(3).then(r => r.data ?? []) : Promise.resolve([]),
    db ? db.from('content_vods').select('id,title,status,created_at,twitch_vod_id')
      .eq('workspace_id', getWorkspaceId())
      .eq('status', 'COMPLETE')
      .order('created_at', { ascending: false })
      .limit(5).then(r => r.data ?? []) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    enabled: true,
    streamStatus: stream?.isLive ? 'LIVE' : 'OFFLINE',
    isLive: stream?.isLive ?? false,
    aktiveJobber,
    sisteFerdige,
    vodWatcherAktiv: true,
  });
}
