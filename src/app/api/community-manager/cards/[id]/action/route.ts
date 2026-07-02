import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type CardAction = 'delete' | 'set_active' | 'lock' | 'unlock';

const EVENT_TYPE: Record<CardAction, string> = {
  delete:     'CARD_DELETED',
  set_active: 'CARD_ACTIVE_SET',
  lock:       'CARD_LOCKED',
  unlock:     'CARD_UNLOCKED',
};

export async function POST(
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
  const id = params.id;

  let action: CardAction;
  try {
    const body = await req.json() as { action?: CardAction };
    if (!body.action || !(body.action in EVENT_TYPE)) {
      return NextResponse.json({ error: 'Ugyldig handling' }, { status: 400 });
    }
    action = body.action;
  } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 });
  }

  // Fetch card scoped to workspace
  const { data: card, error: fetchErr } = await db
    .from('community_cards')
    .select('id, user_id, card_type, title, is_active, is_tradeable')
    .eq('workspace_id', wsId)
    .eq('id', id)
    .single();

  if (fetchErr || !card) {
    return NextResponse.json({ error: 'Kort ikke funnet' }, { status: 404 });
  }

  const c = card as any;

  try {
    if (action === 'delete') {
      const { error } = await db
        .from('community_cards')
        .delete()
        .eq('workspace_id', wsId)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === 'set_active') {
      // Deactivate all other cards of same user + card_type
      const { error: deacErr } = await db
        .from('community_cards')
        .update({ is_active: false })
        .eq('workspace_id', wsId)
        .eq('user_id', c.user_id)
        .eq('card_type', c.card_type);
      if (deacErr) return NextResponse.json({ error: deacErr.message }, { status: 500 });

      const { error } = await db
        .from('community_cards')
        .update({ is_active: true })
        .eq('workspace_id', wsId)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === 'lock') {
      const { error } = await db
        .from('community_cards')
        .update({ is_tradeable: false })
        .eq('workspace_id', wsId)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === 'unlock') {
      const { error } = await db
        .from('community_cards')
        .update({ is_tradeable: true })
        .eq('workspace_id', wsId)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Handling feilet' }, { status: 500 });
  }

  // Log to system_events (non-blocking)
  try {
    await db.from('system_events').insert({
      workspace_id: wsId,
      source:       'admin',
      event_type:   EVENT_TYPE[action],
      title:        `[Admin] Kort ${action}: ${c.title}`,
      severity:     'info',
      metadata:     { cardId: id, cardTitle: c.title, userId: c.user_id, action },
    });
  } catch {}

  return NextResponse.json({ ok: true });
}
