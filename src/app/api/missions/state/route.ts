import { NextResponse }    from 'next/server';
import { getDb }           from '@/lib/db';
import { getWorkspaceId }  from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const db = getDb();
  const ws = getWorkspaceId();
  const url = new URL(req.url);
  const startIso = url.searchParams.get('startIso');

  if (!db || !startIso) return NextResponse.json({ completed: [] });

  // Load MISSION_COMPLETED events logged since stream start
  const { data } = await db
    .from('system_events')
    .select('metadata')
    .eq('workspace_id', ws)
    .eq('event_type', 'MISSION_COMPLETED')
    .gte('created_at', startIso)
    .limit(50);

  const completed = (data ?? [])
    .map((e: any) => e.metadata?.missionId)
    .filter(Boolean) as string[];

  const unique = Array.from(new Set(completed));
  return NextResponse.json({ completed: unique });
}
