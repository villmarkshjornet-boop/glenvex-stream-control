import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: Request) {
  if (!isDbAvailable()) return NextResponse.json({ events: [] });
  const db = getDb();
  if (!db) return NextResponse.json({ events: [] });

  const { searchParams } = new URL(req.url);
  const minutesBack = parseInt(searchParams.get('minutesBack') ?? '60', 10);
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 200);
  const source      = searchParams.get('source') ?? null;

  const cutoff = new Date(Date.now() - minutesBack * 60_000).toISOString();
  const ws     = getWorkspaceId();

  let query = db
    .from('system_events')
    .select('id,source,event_type,title,description,severity,metadata,created_at')
    .eq('workspace_id', ws)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source) query = query.eq('source', source);

  const { data, error } = await query;

  return NextResponse.json({
    events: data ?? [],
    error:  error?.message ?? null,
  });
}
