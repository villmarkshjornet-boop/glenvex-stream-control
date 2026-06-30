-- GLENVEX AI Persona Card — migrasjonsscript v2
-- Kjør i Supabase SQL Editor: https://supabase.com/dashboard/project/czwxovxmxljabtidttty/sql/new

-- ─── Aktiv persona (én per bruker per sesong) ────────────────────────────────
CREATE TABLE IF NOT EXISTS community_personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  discord_id       TEXT NOT NULL,
  username         TEXT NOT NULL,
  display_name     TEXT,
  season           TEXT NOT NULL DEFAULT 'default',

  -- AI-output
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

  -- Generert bilde
  image_url        TEXT,

  -- Metadata
  xp_cost          INTEGER NOT NULL DEFAULT 0,
  reroll_count     INTEGER NOT NULL DEFAULT 0,

  -- Generator-metadata (gjør fremtidig regenerering mulig)
  generator_version TEXT DEFAULT 'v1',
  model             TEXT DEFAULT 'gpt-4o-mini',
  image_model       TEXT DEFAULT 'dall-e-3',
  generated_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Én aktiv persona per bruker per sesong
  UNIQUE (workspace_id, discord_id, season)
);

CREATE INDEX IF NOT EXISTS idx_community_personas_workspace_discord
  ON community_personas (workspace_id, discord_id);

CREATE INDEX IF NOT EXISTS idx_community_personas_rarity
  ON community_personas (workspace_id, rarity, created_at DESC);


-- ─── Persona-historikk (alle genereringer noensinne) ─────────────────────────
-- Her ser brukeren sin fulle "samling" på tvers av sesonger:
--   Winter 2026 → Legendary Viking ⭐⭐⭐⭐
--   Spring 2027 → Chaos Goblin ⭐⭐⭐
--   Halloween   → Pumpkin Slayer ⭐⭐⭐⭐⭐
CREATE TABLE IF NOT EXISTS community_persona_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  discord_id       TEXT NOT NULL,
  username         TEXT NOT NULL,
  display_name     TEXT,
  season           TEXT NOT NULL DEFAULT 'default',

  -- AI-output
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

  -- Generert bilde
  image_url        TEXT,

  -- Metadata
  xp_cost          INTEGER NOT NULL DEFAULT 0,
  reroll_count     INTEGER NOT NULL DEFAULT 0,

  -- Generator-metadata
  generator_version TEXT DEFAULT 'v1',
  model             TEXT DEFAULT 'gpt-4o-mini',
  image_model       TEXT DEFAULT 'dall-e-3',
  generated_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_persona_history_user
  ON community_persona_history (workspace_id, discord_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_persona_history_rarity
  ON community_persona_history (workspace_id, rarity, created_at DESC);
