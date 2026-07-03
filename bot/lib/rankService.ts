/**
 * RankService — maps XP level to rank bands.
 * Reads rank config from community_ranks table (workspace-specific).
 * Falls back to built-in defaults if workspace has no config.
 * Seeding: call seedDefaultRanks() once per workspace at bot startup.
 */

import { getBotDb } from './supabase';

export interface RankBand {
  levelMin: number;
  levelMax: number;
  rankName: string;
  rankIcon: string;
  color: string;
}

export interface RankInfo {
  rankName: string;
  rankIcon: string;
  color: string;
  levelMin: number;
  levelMax: number;
}

const DEFAULT_RANKS: RankBand[] = [
  { levelMin: 1,   levelMax: 10,  rankName: 'Noob',     rankIcon: '🌱', color: '#6b7280' },
  { levelMin: 11,  levelMax: 20,  rankName: 'Rookie',   rankIcon: '🔰', color: '#3b82f6' },
  { levelMin: 21,  levelMax: 30,  rankName: 'Explorer', rankIcon: '🧭', color: '#10b981' },
  { levelMin: 31,  levelMax: 40,  rankName: 'Survivor', rankIcon: '⚔️',  color: '#f59e0b' },
  { levelMin: 41,  levelMax: 50,  rankName: 'Veteran',  rankIcon: '🛡️',  color: '#8b5cf6' },
  { levelMin: 51,  levelMax: 60,  rankName: 'Elite',    rankIcon: '💎', color: '#ec4899' },
  { levelMin: 61,  levelMax: 75,  rankName: 'Legend',   rankIcon: '🌟', color: '#f97316' },
  { levelMin: 76,  levelMax: 100, rankName: 'Mythic',   rankIcon: '👑', color: '#ef4444' },
];

function getRankFromBands(level: number, bands: RankBand[]): RankInfo {
  const band = bands.find(b => level >= b.levelMin && level <= b.levelMax)
    ?? bands[bands.length - 1];
  return {
    rankName: band.rankName,
    rankIcon: band.rankIcon,
    color:    band.color,
    levelMin: band.levelMin,
    levelMax: band.levelMax,
  };
}

export async function getRankForLevel(workspaceId: string, level: number): Promise<RankInfo> {
  const db = getBotDb();
  if (!db) return getRankFromBands(level, DEFAULT_RANKS);

  const { data, error } = await db
    .from('community_ranks')
    .select('level_min,level_max,rank_name,rank_icon,color')
    .eq('workspace_id', workspaceId)
    .order('level_min', { ascending: true });

  if (error || !data || data.length === 0) {
    return getRankFromBands(level, DEFAULT_RANKS);
  }

  const bands: RankBand[] = data.map(r => ({
    levelMin: r.level_min as number,
    levelMax: r.level_max as number,
    rankName: r.rank_name as string,
    rankIcon: r.rank_icon as string,
    color:    (r.color as string | null) ?? '#6b7280',
  }));

  return getRankFromBands(level, bands);
}

/** Call once at bot startup for a workspace to ensure rank rows exist. */
export async function seedDefaultRanks(workspaceId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  const { count } = await db
    .from('community_ranks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_RANKS.map(r => ({
    workspace_id: workspaceId,
    level_min:    r.levelMin,
    level_max:    r.levelMax,
    rank_name:    r.rankName,
    rank_icon:    r.rankIcon,
    color:        r.color,
  }));

  const { error } = await db.from('community_ranks').insert(rows);
  if (error) console.error('[RankService] seedDefaultRanks failed:', error.message);
  else console.log(`[RankService] Seeded ${rows.length} default ranks for workspace ${workspaceId}`);
}

/** Returns prestige display string: '' for level 0, '⭐I' for 1, '⭐⭐II' for 2, etc. */
export function formatPrestige(prestigeLevel: number): string {
  if (prestigeLevel <= 0) return '';
  const stars = '⭐'.repeat(Math.min(prestigeLevel, 5));
  const numerals = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
  const numeral = numerals[Math.min(prestigeLevel - 1, numerals.length - 1)];
  return `${stars}${numeral}`;
}
