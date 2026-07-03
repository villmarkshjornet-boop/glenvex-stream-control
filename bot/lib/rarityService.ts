/**
 * RarityService — probability-based card rarity draw with pity system.
 * Default odds: Common 55% / Uncommon 28% / Rare 12% / Epic 4% / Legendary 0.9% / Mythic 0.1%
 *
 * Pity rules:
 * - 5+ Commons in a row   → guarantee Uncommon minimum
 * - 15+ draws without Rare → guarantee Rare minimum
 * - 40+ draws without Epic → double Epic weight
 */

import { getBotDb } from './supabase';

export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

export interface RarityDrawResult {
  rarity:        CardRarity;
  pitySaved:     boolean;
  pitySavedFrom: string | null;
  totalDraws:    number;
}

interface OddsEntry { rarity: CardRarity; weight: number }

const BASE_ODDS: OddsEntry[] = [
  { rarity: 'Mythic',    weight: 0.1  },
  { rarity: 'Legendary', weight: 0.9  },
  { rarity: 'Epic',      weight: 4.0  },
  { rarity: 'Rare',      weight: 12.0 },
  { rarity: 'Uncommon',  weight: 28.0 },
  { rarity: 'Common',    weight: 55.0 },
];

const RARITY_RANK: Record<CardRarity, number> = {
  'Common': 0, 'Uncommon': 1, 'Rare': 2, 'Epic': 3, 'Legendary': 4, 'Mythic': 5,
};

function rollFromOdds(odds: OddsEntry[]): CardRarity {
  const total = odds.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const { rarity, weight } of odds) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'Common';
}

export async function drawRarity(
  workspaceId: string,
  discordId:   string,
): Promise<RarityDrawResult> {
  const db = getBotDb();

  let commonStreak     = 0;
  let drawsWithoutRare = 0;
  let drawsWithoutEpic = 0;
  let totalDraws       = 0;

  if (db) {
    const { data: m } = await db
      .from('community_members')
      .select('pity_common_streak,pity_draws_without_rare,pity_draws_without_epic,pity_total_draws')
      .eq('workspace_id', workspaceId)
      .eq('discord_id', discordId)
      .maybeSingle();

    if (m) {
      commonStreak     = (m.pity_common_streak      as number | null) ?? 0;
      drawsWithoutRare = (m.pity_draws_without_rare as number | null) ?? 0;
      drawsWithoutEpic = (m.pity_draws_without_epic as number | null) ?? 0;
      totalDraws       = (m.pity_total_draws        as number | null) ?? 0;
    }
  }

  // Build odds with pity modifications
  let odds = [...BASE_ODDS];
  let pitySaved     = false;
  let pitySavedFrom: string | null = null;
  let minimumRarity: CardRarity | null = null;

  if (commonStreak >= 5) {
    minimumRarity = 'Uncommon';
    pitySavedFrom = `${commonStreak} Common på rad`;
  }

  if (drawsWithoutRare >= 15) {
    if (!minimumRarity || RARITY_RANK['Rare'] > RARITY_RANK[minimumRarity]) {
      minimumRarity = 'Rare';
      pitySavedFrom = `${drawsWithoutRare} trekk uten Rare`;
    }
  }

  if (drawsWithoutEpic >= 40) {
    const epicBonus = BASE_ODDS.find(o => o.rarity === 'Epic')!.weight;
    odds = odds.map(o => {
      if (o.rarity === 'Epic')   return { ...o, weight: o.weight + epicBonus };
      if (o.rarity === 'Common') return { ...o, weight: Math.max(1, o.weight - epicBonus) };
      return o;
    });
  }

  let result = rollFromOdds(odds);

  if (minimumRarity && RARITY_RANK[result] < RARITY_RANK[minimumRarity]) {
    result    = minimumRarity;
    pitySaved = true;
  }

  // Update pity counters
  if (db) {
    await db
      .from('community_members')
      .update({
        pity_common_streak:      result === 'Common' ? commonStreak + 1 : 0,
        pity_draws_without_rare: RARITY_RANK[result] >= RARITY_RANK['Rare'] ? 0 : drawsWithoutRare + 1,
        pity_draws_without_epic: RARITY_RANK[result] >= RARITY_RANK['Epic'] ? 0 : drawsWithoutEpic + 1,
        pity_total_draws:        totalDraws + 1,
        updated_at:              new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('discord_id', discordId);
  }

  return { rarity: result, pitySaved, pitySavedFrom, totalDraws: totalDraws + 1 };
}

/** For display — rarity to emoji banner */
export const RARITY_DISPLAY: Record<CardRarity, { emoji: string; color: number }> = {
  Common:    { emoji: '⬜', color: 0x9ca3af },
  Uncommon:  { emoji: '🟩', color: 0x22c55e },
  Rare:      { emoji: '🟦', color: 0x3b82f6 },
  Epic:      { emoji: '🟪', color: 0xa855f7 },
  Legendary: { emoji: '🟧', color: 0xf97316 },
  Mythic:    { emoji: '🔴', color: 0xef4444 },
};

export const RARITY_ORDER: CardRarity[] = ['Mythic','Legendary','Epic','Rare','Uncommon','Common'];
