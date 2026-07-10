-- card_seasons table
CREATE TABLE IF NOT EXISTS card_seasons (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  style_ref    TEXT        NOT NULL DEFAULT '',
  is_active    BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_seasons_workspace ON card_seasons (workspace_id);
CREATE INDEX IF NOT EXISTS idx_card_seasons_active    ON card_seasons (workspace_id, is_active) WHERE is_active = true;

-- Add season tracking to community_cards
ALTER TABLE community_cards
  ADD COLUMN IF NOT EXISTS season_id   UUID REFERENCES card_seasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS season_name TEXT;

CREATE INDEX IF NOT EXISTS idx_community_cards_season ON community_cards (workspace_id, season_id);
