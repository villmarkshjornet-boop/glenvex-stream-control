import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const SORT_MAP: Record<string, string> = {
  xp:       'xp',
  coins:    'coins_balance',
  activity: 'last_activity_at',
  level:    'level',
};

export async function GET(req: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ members: [], error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ members: [], error: 'DB not initialized' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const search  = (searchParams.get('search') ?? '').trim();
  const subOnly = searchParams.get('sub') === 'true';
  const sort    = searchParams.get('sort') ?? 'xp';
  const sortCol = SORT_MAP[sort] ?? 'xp';

  let query = db
    .from('community_member_overview')
    .select('*')
    .eq('workspace_id', getWorkspaceId())
    .order(sortCol, { ascending: false });

  if (subOnly) {
    query = query.eq('twitch_sub_status', true);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ members: [], error: error.message }, { status: 500 });
  }

  let members = data ?? [];

  if (search) {
    const lc = search.toLowerCase();
    members = members.filter((m: any) =>
      (m.display_name ?? '').toLowerCase().includes(lc) ||
      (m.username     ?? '').toLowerCase().includes(lc) ||
      (m.nickname     ?? '').toLowerCase().includes(lc),
    );
  }

  return NextResponse.json({ members });
}
