/**
 * Trade Service — GLENVEX korthandel
 * DB table: card_trades (workspace_id, from_user_id, to_user_id,
 *   offered_card_id, requested_card_id, offered_coins, requested_coins,
 *   status, expires_at, created_at, updated_at)
 */

import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';
const TRADE_TTL_HOURS = 24;

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

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface TradeOffer {
  id:                string;
  workspace_id:      string;
  from_user_id:      string;
  to_user_id:        string;
  offered_card_id:   string;
  requested_card_id: string | null;
  offered_coins:     number;
  requested_coins:   number;
  status:            TradeStatus;
  expires_at:        string | null;
  created_at:        string;
  updated_at:        string;
}

export type TradeError =
  | 'db_unavailable'
  | 'card_not_found'
  | 'card_not_tradeable'
  | 'card_not_owned'
  | 'receiver_not_found'
  | 'table_missing'
  | 'db_error';

export interface TradeResult {
  ok:    boolean;
  trade?: TradeOffer;
  error?: TradeError;
  reason?: string;
}

// ── Validate card before trade ────────────────────────────────────────────────

export async function validateCardForTrade(
  cardId: string,
  ownerId: string,
): Promise<{ valid: boolean; card?: any; error?: TradeError; reason?: string }> {
  const sb = getSb();
  if (!sb) return { valid: false, error: 'db_unavailable', reason: 'Database utilgjengelig' };

  const { data: card, error } = await sb
    .from('community_cards')
    .select('id,user_id,title,rarity,is_tradeable,is_active,card_type')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', cardId)
    .single();

  if (error || !card) return { valid: false, error: 'card_not_found', reason: `Kortid "${cardId}" ikke funnet` };
  if (card.user_id !== ownerId) return { valid: false, error: 'card_not_owned', reason: 'Du eier ikke dette kortet' };
  if (!card.is_tradeable) return { valid: false, error: 'card_not_tradeable', reason: 'Dette kortet kan ikke handles' };

  return { valid: true, card };
}

// ── Find card by title (fuzzy) for a specific user ───────────────────────────

export async function findUserCardByTitle(
  userId: string,
  titleQuery: string,
): Promise<any | null> {
  const sb = getSb();
  if (!sb) return null;

  const { data } = await sb
    .from('community_cards')
    .select('id,user_id,title,rarity,is_tradeable,is_active,card_type')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('user_id', userId)
    .ilike('title', `%${titleQuery}%`)
    .eq('is_tradeable', true)
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0] ?? null;
}

// ── Create trade offer ────────────────────────────────────────────────────────

export async function createTradeOffer(params: {
  fromUserId:       string;
  toUserId:         string;
  offeredCardId:    string;
  requestedCardId?: string;
  offeredCoins?:    number;
  requestedCoins?:  number;
  expiresInHours?:  number;
}): Promise<TradeResult> {
  const sb = getSb();
  if (!sb) return { ok: false, error: 'db_unavailable', reason: 'Database utilgjengelig' };

  // Validate offered card
  const v = await validateCardForTrade(params.offeredCardId, params.fromUserId);
  if (!v.valid) return { ok: false, error: v.error, reason: v.reason };

  const expiresAt = new Date(
    Date.now() + (params.expiresInHours ?? TRADE_TTL_HOURS) * 3_600_000,
  ).toISOString();

  const { data, error } = await sb.from('card_trades').insert({
    workspace_id:      WORKSPACE_ID,
    from_user_id:      params.fromUserId,
    to_user_id:        params.toUserId,
    offered_card_id:   params.offeredCardId,
    requested_card_id: params.requestedCardId ?? null,
    offered_coins:     params.offeredCoins    ?? 0,
    requested_coins:   params.requestedCoins  ?? 0,
    status:            'pending',
    expires_at:        expiresAt,
    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }).select().single();

  if (error) {
    const isMissing = error.message?.includes('does not exist') || error.code === '42P01';
    logSystemEvent({
      source: 'trade', event_type: 'TRADE_FAILED',
      title: `createTradeOffer DB-feil: ${error.message}`,
      severity: 'error',
      metadata: { workspace_id: WORKSPACE_ID, from_user: params.fromUserId, to_user: params.toUserId, card_id: params.offeredCardId, reason: error.message },
    });
    return { ok: false, error: isMissing ? 'table_missing' : 'db_error', reason: error.message };
  }

  logSystemEvent({
    source: 'trade', event_type: 'TRADE_OFFER_CREATED',
    title: `Trade tilbud opprettet: ${params.fromUserId} → ${params.toUserId}`,
    severity: 'info',
    metadata: { workspace_id: WORKSPACE_ID, trade_id: data.id, card_id: params.offeredCardId },
  });

  return { ok: true, trade: data as TradeOffer };
}

// ── Accept trade offer ────────────────────────────────────────────────────────

export async function acceptTradeOffer(tradeId: string, userId: string): Promise<TradeResult> {
  const sb = getSb();
  if (!sb) return { ok: false, error: 'db_unavailable', reason: 'Database utilgjengelig' };

  const { data: trade, error: fetchErr } = await sb
    .from('card_trades')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', tradeId)
    .single();

  if (fetchErr || !trade) return { ok: false, error: 'card_not_found', reason: 'Handelstilbud ikke funnet' };
  if (trade.to_user_id !== userId) return { ok: false, error: 'card_not_owned', reason: 'Du kan ikke akseptere dette tilbudet' };
  if (trade.status !== 'pending') return { ok: false, reason: `Tilbud er allerede ${trade.status}` };
  if (trade.expires_at && new Date(trade.expires_at) < new Date()) {
    await sb.from('card_trades').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', tradeId);
    return { ok: false, reason: 'Tilbudet er utløpt' };
  }

  // Validate offered card still owned by from_user
  const v = await validateCardForTrade(trade.offered_card_id, trade.from_user_id);
  if (!v.valid) {
    await sb.from('card_trades').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', tradeId);
    return { ok: false, error: v.error, reason: v.reason };
  }

  // Transfer card ownership
  const { error: transferErr } = await sb
    .from('community_cards')
    .update({ user_id: trade.to_user_id, is_active: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', trade.offered_card_id);

  if (transferErr) {
    logSystemEvent({
      source: 'trade', event_type: 'TRADE_FAILED',
      title: `Korttransfer feilet: ${transferErr.message}`,
      severity: 'error',
      metadata: { workspace_id: WORKSPACE_ID, from_user: trade.from_user_id, to_user: trade.to_user_id, card_id: trade.offered_card_id, reason: transferErr.message },
    });
    return { ok: false, error: 'db_error', reason: transferErr.message };
  }

  await sb.from('card_trades').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', tradeId);

  logSystemEvent({
    source: 'trade', event_type: 'TRADE_COMPLETED',
    title: `Trade fullført: ${v.card?.title} (${v.card?.rarity}) overført fra ${trade.from_user_id} til ${trade.to_user_id}`,
    severity: 'info',
    metadata: { workspace_id: WORKSPACE_ID, trade_id: tradeId, card_id: trade.offered_card_id, from_user: trade.from_user_id, to_user: trade.to_user_id },
  });

  return { ok: true, trade: { ...trade, status: 'accepted' } as TradeOffer };
}

// ── Decline trade offer ───────────────────────────────────────────────────────

export async function declineTradeOffer(tradeId: string, userId: string): Promise<TradeResult> {
  const sb = getSb();
  if (!sb) return { ok: false, error: 'db_unavailable', reason: 'Database utilgjengelig' };

  const { data: trade } = await sb
    .from('card_trades')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', tradeId)
    .single();

  if (!trade) return { ok: false, error: 'card_not_found', reason: 'Handelstilbud ikke funnet' };
  if (trade.to_user_id !== userId && trade.from_user_id !== userId) {
    return { ok: false, error: 'card_not_owned', reason: 'Du kan ikke avslå dette tilbudet' };
  }

  const newStatus: TradeStatus = trade.to_user_id === userId ? 'declined' : 'cancelled';
  await sb.from('card_trades').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', tradeId);

  logSystemEvent({
    source: 'trade', event_type: 'TRADE_FAILED',
    title: `Trade ${newStatus}: ${trade.from_user_id} → ${trade.to_user_id}`,
    severity: 'info',
    metadata: { workspace_id: WORKSPACE_ID, trade_id: tradeId, status: newStatus },
  });

  return { ok: true, trade: { ...trade, status: newStatus } as TradeOffer };
}

// ── Cancel trade offer (from sender) ─────────────────────────────────────────

export async function cancelTradeOffer(tradeId: string, userId: string): Promise<TradeResult> {
  return declineTradeOffer(tradeId, userId);
}

// ── Get pending offers for a user ─────────────────────────────────────────────

export async function getPendingOffers(userId: string): Promise<TradeOffer[]> {
  const sb = getSb();
  if (!sb) return [];

  const { data } = await sb
    .from('card_trades')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'pending')
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  return (data ?? []) as TradeOffer[];
}
