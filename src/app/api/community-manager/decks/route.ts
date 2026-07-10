import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { RARITY_RANK } from '@/lib/rarity';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ decks: [], totalUsers: 0, totalCards: 0, error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ decks: [], totalUsers: 0, totalCards: 0, error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();

  try {
    const { data: cardRows, error: cardErr } = await db
      .from('community_cards')
      .select('*')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false });

    if (cardErr) {
      return NextResponse.json({ decks: [], totalUsers: 0, totalCards: 0, error: cardErr.message }, { status: 500 });
    }

    const { data: memberRows } = await db
      .from('community_members')
      .select('discord_id, username, display_name, level, xp, discord_xp, discord_avatar_url')
      .eq('workspace_id', wsId);

    const members = (memberRows ?? []) as any[];
    const memberById: Record<string, any> = {};
    for (const m of members) {
      memberById[m.discord_id as string] = m;
    }

    const cards = (cardRows ?? []) as any[];
    const cardsByUser: Record<string, any[]> = {};
    for (const c of cards) {
      const uid = c.user_id as string;
      if (!cardsByUser[uid]) cardsByUser[uid] = [];
      cardsByUser[uid].push(c);
    }

    const decks = Object.entries(cardsByUser).map(([userId, userCards]) => {
      const member = memberById[userId];

      const totalCards = userCards.length;
      const uniqueTitles = new Set(userCards.map((c) => (c.title as string).toUpperCase()));
      const uniqueCards = uniqueTitles.size;
      const duplicates = totalCards - uniqueCards;

      let highestRarity = 'Common';
      let bestRank = RARITY_RANK['Common'];
      for (const c of userCards) {
        const rank = RARITY_RANK[c.rarity as keyof typeof RARITY_RANK] ?? 4;
        if (rank < bestRank) {
          bestRank = rank;
          highestRarity = c.rarity as string;
        }
      }

      const activeRaw = userCards.find((c) => !!c.is_active) ?? null;
      const activeCard = activeRaw
        ? { id: activeRaw.id as string, title: activeRaw.title as string, rarity: activeRaw.rarity as string }
        : null;

      const subCardCount = userCards.filter((c) => c.card_type === 'sub').length;

      const dates = userCards
        .map((c) => c.created_at as string)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a));
      const lastCardAt = dates[0] ?? null;

      const displayName =
        (member?.display_name as string | undefined) ||
        (member?.username as string | undefined) ||
        userId.slice(0, 8);

      return {
        user: {
          id:          userId,
          displayName,
          username:    (member?.username    as string | undefined) ?? userId.slice(0, 8),
          level:       (member?.level       as number | undefined) ?? 1,
          avatarUrl:   (member?.discord_avatar_url as string | null | undefined) ?? null,
        },
        stats: {
          totalCards,
          uniqueCards,
          duplicates,
          highestRarity,
          activeCard,
          subCardCount,
          lastCardAt,
        },
        cards: userCards.map((c) => ({
          id:             c.id             as string,
          title:          (c.title         ?? 'Ukjent') as string,
          rarity:         (c.rarity        ?? 'Common') as string,
          card_type:      (c.card_type     ?? 'persona') as string,
          card_image_url: (c.card_image_url ?? null) as string | null,
          card_number:    (c.card_number    ?? null) as number | null,
          source:         (c.source         ?? 'generated') as string,
          is_active:      !!c.is_active,
          is_tradeable:   c.is_tradeable !== false,
          metadata:       (c.metadata       ?? null) as Record<string, string> | null,
          created_at:     c.created_at    as string,
        })),
      };
    });

    decks.sort((a, b) => b.stats.totalCards - a.stats.totalCards);

    return NextResponse.json({
      decks,
      totalUsers: decks.length,
      totalCards: cards.length,
    });
  } catch (err: any) {
    return NextResponse.json({ decks: [], totalUsers: 0, totalCards: 0, error: err?.message ?? 'Ukjent feil' }, { status: 500 });
  }
}
