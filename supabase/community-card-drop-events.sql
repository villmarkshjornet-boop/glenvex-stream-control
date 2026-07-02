-- GLENVEX Community — Card Drop Events logg
-- Idempotent — safe to run multiple times

CREATE TABLE IF NOT EXISTS community_card_drop_events (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            TEXT        NOT NULL,
  user_id                 TEXT        NOT NULL,
  card_id                 TEXT,
  rarity                  TEXT        NOT NULL,
  card_type               TEXT        NOT NULL,
  source                  TEXT        NOT NULL,
  -- source: persona_reroll | sub | achievement | milestone | admin_generate
  discord_channel_posted  BOOLEAN     NOT NULL DEFAULT false,
  dm_sent                 BOOLEAN     NOT NULL DEFAULT false,
  twitch_sent             BOOLEAN     NOT NULL DEFAULT false,
  error                   TEXT,
  metadata                JSONB       NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_drop_events_workspace
  ON community_card_drop_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_drop_events_user
  ON community_card_drop_events (workspace_id, user_id, created_at DESC);

SELECT 'community_card_drop_events opprettet' AS status;
