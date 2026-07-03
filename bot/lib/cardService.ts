/**
 * CardService — sell cards for coins, set showcase card.
 * Atomic sell: WHERE status='active' guard prevents double-payout on concurrent clicks.
 */

import { getBotDb } from './supabase';
import { awardCoins } from './coinService';

export const CARD_SELL_PRICES: Record<string, number> = {
  'Common':    10,
  'Uncommon':  30,
  'Rare':      100,
  'Epic':      300,
  'Legendary': 1000,
  'Mythic':    5000,
};

export function getSellPrice(rarity: string): number {
  return CARD_SELL_PRICES[rarity] ?? 10;
}

export interface CardRecord {
  id:           string;
  rarity:       string;
  title:        string;
  cardClass:    string | null;
  archetype:    string | null;
  cardImageUrl: string | null;
  cardNumber:   number | null;
  status:       string;
  isActive:     boolean;
  isTradeable:  boolean;
  createdAt:    string;
  soldAt:       string | null;
  soldFor:      number | null;
}

export async function getMemberCards(
  workspaceId: string,
  discordId:   string,
  includeStatus: 'active' | 'all' = 'active',
): Promise<CardRecord[]> {
  const db = getBotDb();
  if (!db) return [];

  const query = db
    .from('community_cards')
    .select('id,rarity,title,class,archetype,card_image_url,card_number,status,is_active,is_tradeable,created_at,sold_at,sold_for')
    .eq('workspace_id', workspaceId)
    .eq('user_id', discordId)
    .order('created_at', { ascending: false });

  if (includeStatus === 'active') {
    query.eq('status', 'active');
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map(r => ({
    id:           r.id as string,
    rarity:       r.rarity as string,
    title:        r.title as string,
    cardClass:    r.class as string | null,
    archetype:    r.archetype as string | null,
    cardImageUrl: r.card_image_url as string | null,
    cardNumber:   r.card_number as number | null,
    status:       r.status as string,
    isActive:     r.is_active as boolean,
    isTradeable:  r.is_tradeable as boolean,
    createdAt:    r.created_at as string,
    soldAt:       r.sold_at as string | null,
    soldFor:      r.sold_for as number | null,
  }));
}

export interface SellResult {
  ok:            boolean;
  coinsAwarded?: number;
  newBalance?:   number;
  error?:        'not_found' | 'already_sold' | 'not_owner' | 'in_active_trade' | 'no_db' | string;
}

export async function sellCard(
  workspaceId: string,
  discordId:   string,
  cardId:      string,
): Promise<SellResult> {
  const db = getBotDb();
  if (!db) return { ok: false, error: 'no_db' };

  // Verify ownership + status
  const { data: card, error: fetchErr } = await db
    .from('community_cards')
    .select('id,rarity,status,user_id')
    .eq('id', cardId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (fetchErr || !card) return { ok: false, error: 'not_found' };
  if ((card.user_id as string) !== discordId) return { ok: false, error: 'not_owner' };
  if ((card.status as string) === 'sold') return { ok: false, error: 'already_sold' };

  // Check for active trades
  const { count: tradeCount } = await db
    .from('card_trades')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .or(`offered_card_id.eq.${cardId},requested_card_id.eq.${cardId}`)
    .eq('status', 'pending');

  if ((tradeCount ?? 0) > 0) return { ok: false, error: 'in_active_trade' };

  const price = getSellPrice(card.rarity as string);
  const now   = new Date().toISOString();

  // Atomic sell: WHERE status='active' prevents double-payout
  const { data: updated } = await db
    .from('community_cards')
    .update({
      status:       'sold',
      sold_at:      now,
      sold_for:     price,
      is_active:    false,
      is_tradeable: false,
      updated_at:   now,
    })
    .eq('id', cardId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .select('id');

  if (!updated || updated.length === 0) return { ok: false, error: 'already_sold' };

  // Clear showcase if this card was set as showcase
  await db
    .from('community_members')
    .update({ showcase_card_id: null })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .eq('showcase_card_id', cardId);

  // Award coins
  const { ok, newBalance } = await awardCoins(discordId, price, 'card_sale', {
    workspaceId,
    cardId,
    rarity: card.rarity,
    soldFor: price,
  });

  // Audit log
  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'discord_bot',
    event_type:   'CARD_SOLD',
    title:        `${card.rarity} kort solgt av ${discordId} for ${price} coins`,
    severity:     'info',
    metadata:     { discordId, cardId, rarity: card.rarity, price },
  }).then(null, () => {});

  return { ok, coinsAwarded: price, newBalance };
}

export interface ShowcaseResult {
  ok:     boolean;
  title?: string;
  error?: 'not_found' | 'not_owner' | 'sold' | 'no_db' | string;
}

export async function setShowcaseCard(
  workspaceId: string,
  discordId:   string,
  cardId:      string,
): Promise<ShowcaseResult> {
  const db = getBotDb();
  if (!db) return { ok: false, error: 'no_db' };

  const { data: card, error: fetchErr } = await db
    .from('community_cards')
    .select('id,rarity,status,user_id,title')
    .eq('id', cardId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (fetchErr || !card) return { ok: false, error: 'not_found' };
  if ((card.user_id as string) !== discordId) return { ok: false, error: 'not_owner' };
  if ((card.status as string) === 'sold') return { ok: false, error: 'sold' };

  const { error } = await db
    .from('community_members')
    .update({ showcase_card_id: cardId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId);

  if (error) return { ok: false, error: error.message };

  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'discord_bot',
    event_type:   'CARD_SHOWCASE_SET',
    title:        `Showcase satt til ${card.rarity} "${card.title}" av ${discordId}`,
    severity:     'info',
    metadata:     { discordId, cardId, rarity: card.rarity, title: card.title },
  }).then(null, () => {});

  return { ok: true, title: card.title as string };
}

export async function getShowcaseCard(
  workspaceId: string,
  discordId:   string,
): Promise<CardRecord | null> {
  const db = getBotDb();
  if (!db) return null;

  const { data: member } = await db
    .from('community_members')
    .select('showcase_card_id')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .maybeSingle();

  if (!member?.showcase_card_id) return null;

  const { data: card } = await db
    .from('community_cards')
    .select('id,rarity,title,class,archetype,card_image_url,card_number,status,is_active,is_tradeable,created_at,sold_at,sold_for')
    .eq('id', member.showcase_card_id as string)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!card || (card.status as string) === 'sold') return null;

  return {
    id:           card.id as string,
    rarity:       card.rarity as string,
    title:        card.title as string,
    cardClass:    card.class as string | null,
    archetype:    card.archetype as string | null,
    cardImageUrl: card.card_image_url as string | null,
    cardNumber:   card.card_number as number | null,
    status:       card.status as string,
    isActive:     card.is_active as boolean,
    isTradeable:  card.is_tradeable as boolean,
    createdAt:    card.created_at as string,
    soldAt:       card.sold_at as string | null,
    soldFor:      card.sold_for as number | null,
  };
}
