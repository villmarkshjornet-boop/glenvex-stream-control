/**
 * RankService — prestige formatting and rank display helpers.
 * Shared between commands and services.
 */

const PRESTIGE_ROMAN: readonly string[] = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
];

/**
 * Format a prestige level as a human-readable string.
 * e.g. formatPrestige(1) → "Prestige I"
 *      formatPrestige(11) → "Prestige 11"
 */
export function formatPrestige(level: number): string {
  if (level <= 0) return '';
  const roman = PRESTIGE_ROMAN[level];
  return roman ? `Prestige ${roman}` : `Prestige ${level}`;
}

/** Prestige icon based on level. */
export function prestigeIcon(level: number): string {
  if (level >= 10) return '🌠';
  if (level >= 5)  return '💫';
  if (level >= 3)  return '🌟';
  if (level >= 1)  return '⭐';
  return '';
}

/** Full prestige display string with icon. */
export function prestigeDisplay(level: number): string {
  if (level <= 0) return '';
  return `${prestigeIcon(level)} ${formatPrestige(level)}`;
}
