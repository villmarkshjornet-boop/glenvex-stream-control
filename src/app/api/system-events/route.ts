import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  if (!isDbAvailable()) return NextResponse.json({ events: [] });
  const db = getDb();
  if (!db) return NextResponse.json({ events: [] });

  const { searchParams } = new URL(req.url);
  const minutesBack = parseInt(searchParams.get('minutesBack') ?? '60', 10);
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 200);
  const source      = searchParams.get('source') ?? null;
  const vodId       = searchParams.get('vodId') ?? null;

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
  // Filter by vodId inside JSONB metadata column
  if (vodId) query = (query as any).contains('metadata', { vodId });

  const { data, error } = await query;

  return NextResponse.json({
    events: data ?? [],
    error:  error?.message ?? null,
  });
}

// POST — allows client-side code to log system events
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase ikke tilkoblet' });

  try {
    const body = await req.json();
    const { source = 'content_factory', event_type, title, description, severity, metadata } = body;

    if (!event_type || !title) {
      return NextResponse.json({ ok: false, error: 'event_type og title kreves' }, { status: 400 });
    }

    await db.from('system_events').insert({
      workspace_id: getWorkspaceId(),
      source,
      event_type,
      title,
      description: description ?? null,
      severity: severity ?? 'info',
      metadata: metadata ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
