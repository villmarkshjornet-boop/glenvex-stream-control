import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ season: null, error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ season: null, error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();

  try {
    const { data, error } = await db
      .from('card_seasons')
      .select('id, name, description, style_ref, is_active, created_at')
      .eq('workspace_id', wsId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ season: null, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ season: data ?? null });
  } catch (err: any) {
    return NextResponse.json({ season: null, error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
