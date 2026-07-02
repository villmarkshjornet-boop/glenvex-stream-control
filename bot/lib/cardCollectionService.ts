/**
 * Card Collection Service — GLENVEX kortsamling
 *
 * All card types are stored in community_cards.
 * community_personas is kept for backwards compat (active persona lookup).
 * New persona cards are written to BOTH tables.
 *
 * card_type:  persona | sub | achievement | milestone | event
 * source:     generated | reroll | twitch_sub | achievement | milestone | admin
 */

import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const SEASON       = process.env.PERSONA_SEASON ?? 'season_1';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CardType   = 'persona' | 'sub' | 'achievement' | 'milestone' | 'event';
export type CardSource = 'generated' | 'reroll' | 'twitch_sub' | 'achievement' | 'milestone' | 'admin';

export interface CollectionCard {
  id:            string;
  workspace_id:  string;
  user_id:       string;
  card_type:     CardType;
  rarity:        string;
  title:         string;
  class:         string | null;
  archetype:     string | null;
  card_image_url: string | null;
  card_number:   number | null;
  season:        string;
  source:        CardSource;
  is_active:     boolean;
  is_tradeable:  boolean;
  stats:         Record<string, number> | null;
  metadata:      Record<string, unknown> | null;
  created_at:    string;
}

interface AddCardParams {
  userId:       string;
  cardType:     CardType;
  rarity:       string;
  title:        string;
  klass?:       string;
  archetype?:   string;
  imageUrl?:    string | null;
  cardNumber?:  number;
  season?:      string;
  source:       CardSource;
  isActive?:    boolean;
  isTradeable?: boolean;
  stats?:       Record<string, number>;
  metadata?:    Record<string, unknown>;
}

// ── Core operations ───────────────────────────────────────────────────────────

export async function addCardToCollection(p: AddCardParams): Promise<CollectionCard | null> {
  const sb = getSb();
  if (!sb) return null;

  try {
    // Deactivate previous active card of same type when setting new active
    if (p.isActive) {
      await sb.from('community_cards')
        .update({ is_active: false })
        .eq('workspace_id', WORKSPACE_ID)
        .eq('user_id', p.userId)
        .eq('card_type', p.cardType)
        .eq('is_active', true);
    }

    const { data, error } = await sb.from('community_cards').insert({
      workspace_id:  WORKSPACE_ID,
      user_id:       p.userId,
      card_type:     p.cardType,
      rarity:        p.rarity,
      title:         p.title,
      class:         p.klass         ?? null,
      archetype:     p.archetype     ?? null,
      card_image_url: p.imageUrl     ?? null,
      card_number:   p.cardNumber    ?? null,
      season:        p.season        ?? SEASON,
      source:        p.source,
      is_active:     p.isActive      ?? false,
      is_tradeable:  p.isTradeable   ?? true,
      stats:         p.stats         ?? null,
      metadata:      p.metadata      ?? null,
    }).select().single();

    if (error) { console.error('[CardCollection] insert failed:', error.message); return null; }
    return data as CollectionCard;
  } catch (e: any) {
    console.error('[CardCollection] addCardToCollection exception:', e?.message);
    return null;
  }
}

export async function getUserCards(userId: string, limit = 50): Promise<CollectionCard[]> {
  const sb = getSb();
  if (!sb) return [];
  try {
    const { data } = await sb.from('community_cards')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as CollectionCard[];
  } catch { return []; }
}

export async function getUserCardsByType(userId: string, cardType: CardType): Promise<CollectionCard[]> {
  const sb = getSb();
  if (!sb) return [];
  try {
    const { data } = await sb.from('community_cards')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('card_type', cardType)
      .order('created_at', { ascending: false });
    return (data ?? []) as CollectionCard[];
  } catch { return []; }
}

export async function getActiveCard(userId: string, cardType: CardType = 'persona'): Promise<CollectionCard | null> {
  const sb = getSb();
  if (!sb) return null;
  try {
    const { data } = await sb.from('community_cards')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('card_type', cardType)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data ?? null) as CollectionCard | null;
  } catch { return null; }
}

export async function setActiveCard(userId: string, cardId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSb();
  if (!sb) return { ok: false, error: 'DB ikke tilgjengelig' };
  try {
    const { data: card } = await sb.from('community_cards')
      .select('card_type, user_id')
      .eq('id', cardId)
      .eq('workspace_id', WORKSPACE_ID)
      .single();

    if (!card) return { ok: false, error: 'Kortet finnes ikke.' };
    if ((card as any).user_id !== userId) return { ok: false, error: 'Dette er ikke ditt kort.' };

    await sb.from('community_cards')
      .update({ is_active: false })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('card_type', (card as any).card_type);

    const { error } = await sb.from('community_cards')
      .update({ is_active: true })
      .eq('id', cardId);

    return { ok: !error, error: error?.message };
  } catch (e: any) { return { ok: false, error: e?.message }; }
}

export async function getRarityCounts(userId: string): Promise<Record<string, number>> {
  const sb = getSb();
  if (!sb) return {};
  try {
    const { data } = await sb.from('community_cards')
      .select('rarity')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId);
    const counts: Record<string, number> = {};
    for (const row of (data ?? [])) {
      const r = (row as any).rarity as string;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  } catch { return {}; }
}

export async function getTotalCardCount(userId: string): Promise<number> {
  const sb = getSb();
  if (!sb) return 0;
  try {
    const { count } = await sb.from('community_cards')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId);
    return count ?? 0;
  } catch { return 0; }
}

// ── Achievement cards ─────────────────────────────────────────────────────────

export type AchievementId =
  | 'first_message' | 'messages_100' | 'messages_1000'
  | 'streak_7'      | 'streak_30'
  | 'first_voice'   | 'voice_10h'
  | 'first_stream'  | 'streams_25'
  | 'founder'       | 'mvp';

export const ACHIEVEMENT_DEFS: Record<AchievementId, { title: string; rarity: string; coinsBonus: number }> = {
  first_message: { title: 'THE FIRST WORD',    rarity: 'Common',    coinsBonus: 10  },
  messages_100:  { title: 'THE CENTURY',        rarity: 'Rare',      coinsBonus: 25  },
  messages_1000: { title: 'THE WORDSMITH',      rarity: 'Epic',      coinsBonus: 75  },
  streak_7:      { title: 'THE DEDICATED',      rarity: 'Rare',      coinsBonus: 25  },
  streak_30:     { title: 'THE LOYAL',          rarity: 'Epic',      coinsBonus: 75  },
  first_voice:   { title: 'THE VOICE',          rarity: 'Common',    coinsBonus: 10  },
  voice_10h:     { title: 'THE BROADCASTER',    rarity: 'Rare',      coinsBonus: 50  },
  first_stream:  { title: 'THE WITNESS',        rarity: 'Common',    coinsBonus: 10  },
  streams_25:    { title: 'THE TRUE FAN',       rarity: 'Epic',      coinsBonus: 75  },
  founder:       { title: 'THE FOUNDER',        rarity: 'Legendary', coinsBonus: 250 },
  mvp:           { title: 'THE MOST VALUABLE',  rarity: 'Legendary', coinsBonus: 150 },
};

export async function hasAchievementCard(userId: string, achievementId: AchievementId): Promise<boolean> {
  const sb = getSb();
  if (!sb) return false;
  try {
    const { count } = await sb.from('community_cards')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('card_type', 'achievement')
      .eq('metadata->>achievement_id', achievementId);
    return (count ?? 0) > 0;
  } catch { return false; }
}

export async function awardAchievementCard(
  userId: string,
  achievementId: AchievementId,
): Promise<{ card: CollectionCard | null; coinsBonus: number; alreadyHad: boolean }> {
  if (await hasAchievementCard(userId, achievementId)) {
    return { card: null, coinsBonus: 0, alreadyHad: true };
  }
  const def  = ACHIEVEMENT_DEFS[achievementId];
  const card = await addCardToCollection({
    userId,
    cardType:    'achievement',
    rarity:      def.rarity,
    title:       def.title,
    source:      'achievement',
    isActive:    false,
    isTradeable: false,
    metadata:    { achievement_id: achievementId },
  });
  return { card, coinsBonus: def.coinsBonus, alreadyHad: false };
}

// ── Milestone cards ───────────────────────────────────────────────────────────

export type MilestoneId =
  | 'level_10'   | 'level_25'    | 'level_50'   | 'level_100'
  | 'xp_10000'   | 'xp_50000'   | 'xp_100000';

export const MILESTONE_DEFS: Record<MilestoneId, { title: string; rarity: string; coinsBonus: number }> = {
  level_10:   { title: 'THE VETERAN',    rarity: 'Rare',      coinsBonus: 50  },
  level_25:   { title: 'THE CHAMPION',   rarity: 'Epic',      coinsBonus: 100 },
  level_50:   { title: 'THE LEGEND',     rarity: 'Legendary', coinsBonus: 200 },
  level_100:  { title: 'THE ASCENDED',   rarity: 'Mythic',    coinsBonus: 500 },
  xp_10000:   { title: 'THE GRINDER',    rarity: 'Rare',      coinsBonus: 50  },
  xp_50000:   { title: 'THE DEVOTED',    rarity: 'Epic',      coinsBonus: 150 },
  xp_100000:  { title: 'THE IMMORTAL',   rarity: 'Legendary', coinsBonus: 350 },
};

export async function hasMilestoneCard(userId: string, milestoneId: MilestoneId): Promise<boolean> {
  const sb = getSb();
  if (!sb) return false;
  try {
    const { count } = await sb.from('community_cards')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('card_type', 'milestone')
      .eq('metadata->>milestone_id', milestoneId);
    return (count ?? 0) > 0;
  } catch { return false; }
}

export async function awardMilestoneCard(
  userId: string,
  milestoneId: MilestoneId,
): Promise<{ card: CollectionCard | null; coinsBonus: number; alreadyHad: boolean }> {
  if (await hasMilestoneCard(userId, milestoneId)) {
    return { card: null, coinsBonus: 0, alreadyHad: true };
  }
  const def  = MILESTONE_DEFS[milestoneId];
  const card = await addCardToCollection({
    userId,
    cardType:    'milestone',
    rarity:      def.rarity,
    title:       def.title,
    source:      'milestone',
    isActive:    false,
    isTradeable: false,
    metadata:    { milestone_id: milestoneId },
  });
  return { card, coinsBonus: def.coinsBonus, alreadyHad: false };
}

// ── Sub card ──────────────────────────────────────────────────────────────────

export async function awardSubCard(
  userId: string,
  username: string,
  subTier?: string,
): Promise<CollectionCard | null> {
  const tierLabel = subTier === '2000' ? 'TIER 2' : subTier === '3000' ? 'TIER 3' : 'TIER 1';
  return addCardToCollection({
    userId,
    cardType:    'sub',
    rarity:      'Mythic',
    title:       'THE SUBSCRIBER',
    klass:       `${tierLabel} SUPPORTER`,
    source:      'twitch_sub',
    isActive:    false,
    isTradeable: false,
    metadata:    { username, subTier: subTier ?? '1000', awarded_at: new Date().toISOString() },
  });
}

// ── Check milestones after XP/level change ────────────────────────────────────
// Call after awarding XP. Returns any newly earned milestone IDs.

export function checkMilestones(level: number, xp: number): MilestoneId[] {
  const earned: MilestoneId[] = [];
  if (level >= 10)   earned.push('level_10');
  if (level >= 25)   earned.push('level_25');
  if (level >= 50)   earned.push('level_50');
  if (level >= 100)  earned.push('level_100');
  if (xp >= 10000)   earned.push('xp_10000');
  if (xp >= 50000)   earned.push('xp_50000');
  if (xp >= 100000)  earned.push('xp_100000');
  return earned;
}

// ── Check achievements based on member stats ──────────────────────────────────

export function checkAchievements(
  messages: number,
  streakDays: number,
  voiceMinutes: number,
  streamsAttended: number,
  badgeNames: string[],
): AchievementId[] {
  const earned: AchievementId[] = [];
  if (messages >= 1)    earned.push('first_message');
  if (messages >= 100)  earned.push('messages_100');
  if (messages >= 1000) earned.push('messages_1000');
  if (streakDays >= 7)  earned.push('streak_7');
  if (streakDays >= 30) earned.push('streak_30');
  if (voiceMinutes >= 1)    earned.push('first_voice');
  if (voiceMinutes >= 600)  earned.push('voice_10h');   // 600 min = 10 hours
  if (streamsAttended >= 1)  earned.push('first_stream');
  if (streamsAttended >= 25) earned.push('streams_25');
  if (badgeNames.some(b => b.toLowerCase().includes('founder'))) earned.push('founder');
  return earned;
}
