-- GLENVEX Coins + Card Collection System
-- Idempotent — safe to run multiple times
-- Kjør i Supabase SQL Editor

-- ─── 1. Oppdater community_members med coins + sub-status ────────────────────

ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS coins_balance       INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_coins_earned  INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_coins_spent   INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS twitch_sub_status   BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS twitch_sub_tier     TEXT,
  ADD COLUMN IF NOT EXISTS last_coin_earned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nickname            TEXT,
  ADD COLUMN IF NOT EXISTS top_role            TEXT      NOT NULL DEFAULT 'MEMBER';

-- ─── 2. Coin-transaksjonslogg (aldri oppdater, bare insert) ─────────────────

CREATE TABLE IF NOT EXISTS community_coin_transactions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  source         TEXT        NOT NULL,
  -- Positive = earned, negative = spent
  amount         INTEGER     NOT NULL,
  balance_after  INTEGER     NOT NULL,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_tx_user
  ON community_coin_transactions (workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coin_tx_source
  ON community_coin_transactions (workspace_id, source, created_at DESC);

-- ─── 3. Kortsamling — alle kort alle brukere noensinne har fått ─────────────
-- card_type: persona | sub | achievement | milestone | event
-- source:    generated | reroll | twitch_sub | achievement | milestone | admin

CREATE TABLE IF NOT EXISTS community_cards (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  card_type      TEXT        NOT NULL DEFAULT 'persona',
  rarity         TEXT        NOT NULL DEFAULT 'Common',
  title          TEXT        NOT NULL,
  class          TEXT,
  archetype      TEXT,
  card_image_url TEXT,
  card_number    INTEGER,
  season         TEXT        NOT NULL DEFAULT 'season_1',
  source         TEXT        NOT NULL DEFAULT 'generated',
  is_active      BOOLEAN     NOT NULL DEFAULT false,
  is_tradeable   BOOLEAN     NOT NULL DEFAULT true,
  stats          JSONB,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_cards_user
  ON community_cards (workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_cards_active
  ON community_cards (workspace_id, user_id, card_type, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_community_cards_rarity
  ON community_cards (workspace_id, rarity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_cards_type
  ON community_cards (workspace_id, card_type, created_at DESC);

-- ─── 4. Trading-system (skeleton — full UI kommer later) ─────────────────────

CREATE TABLE IF NOT EXISTS community_card_trade_offers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL,
  from_user_id     TEXT        NOT NULL,
  to_user_id       TEXT        NOT NULL,
  offered_card_id  UUID        NOT NULL REFERENCES community_cards(id),
  requested_card_id UUID       REFERENCES community_cards(id),
  offered_coins    INTEGER     NOT NULL DEFAULT 0,
  requested_coins  INTEGER     NOT NULL DEFAULT 0,
  -- status: pending | accepted | declined | cancelled | expired
  status           TEXT        NOT NULL DEFAULT 'pending',
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_offers_user
  ON community_card_trade_offers (workspace_id, from_user_id, status);

CREATE INDEX IF NOT EXISTS idx_trade_offers_target
  ON community_card_trade_offers (workspace_id, to_user_id, status);

-- ─── 5. Nyttige views ────────────────────────────────────────────────────────

-- Rarity-distribution per bruker
CREATE OR REPLACE VIEW community_card_rarity_counts AS
SELECT
  workspace_id,
  user_id,
  COUNT(*) FILTER (WHERE rarity = 'Common')    AS common_count,
  COUNT(*) FILTER (WHERE rarity = 'Rare')      AS rare_count,
  COUNT(*) FILTER (WHERE rarity = 'Epic')      AS epic_count,
  COUNT(*) FILTER (WHERE rarity = 'Legendary') AS legendary_count,
  COUNT(*) FILTER (WHERE rarity = 'Mythic')    AS mythic_count,
  COUNT(*) AS total_cards
FROM community_cards
GROUP BY workspace_id, user_id;

-- Bruker-oversikt med coins + kortstatistikk (for Community Manager)
CREATE OR REPLACE VIEW community_member_overview AS
SELECT
  m.discord_id,
  m.workspace_id,
  m.display_name,
  m.username,
  m.nickname,
  m.top_role,
  m.xp,
  m.level,
  m.coins_balance,
  m.total_coins_earned,
  m.total_coins_spent,
  m.twitch_sub_status,
  m.badges,
  m.streak_days,
  m.joined_at,
  m.last_seen,
  COALESCE(rc.total_cards, 0) AS total_cards,
  COALESCE(rc.common_count, 0) AS common_cards,
  COALESCE(rc.rare_count, 0) AS rare_cards,
  COALESCE(rc.epic_count, 0) AS epic_cards,
  COALESCE(rc.legendary_count, 0) AS legendary_cards,
  COALESCE(rc.mythic_count, 0) AS mythic_cards,
  ac.card_image_url AS active_card_image_url,
  ac.title AS active_card_title,
  ac.rarity AS active_card_rarity
FROM community_members m
LEFT JOIN community_card_rarity_counts rc
  ON rc.workspace_id = m.workspace_id AND rc.user_id = m.discord_id
LEFT JOIN community_cards ac
  ON ac.workspace_id = m.workspace_id AND ac.user_id = m.discord_id
  AND ac.card_type = 'persona' AND ac.is_active = true;
