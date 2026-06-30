-- GLENVEX AI Persona Card — migrasjonsscript
-- Kjør i Supabase SQL Editor

CREATE TABLE IF NOT EXISTS community_personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  discord_id       TEXT NOT NULL,
  username         TEXT NOT NULL,
  display_name     TEXT,
  season           TEXT NOT NULL DEFAULT 'default',

  -- AI-output JSON
  persona_title    TEXT,
  persona_class    TEXT,
  rarity           TEXT NOT NULL DEFAULT 'Common',
  description      TEXT,
  strengths        JSONB,
  weaknesses       JSONB,
  signature_move   TEXT,
  quote            TEXT,
  stats            JSONB,
  image_prompt     TEXT,

  -- Generert bilde-URL (DALL-E 3)
  image_url        TEXT,

  -- Metadata
  xp_cost          INTEGER NOT NULL DEFAULT 0,
  reroll_count     INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_personas_workspace_discord
  ON community_personas (workspace_id, discord_id);

CREATE INDEX IF NOT EXISTS idx_community_personas_rarity
  ON community_personas (workspace_id, rarity, created_at DESC);
