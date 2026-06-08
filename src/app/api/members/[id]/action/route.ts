import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const FOLLOW_UP_KEY = (id: string) => `followup_${id}`;

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });
  }

  const db = getDb()!;
  const ws = getWorkspaceId();
  const discordId = params.id;
  const { action } = await req.json() as { action: string };

  // ── Oppfølgingsliste ──────────────────────────────────────────────────────
  if (action === 'follow_up_add') {
    const { data: existing } = await db
      .from('ai_agent_memory')
      .select('id,occurrence_count')
      .eq('workspace_id', ws)
      .eq('key', FOLLOW_UP_KEY(discordId))
      .maybeSingle();

    if (existing) {
      await db.from('ai_agent_memory')
        .update({ occurrence_count: (existing.occurrence_count ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await db.from('ai_agent_memory').insert({
        workspace_id: ws,
        agent_type: 'community_manager',
        memory_type: 'follow_up',
        key: FOLLOW_UP_KEY(discordId),
        summary: 'Lagt til oppfølgingsliste av streamer',
        confidence_score: 1.0,
        occurrence_count: 1,
        updated_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'follow_up_remove') {
    await db.from('ai_agent_memory')
      .delete()
      .eq('workspace_id', ws)
      .eq('key', FOLLOW_UP_KEY(discordId));
    return NextResponse.json({ ok: true });
  }

  // ── Community Hero badge (lokal) ──────────────────────────────────────────
  if (action === 'hero_badge_add') {
    const { data: m } = await db
      .from('community_members')
      .select('badges')
      .eq('workspace_id', ws)
      .eq('discord_id', discordId)
      .single();

    const badges: string[] = m?.badges ?? [];
    if (!badges.includes('Community Hero')) {
      await db.from('community_members')
        .update({ badges: [...badges, 'Community Hero'] })
        .eq('workspace_id', ws)
        .eq('discord_id', discordId);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'hero_badge_remove') {
    const { data: m } = await db
      .from('community_members')
      .select('badges')
      .eq('workspace_id', ws)
      .eq('discord_id', discordId)
      .single();

    const badges = (m?.badges ?? []).filter((b: string) => b !== 'Community Hero');
    await db.from('community_members')
      .update({ badges })
      .eq('workspace_id', ws)
      .eq('discord_id', discordId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Ukjent action: ${action}` }, { status: 400 });
}
