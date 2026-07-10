import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();
  const { id } = params;

  let body: { name?: string; description?: string; style_ref?: string; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Verify the season belongs to this workspace
  const { data: existing, error: fetchErr } = await db
    .from('card_seasons')
    .select('id')
    .eq('workspace_id', wsId)
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.style_ref === 'string') updates.style_ref = body.style_ref;
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

  try {
    // If activating this season, first deactivate all others in the workspace
    if (updates.is_active === true) {
      const { error: deacErr } = await db
        .from('card_seasons')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('workspace_id', wsId)
        .neq('id', id);

      if (deacErr) {
        return NextResponse.json({ error: deacErr.message }, { status: 500 });
      }
    }

    const { data, error } = await db
      .from('card_seasons')
      .update(updates)
      .eq('workspace_id', wsId)
      .eq('id', id)
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();
  const { id } = params;

  try {
    const { error } = await db
      .from('card_seasons')
      .delete()
      .eq('workspace_id', wsId)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
