// ── Single source of truth for persona/card rarity ───────────────────────────
// Shared between the Discord bot, API routes, and frontend components.

export type PersonaRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

/** Canonical sort order — highest rarity first. */
export const RARITY_ORDER: PersonaRarity[] = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

/** Minimum score required to reach each rarity tier. */
export const RARITY_SCORE_THRESHOLDS = {
  Mythic:    96,
  Legendary: 86,
  Epic:      71,
  Rare:      51,
} as const;

/** Derive rarity from a computed activity score (0–100+). */
export function rarityFromScore(score: number): PersonaRarity {
  if (score >= RARITY_SCORE_THRESHOLDS.Mythic)    return 'Mythic';
  if (score >= RARITY_SCORE_THRESHOLDS.Legendary) return 'Legendary';
  if (score >= RARITY_SCORE_THRESHOLDS.Epic)      return 'Epic';
  if (score >= RARITY_SCORE_THRESHOLDS.Rare)      return 'Rare';
  return 'Common';
}

/** Discord embed integer colors per rarity. */
export const RARITY_COLOR: Record<PersonaRarity, number> = {
  Common:    0x9e9e9e,
  Rare:      0x1565c0,
  Epic:      0x7b1fa2,
  Legendary: 0xf9a825,
  Mythic:    0xd50000,
};

/** Emoji shorthand per rarity — used in both bot messages and UI. */
export const RARITY_EMOJI: Record<PersonaRarity, string> = {
  Mythic:    '⚡',
  Legendary: '✨',
  Epic:      '🔮',
  Rare:      '💎',
  Common:    '🎴',
};

/** Tailwind CSS badge classes for UI card/badge components. */
export const RARITY_BADGE_CLASSES: Record<PersonaRarity, string> = {
  Mythic:    'text-red-400 bg-red-500/10 border-red-500/30',
  Legendary: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  Epic:      'text-purple-400 bg-purple-500/10 border-purple-500/30',
  Rare:      'text-blue-400 bg-blue-500/10 border-blue-500/30',
  Common:    'text-gray-400 bg-gray-500/10 border-gray-500/30',
};

/** Tailwind CSS border/shadow glow classes for card grid tiles. */
export const RARITY_GLOW_CLASSES: Record<PersonaRarity, string> = {
  Mythic:    'border-red-500/40 shadow-red-500/10',
  Legendary: 'border-yellow-500/40 shadow-yellow-500/10',
  Epic:      'border-purple-500/40 shadow-purple-500/10',
  Rare:      'border-blue-500/40 shadow-blue-500/10',
  Common:    'border-g-border',
};

/** Rank of each rarity for numeric comparison (lower = higher rarity). */
export const RARITY_RANK: Record<PersonaRarity, number> = {
  Mythic: 0, Legendary: 1, Epic: 2, Rare: 3, Common: 4,
};
