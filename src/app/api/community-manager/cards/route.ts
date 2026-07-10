import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { RARITY_RANK } from '@/lib/rarity';

export const dynamic = 'force-dynamic';

const SORT_MAP: Record<string, string> = {
  created_at: 'created_at',
  title:      'title',
  rarity:     'rarity',
};

export async function GET(req: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ cards: [], total: 0, byRarity: {}, error: 'DB not available' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ cards: [], total: 0, byRarity: {}, error: 'DB not initialized' }, { status: 503 });
  }

  const wsId = getWorkspaceId();
  const { searchParams } = new URL(req.url);
  const userId = (searchParams.get('userId') ?? '').trim();
  const rarity = (searchParams.get('rarity') ?? '').trim();
  const type   = (searchParams.get('type') ?? '').trim();
  const search = (searchParams.get('search') ?? '').trim();
  const active = searchParams.get('active') === 'true';
  const sort   = searchParams.get('sort') ?? 'created_at';
  const sortCol = SORT_MAP[sort] ?? 'created_at';

  let query = db
    .from('community_cards')
    .select('*')
    .eq('workspace_id', wsId);

  if (userId) query = query.eq('user_id', userId);
  if (rarity) query = query.eq('rarity', rarity);
  if (type)   query = query.eq('card_type', type);
  if (active) query = query.eq('is_active', true);

  query = query.order(sortCol, { ascending: sortCol === 'title' });

  const { data: cardRows, error } = await query;

  if (error) {
    return NextResponse.json({ cards: [], total: 0, byRarity: {}, error: error.message }, { status: 500 });
  }

  const rows = (cardRows ?? []) as any[];

  // Resolve display names via community_members (LEFT JOIN on discord_id = user_id)
  const userIds = Array.from(new Set(rows.map((r) => r.user_id as string)));
  const nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: members } = await db
      .from('community_members')
      .select('discord_id, display_name, username')
      .eq('workspace_id', wsId)
      .in('discord_id', userIds);
    for (const m of ((members ?? []) as any[])) {
      nameById[m.discord_id as string] = (m.display_name || m.username || (m.discord_id as string).slice(0, 8)) as string;
    }
  }

  let cards = rows.map((c) => ({
    id:             c.id as string,
    user_id:        c.user_id as string,
    display_name:   nameById[c.user_id as string] ?? (c.user_id as string).slice(0, 8),
    card_type:      (c.card_type ?? 'persona') as string,
    rarity:         (c.rarity ?? 'Common') as string,
    title:          (c.title ?? 'Ukjent') as string,
    class:          (c.class ?? null) as string | null,
    archetype:      (c.archetype ?? null) as string | null,
    card_image_url: (c.card_image_url ?? null) as string | null,
    card_number:    (c.card_number ?? null) as number | null,
    source:         (c.source ?? 'generated') as string,
    is_active:      !!c.is_active,
    is_tradeable:   c.is_tradeable !== false,
    season_id:      (c.season_id   ?? null) as string | null,
    season_name:    (c.season_name ?? null) as string | null,
    metadata:       (c.metadata    ?? null) as Record<string, string> | null,
    created_at:     c.created_at as string,
  }));

  // Text search across title + display name (post-fetch)
  if (search) {
    const lc = search.toLowerCase();
    cards = cards.filter((c) =>
      c.title.toLowerCase().includes(lc) ||
      c.display_name.toLowerCase().includes(lc) ||
      (c.archetype ?? '').toLowerCase().includes(lc) ||
      (c.class ?? '').toLowerCase().includes(lc),
    );
  }

  if (sort === 'rarity') {
    cards.sort((a, b) => (RARITY_RANK[a.rarity as keyof typeof RARITY_RANK] ?? 99) - (RARITY_RANK[b.rarity as keyof typeof RARITY_RANK] ?? 99));
  }

  const byRarity: Record<string, number> = {};
  for (const c of cards) {
    byRarity[c.rarity] = (byRarity[c.rarity] ?? 0) + 1;
  }

  return NextResponse.json({ cards, total: cards.length, byRarity });
}
