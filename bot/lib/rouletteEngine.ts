/**
 * RouletteEngine — European single-zero roulette.
 * Mathematically correct odds. Server-side RNG only. All spins logged.
 * No real money. No odd manipulation.
 */

import { getBotDb } from './supabase';
import { spendCoins, awardCoins, CoinSource } from './coinService';

export type RouletteColor = 'red' | 'black' | 'green';
export type BetType = 'number' | 'red' | 'black' | 'green' | 'odd' | 'even' | '1to18' | '19to36' | 'dozen1' | 'dozen2' | 'dozen3';

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export function getNumberColor(n: number): RouletteColor {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export function calculatePayout(betType: BetType, betTarget: string | null, result: number): number {
  const color = getNumberColor(result);

  switch (betType) {
    case 'number': {
      const target = parseInt(betTarget ?? '-1', 10);
      return result === target ? 35 : -1;
    }
    case 'green':   return result === 0 ? 35 : -1;
    case 'red':     return color === 'red'   ? 1 : -1;
    case 'black':   return color === 'black' ? 1 : -1;
    case 'odd':     return result > 0 && result % 2 === 1 ? 1 : -1;
    case 'even':    return result > 0 && result % 2 === 0 ? 1 : -1;
    case '1to18':   return result >= 1  && result <= 18 ? 1 : -1;
    case '19to36':  return result >= 19 && result <= 36 ? 1 : -1;
    case 'dozen1':  return result >= 1  && result <= 12 ? 2 : -1;
    case 'dozen2':  return result >= 13 && result <= 24 ? 2 : -1;
    case 'dozen3':  return result >= 25 && result <= 36 ? 2 : -1;
    default:        return -1;
  }
}

const cooldowns = new Map<string, number>();

// CoinSource casts for game-specific ledger entries.
// These strings are intentionally outside the CoinSource union so they are
// distinguishable in the DB; the cast is safe — the DB column is text.
const SRC_ROULETTE_BET: CoinSource = ('roulette_bet' as unknown) as CoinSource;
const SRC_ROULETTE_WIN: CoinSource = ('roulette_win' as unknown) as CoinSource;

export async function getCooldownSeconds(workspaceId: string): Promise<number> {
  const db = getBotDb();
  if (!db) return 180;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('roulette_cooldown_minutes')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return ((data?.roulette_cooldown_minutes as number | null) ?? 3) * 60;
}

export async function getBetLimits(workspaceId: string): Promise<{ min: number; max: number }> {
  const db = getBotDb();
  if (!db) return { min: 5, max: 500 };
  const { data } = await db
    .from('workspace_feature_flags')
    .select('roulette_min_bet,roulette_max_bet')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return {
    min: (data?.roulette_min_bet as number | null) ?? 5,
    max: (data?.roulette_max_bet as number | null) ?? 500,
  };
}

export async function isRouletteEnabled(workspaceId: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return true;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('roulette_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data?.roulette_enabled as boolean | null) ?? true;
}

export function checkCooldown(workspaceId: string, discordId: string, cooldownSecs: number): number {
  const key  = `${workspaceId}:${discordId}`;
  const last = cooldowns.get(key);
  if (!last) return 0;
  const elapsed = (Date.now() - last) / 1000;
  return elapsed >= cooldownSecs ? 0 : Math.ceil(cooldownSecs - elapsed);
}

export interface RouletteResult {
  resultNumber: number;
  color:        RouletteColor;
  outcome:      'win' | 'loss';
  coinsDelta:   number;
  newBalance:   number;
  payoutRatio:  number;
}

export async function spinRoulette(
  workspaceId: string,
  discordId:   string,
  bet:         number,
  betType:     BetType,
  betTarget:   string | null,
): Promise<
  | { ok: false; error: 'disabled' | 'cooldown' | 'bet_too_low' | 'bet_too_high' | 'insufficient_coins' | 'invalid_bet'; remaining?: number }
  | { ok: true; result: RouletteResult }
> {
  if (!await isRouletteEnabled(workspaceId)) return { ok: false, error: 'disabled' };

  const cooldownSecs = await getCooldownSeconds(workspaceId);
  const remaining    = checkCooldown(workspaceId, discordId, cooldownSecs);
  if (remaining > 0) return { ok: false, error: 'cooldown', remaining };

  const limits = await getBetLimits(workspaceId);
  if (bet < limits.min) return { ok: false, error: 'bet_too_low' };
  if (bet > limits.max) return { ok: false, error: 'bet_too_high' };

  // Validate number bet target
  if (betType === 'number') {
    const t = parseInt(betTarget ?? '', 10);
    if (isNaN(t) || t < 0 || t > 36) return { ok: false, error: 'invalid_bet' };
  }

  // Deduct bet
  const spend = await spendCoins(discordId, bet, SRC_ROULETTE_BET, { workspaceId, betType, betTarget, bet });
  if (!spend.ok) return { ok: false, error: 'insufficient_coins' };

  cooldowns.set(`${workspaceId}:${discordId}`, Date.now());

  // Server-side RNG — spin the wheel
  const rngValue     = Math.random();
  const resultNumber = Math.floor(rngValue * 37); // 0-36 (1/37 per number, European wheel)

  // Log RNG BEFORE revealing result
  const db = getBotDb();
  let rngLogId: string | null = null;
  if (db) {
    const { data: rngRow } = await db.from('community_rng_log').insert({
      workspace_id: workspaceId,
      game_type:    'roulette',
      discord_id:   discordId,
      rng_value:    rngValue,
      rng_result:   { resultNumber, betType, betTarget },
      context:      'spin',
      logged_at:    new Date().toISOString(),
    }).select('id').maybeSingle();
    rngLogId = (rngRow?.id as string | null) ?? null;
  }

  const color       = getNumberColor(resultNumber);
  const payoutRatio = calculatePayout(betType, betTarget, resultNumber);
  const won         = payoutRatio > 0;
  const coinsDelta  = won ? bet * payoutRatio : -bet;

  if (won) {
    await awardCoins(discordId, bet + bet * payoutRatio, SRC_ROULETTE_WIN, { workspaceId, betType, resultNumber, payoutRatio });
  }

  // Save bet record
  if (db) {
    await db.from('community_roulette_bets').insert({
      workspace_id:  workspaceId,
      discord_id:    discordId,
      bet_type:      betType,
      bet_amount:    bet,
      bet_target:    betTarget,
      result_number: resultNumber,
      outcome:       won ? 'win' : 'loss',
      coins_delta:   coinsDelta,
      rng_log_id:    rngLogId,
      played_at:     new Date().toISOString(),
    }).then(null, (e: Error) => console.error('[Roulette] save bet failed:', e.message));
  }

  const { data: m } = await db?.from('community_members')
    .select('coins_balance')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .maybeSingle() ?? { data: null };

  return {
    ok: true,
    result: {
      resultNumber,
      color,
      outcome:    won ? 'win' : 'loss',
      coinsDelta,
      newBalance: (m?.coins_balance as number | null) ?? spend.newBalance,
      payoutRatio,
    },
  };
}
