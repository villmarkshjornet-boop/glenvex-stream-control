// ── Single source of truth for XP / level calculations ───────────────────────
// Both the Discord bot and the web app import from here.
// Bot tsconfig.bot.json includes src/lib/** and maps @/* → src/

export const XP_PER_LEVEL = 250;

export function levelFromXP(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

/** XP accumulated within the current level (0 … XP_PER_LEVEL - 1). */
export function xpIntoCurrentLevel(xp: number): number {
  return Math.max(0, xp) % XP_PER_LEVEL;
}

/** XP required to go from any level to the next (constant = XP_PER_LEVEL). */
export function xpRequiredForNextLevel(): number {
  return XP_PER_LEVEL;
}

/** Progress through the current level as an integer 0–100. */
export function levelProgress(xp: number): number {
  return Math.min(100, Math.max(0, Math.round((xpIntoCurrentLevel(xp) / XP_PER_LEVEL) * 100)));
}

// ── Inline sanity assertions ─────────────────────────────────────────────────
// Throws on first import if XP_PER_LEVEL is ever changed to a wrong value.
(function selfTest() {
  const cases: [number, number][] = [[0, 1], [249, 1], [250, 2], [500, 3]];
  for (const [xp, want] of cases) {
    const got = levelFromXP(xp);
    if (got !== want)
      throw new Error(`[xp.ts] levelFromXP(${xp}) = ${got}, expected ${want}. Check XP_PER_LEVEL.`);
  }
})();
