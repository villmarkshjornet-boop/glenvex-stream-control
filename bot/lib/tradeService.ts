/**
 * Trade Service — GLENVEX korthandel (skeleton)
 * Full UI/Discord commands comes later.
 * This module provides the DB layer and validation logic.
 */

import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

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

export async function createTradeOffer(_params: {
  fromUserId:        string;
  toUserId:          string;
  offeredCardId:     string;
  requestedCardId?:  string;
  offeredCoins?:     number;
  requestedCoins?:   number;
  expiresInHours?:   number;
}): Promise<TradeOffer | null> {
  // TODO: validate card ownership + tradeability, reserve coins
  console.warn('[TradeService] createTradeOffer not yet implemented');
  return null;
}

export async function acceptTradeOffer(_tradeId: string, _userId: string): Promise<boolean> {
  // TODO: transfer card ownership, exchange coins
  console.warn('[TradeService] acceptTradeOffer not yet implemented');
  return false;
}

export async function declineTradeOffer(_tradeId: string, _userId: string): Promise<boolean> {
  // TODO: update status to declined
  console.warn('[TradeService] declineTradeOffer not yet implemented');
  return false;
}

export async function cancelTradeOffer(_tradeId: string, _userId: string): Promise<boolean> {
  // TODO: only from_user can cancel
  console.warn('[TradeService] cancelTradeOffer not yet implemented');
  return false;
}

export async function getPendingOffers(_userId: string): Promise<TradeOffer[]> {
  // TODO: fetch pending offers where user is sender or receiver
  return [];
}
