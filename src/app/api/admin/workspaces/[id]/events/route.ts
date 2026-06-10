import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const wsId = params.id;
  if (!wsId) return NextResponse.json({ error: 'workspace id mangler' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { data: events, error } = await db
    .from('system_events')
    .select('id,source,event_type,title,severity,metadata,created_at')
    .eq('workspace_id', wsId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ events: events ?? [] });
}
