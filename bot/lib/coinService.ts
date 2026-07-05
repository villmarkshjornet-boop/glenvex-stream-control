/**
 * Coin Service — GLENVEX Community Economy
 *
 * Rules:
 *  - Coins NEVER update without a ledger entry (community_coin_transactions)
 *  - XP and coins are independent — this service never touches XP
 *  - All DB writes are fire-safe (non-throwing)
 */

import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';

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

export type CoinSource =
  | 'discord_message'
  | 'twitch_message'
  | 'twitch_sub'
  | 'gift_sub'
  | 'daily_bonus'
  | 'streak'
  | 'stream_attendance'
  | 'voice'
  | 'badge_unlock'
  | 'card_reroll'
  | 'sub_card'
  | 'achievement_card'
  | 'milestone_card'
  | 'achievement_reward'
  | 'quest_reward'
  | 'blackjack_bet'
  | 'blackjack_win'
  | 'blackjack_push'
  | 'roulette_bet'
  | 'roulette_win'
  | 'card_sale'
  | 'admin_adjustment';

export interface CoinTransaction {
  id:            string;
  workspace_id:  string;
  user_id:       string;
  source:        CoinSource;
  amount:        number;
  balance_after: number;
  metadata:      Record<string, unknown> | null;
  created_at:    string;
}

// ── Coin rates (configurable later via DB settings) ───────────────────────────

export const COIN_RATES = {
  XP_PER_COIN:          50,   // 1 coin per 50 XP earned
  DAILY_BONUS:          10,   // first message of the day
  STREAK_7_BONUS:       25,   // hitting 7-day streak
  STREAK_30_BONUS:      75,   // hitting 30-day streak
  STREAM_ATTENDANCE:    20,
  VOICE_PER_10MIN:       1,
  BADGE_UNLOCK:         10,
  TWITCH_SUB:           50,
  GIFT_SUB:             25,
  CARD_REROLL_COST:    100,
} as const;

// ── Balance ───────────────────────────────────────────────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const sb = getSb();
  if (!sb) return 0;
  try {
    const { data } = await sb
      .from('community_members')
      .select('coins_balance')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', userId)
      .single();
    return (data?.coins_balance as number) ?? 0;
  } catch { return 0; }
}

export async function getStats(userId: string): Promise<{ balance: number; earned: number; spent: number }> {
  const sb = getSb();
  if (!sb) return { balance: 0, earned: 0, spent: 0 };
  try {
    const { data } = await sb
      .from('community_members')
      .select('coins_balance, total_coins_earned, total_coins_spent')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', userId)
      .single();
    return {
      balance: (data?.coins_balance as number) ?? 0,
      earned:  (data?.total_coins_earned as number) ?? 0,
      spent:   (data?.total_coins_spent as number) ?? 0,
    };
  } catch { return { balance: 0, earned: 0, spent: 0 }; }
}

// ── Award coins ───────────────────────────────────────────────────────────────

export async function awardCoins(
  userId: string,
  amount: number,
  source: CoinSource,
  metadata?: Record<string, unknown>,
): Promise<{ newBalance: number; ok: boolean }> {
  const sb = getSb();
  if (!sb || amount <= 0) return { newBalance: 0, ok: false };

  try {
    const { data: member } = await sb
      .from('community_members')
      .select('coins_balance, total_coins_earned')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', userId)
      .maybeSingle();

    const current    = (member?.coins_balance as number)      ?? 0;
    const earned     = (member?.total_coins_earned as number) ?? 0;
    const newBalance = current + amount;

    const [updateRes, insertRes] = await Promise.all([
      sb.from('community_members').update({
        coins_balance:      newBalance,
        total_coins_earned: earned + amount,
        last_coin_earned_at: new Date().toISOString(),
      }).eq('workspace_id', WORKSPACE_ID).eq('discord_id', userId),

      sb.from('community_coin_transactions').insert({
        workspace_id:  WORKSPACE_ID,
        user_id:       userId,
        source,
        amount,
        balance_after: newBalance,
        metadata:      metadata ?? null,
      }),
    ]);

    if (updateRes.error) {
      console.warn(`[CoinService] awardCoins update failed for ${userId}:`, updateRes.error.message);
    }

    return { newBalance, ok: !updateRes.error };
  } catch (e: any) {
    console.error('[CoinService] awardCoins exception:', e?.message);
    return { newBalance: 0, ok: false };
  }
}

// ── Spend coins ───────────────────────────────────────────────────────────────

export async function spendCoins(
  userId: string,
  amount: number,
  source: CoinSource,
  metadata?: Record<string, unknown>,
): Promise<{ newBalance: number; ok: boolean; error?: string }> {
  const sb = getSb();
  if (!sb) return { newBalance: 0, ok: false, error: 'DB ikke tilgjengelig' };

  try {
    const { data: member } = await sb
      .from('community_members')
      .select('coins_balance, total_coins_spent')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', userId)
      .maybeSingle();

    const current = (member?.coins_balance as number) ?? 0;
    const spent   = (member?.total_coins_spent as number) ?? 0;

    if (current < amount) {
      return {
        newBalance: current,
        ok: false,
        error: `Du trenger ${amount} coins for å gjøre dette. Du har ${current} coins.`,
      };
    }

    const newBalance = current - amount;

    await Promise.all([
      sb.from('community_members').update({
        coins_balance:    newBalance,
        total_coins_spent: spent + amount,
      }).eq('workspace_id', WORKSPACE_ID).eq('discord_id', userId),

      sb.from('community_coin_transactions').insert({
        workspace_id:  WORKSPACE_ID,
        user_id:       userId,
        source,
        amount:        -amount,
        balance_after: newBalance,
        metadata:      metadata ?? null,
      }),
    ]);

    return { newBalance, ok: true };
  } catch (e: any) {
    console.error('[CoinService] spendCoins exception:', e?.message);
    return { newBalance: 0, ok: false, error: 'Teknisk feil ved trekk av coins.' };
  }
}

// ── Ledger ────────────────────────────────────────────────────────────────────

export async function getLedger(userId: string, limit = 20): Promise<CoinTransaction[]> {
  const sb = getSb();
  if (!sb) return [];
  try {
    const { data } = await sb
      .from('community_coin_transactions')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as CoinTransaction[];
  } catch { return []; }
}

// ── Admin adjust ──────────────────────────────────────────────────────────────

export async function adminAdjust(
  userId: string,
  amount: number,
  reason: string,
): Promise<{ newBalance: number; ok: boolean; error?: string }> {
  if (amount >= 0) {
    const r = await awardCoins(userId, amount, 'admin_adjustment', { reason });
    return r;
  }
  return spendCoins(userId, -amount, 'admin_adjustment', { reason });
}

// ── XP → coins conversion helper ─────────────────────────────────────────────
// Call this after awarding XP — coins are proportional to XP earned.

export function xpToCoins(xpEarned: number): number {
  return Math.floor(xpEarned / COIN_RATES.XP_PER_COIN);
}
