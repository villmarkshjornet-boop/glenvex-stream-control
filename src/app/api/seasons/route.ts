import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ seasons: [], error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ seasons: [], error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();

  try {
    const { data, error } = await db
      .from('card_seasons')
      .select('id, name, description, style_ref, is_active, created_at')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ seasons: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ seasons: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ seasons: [], error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();

  let name: string;
  let description: string;
  let style_ref: string;
  try {
    const body = await req.json() as { name?: string; description?: string; style_ref?: string };
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    name = body.name.trim();
    description = typeof body.description === 'string' ? body.description : '';
    style_ref = typeof body.style_ref === 'string' ? body.style_ref : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const { data, error } = await db
      .from('card_seasons')
      .insert({
        workspace_id: wsId,
        name,
        description,
        style_ref,
        is_active: false,
      })
      .select('id, name, description, style_ref, is_active, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, season: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
