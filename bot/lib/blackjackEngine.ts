/**
 * BlackjackEngine — server-side blackjack with coins wagering.
 * All RNG logged. No real money. Cooldown: 5 min (workspace-configurable).
 */

import { getBotDb } from './supabase';
import { spendCoins, awardCoins, CoinSource } from './coinService';

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type CardValue = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A';

export interface Card {
  suit:  Suit;
  value: CardValue;
}

export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'loss';

export interface BlackjackGameState {
  playerCards:   Card[];
  dealerCards:   Card[];
  playerScore:   number;
  dealerScore:   number;
  outcome:       BlackjackOutcome | null;
  canHit:        boolean;
  coinsDelta:    number;
  newBalance:    number;
  remainingDeck: Card[];
}

// In-memory cooldown tracker: `${workspaceId}:${discordId}` → last played ms
const cooldowns = new Map<string, number>();

function makeDeck(): Card[] {
  const suits: Suit[] = ['spades','hearts','diamonds','clubs'];
  const values: CardValue[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return suits.flatMap(s => values.map(v => ({ suit: s, value: v })));
}

function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardNumericValue(card: Card): number {
  if (card.value === 'A') return 11;
  if (['J','Q','K'].includes(card.value)) return 10;
  return parseInt(card.value, 10);
}

function scoreHand(cards: Card[]): number {
  let score = 0;
  let aces  = 0;
  for (const c of cards) {
    if (c.value === 'A') aces++;
    score += cardNumericValue(c);
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && scoreHand(cards) === 21;
}

function cardEmoji(card: Card): string {
  const suitMap: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
  return `${card.value}${suitMap[card.suit]}`;
}

export function formatHand(cards: Card[], hideSecond = false): string {
  return cards.map((c, i) => (i === 1 && hideSecond ? '🂠' : cardEmoji(c))).join(' ');
}

async function logRng(workspaceId: string, discordId: string, rngValue: number, result: unknown, context: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;
  await db.from('community_rng_log').insert({
    workspace_id: workspaceId,
    game_type:    'blackjack',
    discord_id:   discordId,
    rng_value:    rngValue,
    rng_result:   result,
    context,
    logged_at:    new Date().toISOString(),
  }).then(null, (e: Error) => console.error('[Blackjack] rng_log failed:', e.message));
}

async function saveGame(
  workspaceId: string,
  discordId:   string,
  bet:         number,
  outcome:     BlackjackOutcome,
  playerCards: Card[],
  dealerCards: Card[],
  playerScore: number,
  dealerScore: number,
  coinsDelta:  number,
): Promise<void> {
  const db = getBotDb();
  if (!db) return;
  await db.from('community_blackjack_games').insert({
    workspace_id: workspaceId,
    discord_id:   discordId,
    bet_amount:   bet,
    outcome,
    player_cards: playerCards,
    dealer_cards: dealerCards,
    player_score: playerScore,
    dealer_score: dealerScore,
    coins_delta:  coinsDelta,
    played_at:    new Date().toISOString(),
  }).then(null, (e: Error) => console.error('[Blackjack] saveGame failed:', e.message));
}

export async function getCooldownSeconds(workspaceId: string): Promise<number> {
  const db = getBotDb();
  if (!db) return 300;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('blackjack_cooldown_minutes')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return ((data?.blackjack_cooldown_minutes as number | null) ?? 5) * 60;
}

export async function getBetLimits(workspaceId: string): Promise<{ min: number; max: number }> {
  const db = getBotDb();
  if (!db) return { min: 10, max: 1000 };
  const { data } = await db
    .from('workspace_feature_flags')
    .select('blackjack_min_bet,blackjack_max_bet')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return {
    min: (data?.blackjack_min_bet as number | null) ?? 10,
    max: (data?.blackjack_max_bet as number | null) ?? 1000,
  };
}

export async function isBlackjackEnabled(workspaceId: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return true;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('blackjack_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data?.blackjack_enabled as boolean | null) ?? true;
}

export function checkCooldown(workspaceId: string, discordId: string, cooldownSecs: number): number {
  const key = `${workspaceId}:${discordId}`;
  const last = cooldowns.get(key);
  if (!last) return 0;
  const elapsed = (Date.now() - last) / 1000;
  return elapsed >= cooldownSecs ? 0 : Math.ceil(cooldownSecs - elapsed);
}

// CoinSource casts for game-specific ledger entries.
// These strings are intentionally outside the CoinSource union so they are
// distinguishable in the DB; the cast is safe — the DB column is text.
const SRC_BJ_BET:   CoinSource = ('blackjack_bet'   as unknown) as CoinSource;
const SRC_BJ_WIN:   CoinSource = ('blackjack_win'   as unknown) as CoinSource;
const SRC_BJ_PUSH:  CoinSource = ('blackjack_push'  as unknown) as CoinSource;

export async function playBlackjack(
  workspaceId: string,
  discordId:   string,
  bet:         number,
): Promise<
  | { ok: false; error: 'disabled' | 'cooldown' | 'bet_too_low' | 'bet_too_high' | 'insufficient_coins'; remaining?: number }
  | { ok: true; state: BlackjackGameState }
> {
  if (!await isBlackjackEnabled(workspaceId)) return { ok: false, error: 'disabled' };

  const cooldownSecs = await getCooldownSeconds(workspaceId);
  const remaining    = checkCooldown(workspaceId, discordId, cooldownSecs);
  if (remaining > 0) return { ok: false, error: 'cooldown', remaining };

  const limits = await getBetLimits(workspaceId);
  if (bet < limits.min) return { ok: false, error: 'bet_too_low' };
  if (bet > limits.max) return { ok: false, error: 'bet_too_high' };

  // Deduct bet upfront
  const spend = await spendCoins(discordId, bet, SRC_BJ_BET, { workspaceId, bet });
  if (!spend.ok) return { ok: false, error: 'insufficient_coins' };

  // Set cooldown
  cooldowns.set(`${workspaceId}:${discordId}`, Date.now());

  // Deal
  const deck        = shuffleDeck(makeDeck());
  const rngSeed     = Math.random();
  const playerCards = [deck[0]!, deck[2]!];
  const dealerCards = [deck[1]!, deck[3]!];

  await logRng(workspaceId, discordId, rngSeed, { playerCards, dealerCards }, 'initial_deal');

  const playerScore = scoreHand(playerCards);
  const dealerScore = scoreHand(dealerCards);

  // Instant blackjack check
  if (isBlackjack(playerCards)) {
    const payout = Math.floor(bet * 1.5);
    await awardCoins(discordId, bet + payout, SRC_BJ_WIN, { workspaceId, outcome: 'blackjack', bet });
    await saveGame(workspaceId, discordId, bet, 'blackjack', playerCards, dealerCards, playerScore, dealerScore, payout);
    return {
      ok: true,
      state: {
        playerCards, dealerCards, playerScore, dealerScore,
        outcome: 'blackjack', canHit: false,
        coinsDelta: payout, newBalance: spend.newBalance + bet + payout,
        remainingDeck: [],
      },
    };
  }

  // Return state for hit/stand interaction — include remaining deck (cards after initial deal)
  return {
    ok: true,
    state: {
      playerCards, dealerCards, playerScore, dealerScore,
      outcome: null, canHit: playerScore < 21,
      coinsDelta: 0, newBalance: spend.newBalance,
      remainingDeck: deck.slice(4),
    },
  };
}

export async function hitBlackjack(
  workspaceId:   string,
  discordId:     string,
  bet:           number,
  playerCards:   Card[],
  dealerCards:   Card[],
  remainingDeck: Card[],
): Promise<BlackjackGameState> {
  const newCard      = remainingDeck[0]!;
  const updated      = [...playerCards, newCard];
  const deckAfterHit = remainingDeck.slice(1);

  await logRng(workspaceId, discordId, Math.random(), { newCard }, 'hit');

  const playerScore = scoreHand(updated);

  if (playerScore > 21) {
    await saveGame(workspaceId, discordId, bet, 'loss', updated, dealerCards, playerScore, scoreHand(dealerCards), -bet);
    const db = getBotDb();
    const { data: m } = await db?.from('community_members')
      .select('coins_balance')
      .eq('workspace_id', workspaceId)
      .eq('discord_id', discordId)
      .maybeSingle() ?? { data: null };
    return {
      playerCards: updated, dealerCards, playerScore, dealerScore: scoreHand(dealerCards),
      outcome: 'loss', canHit: false, coinsDelta: -bet,
      newBalance: (m?.coins_balance as number | null) ?? 0,
      remainingDeck: deckAfterHit,
    };
  }

  return {
    playerCards: updated, dealerCards, playerScore, dealerScore: scoreHand(dealerCards),
    outcome: null, canHit: playerScore < 21, coinsDelta: 0, newBalance: 0,
    remainingDeck: deckAfterHit,
  };
}

export async function standBlackjack(
  workspaceId:   string,
  discordId:     string,
  bet:           number,
  playerCards:   Card[],
  dealerCards:   Card[],
  remainingDeck: Card[],
): Promise<BlackjackGameState> {
  // Dealer plays
  let dc      = [...dealerCards];
  let deckIdx = 0;
  let dScore  = scoreHand(dc);

  while (dScore < 17) {
    const card = remainingDeck[deckIdx++]!;
    dc.push(card);
    await logRng(workspaceId, discordId, Math.random(), { card }, 'dealer_hit');
    dScore = scoreHand(dc);
  }

  const pScore = scoreHand(playerCards);
  let outcome: BlackjackOutcome;
  let coinsDelta: number;

  if (dScore > 21 || pScore > dScore) {
    outcome    = 'win';
    coinsDelta = bet;
    await awardCoins(discordId, bet * 2, SRC_BJ_WIN, { workspaceId, outcome: 'win', bet });
  } else if (pScore === dScore) {
    outcome    = 'push';
    coinsDelta = 0;
    await awardCoins(discordId, bet, SRC_BJ_PUSH, { workspaceId, outcome: 'push', bet });
  } else {
    outcome    = 'loss';
    coinsDelta = -bet;
  }

  await saveGame(workspaceId, discordId, bet, outcome, playerCards, dc, pScore, dScore, coinsDelta);

  const db = getBotDb();
  const { data: m } = await db?.from('community_members')
    .select('coins_balance')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .maybeSingle() ?? { data: null };

  return {
    playerCards, dealerCards: dc, playerScore: pScore, dealerScore: dScore,
    outcome, canHit: false, coinsDelta,
    newBalance: (m?.coins_balance as number | null) ?? 0,
    remainingDeck: [],
  };
}
