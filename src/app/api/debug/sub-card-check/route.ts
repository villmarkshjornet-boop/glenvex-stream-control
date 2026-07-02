import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'DB not available' }, { status: 503 });
  }

  const db    = getDb();
  if (!db) return NextResponse.json({ error: 'DB not initialized' }, { status: 503 });

  const wsId        = getWorkspaceId();
  const discordUserId = (new URL(req.url).searchParams.get('discordUserId') ?? '').trim();

  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId query param required' }, { status: 400 });
  }

  // Fetch member — NO tokens, only DB fields
  const { data: member, error: memberErr } = await db
    .from('community_members')
    .select('discord_id, username, display_name, twitch_id, twitch_username, twitch_linked, subs, badges, xp, discord_xp')
    .eq('workspace_id', wsId)
    .eq('discord_id', discordUserId)
    .single();

  if (memberErr && memberErr.code !== 'PGRST116') {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ found: false, workspace: wsId, discord_id: discordUserId }, { status: 404 });
  }

  const m = member as any;

  // Check for sub badge in badges array
  const badgesArr: string[] = Array.isArray(m.badges) ? m.badges : [];
  const hasSubBadge = badgesArr.some((b: string) => b.toLowerCase().includes('sub'));

  // Is considered subscriber if subs > 0 OR twitch_linked
  const isSubscriber = (m.subs as number ?? 0) > 0;

  // Fetch sub card(s) from community_cards
  const { data: subCards } = await db
    .from('community_cards')
    .select('id, title, rarity, card_type, source, is_active, is_tradeable, created_at')
    .eq('workspace_id', wsId)
    .eq('user_id', discordUserId)
    .eq('card_type', 'sub')
    .order('created_at', { ascending: false })
    .limit(5);

  const subCard = (subCards ?? [])[0] ?? null;

  // Fetch last error from system_events related to this user + twitch/sub
  const { data: lastErrorRows } = await db
    .from('system_events')
    .select('event_type, title, created_at, metadata')
    .eq('workspace_id', wsId)
    .or(`metadata->>discordId.eq.${discordUserId},metadata->>userId.eq.${discordUserId}`)
    .in('severity', ['error', 'warning'])
    .order('created_at', { ascending: false })
    .limit(3);

  const lastErrors = ((lastErrorRows ?? []) as any[]).map(r => ({
    event_type: r.event_type,
    title:      r.title,
    created_at: r.created_at,
  }));

  return NextResponse.json({
    found:          true,
    workspace:      wsId,
    discord_id:     m.discord_id,
    username:       m.username,
    display_name:   m.display_name,
    twitch_id:      m.twitch_id   ?? null,
    twitch_login:   m.twitch_username ?? null,
    twitch_linked:  m.twitch_linked ?? false,
    is_subscriber:  isSubscriber,
    subs_count:     m.subs ?? 0,
    has_sub_badge:  hasSubBadge,
    badges:         badgesArr,
    discord_xp:     m.discord_xp ?? null,
    xp:             m.xp ?? 0,
    sub_card:       subCard ? {
      id:          subCard.id,
      title:       subCard.title,
      rarity:      subCard.rarity,
      is_active:   subCard.is_active,
      is_tradeable: subCard.is_tradeable,
      created_at:  subCard.created_at,
    } : null,
    all_sub_cards_count: (subCards ?? []).length,
    last_errors:    lastErrors,
  });
}
