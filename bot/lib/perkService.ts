/**
 * PerkService — XP/coins multipliers and bonuses per rank.
 * Reads from community_perks table. Seeds defaults if none exist.
 */

import { getBotDb } from './supabase';

export interface RankPerks {
  rankName:            string;
  xpMultiplier:        number;
  coinsMultiplier:     number;
  lootChanceBonus:     number;
  rerollCostReduction: number;
}

const DEFAULT_PERKS: RankPerks[] = [
  { rankName: 'Noob',     xpMultiplier: 1.0, coinsMultiplier: 1.0, lootChanceBonus: 0.00, rerollCostReduction: 0  },
  { rankName: 'Rookie',   xpMultiplier: 1.1, coinsMultiplier: 1.1, lootChanceBonus: 0.02, rerollCostReduction: 5  },
  { rankName: 'Explorer', xpMultiplier: 1.2, coinsMultiplier: 1.2, lootChanceBonus: 0.05, rerollCostReduction: 10 },
  { rankName: 'Survivor', xpMultiplier: 1.3, coinsMultiplier: 1.3, lootChanceBonus: 0.08, rerollCostReduction: 15 },
  { rankName: 'Veteran',  xpMultiplier: 1.5, coinsMultiplier: 1.5, lootChanceBonus: 0.12, rerollCostReduction: 20 },
  { rankName: 'Elite',    xpMultiplier: 1.75,coinsMultiplier: 1.75,lootChanceBonus: 0.18, rerollCostReduction: 25 },
  { rankName: 'Legend',   xpMultiplier: 2.0, coinsMultiplier: 2.0, lootChanceBonus: 0.25, rerollCostReduction: 35 },
  { rankName: 'Mythic',   xpMultiplier: 2.5, coinsMultiplier: 2.5, lootChanceBonus: 0.35, rerollCostReduction: 50 },
];

export async function getPerksForRank(workspaceId: string, rankName: string): Promise<RankPerks> {
  const db = getBotDb();
  if (!db) return DEFAULT_PERKS.find(p => p.rankName === rankName) ?? DEFAULT_PERKS[0];

  const { data, error } = await db
    .from('community_perks')
    .select('rank_name,xp_multiplier,coins_multiplier,loot_chance_bonus,reroll_cost_reduction')
    .eq('workspace_id', workspaceId)
    .eq('rank_name', rankName)
    .maybeSingle();

  if (error || !data) {
    return DEFAULT_PERKS.find(p => p.rankName === rankName) ?? DEFAULT_PERKS[0];
  }

  return {
    rankName:            data.rank_name as string,
    xpMultiplier:        data.xp_multiplier as number,
    coinsMultiplier:     data.coins_multiplier as number,
    lootChanceBonus:     data.loot_chance_bonus as number,
    rerollCostReduction: data.reroll_cost_reduction as number,
  };
}

export async function seedDefaultPerks(workspaceId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  const { count } = await db
    .from('community_perks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_PERKS.map(p => ({
    workspace_id:          workspaceId,
    rank_name:             p.rankName,
    xp_multiplier:         p.xpMultiplier,
    coins_multiplier:      p.coinsMultiplier,
    loot_chance_bonus:     p.lootChanceBonus,
    reroll_cost_reduction: p.rerollCostReduction,
  }));

  const { error } = await db.from('community_perks').insert(rows);
  if (error) console.error('[PerkService] seedDefaultPerks failed:', error.message);
}

/** Compute actual XP after applying rank multiplier. */
export function applyXpMultiplier(baseXp: number, multiplier: number): number {
  return Math.round(baseXp * multiplier);
}

/** Compute actual coins after applying rank multiplier. */
export function applyCoinsMultiplier(baseCoins: number, multiplier: number): number {
  return Math.round(baseCoins * multiplier);
}
