-- GLENVEX AI Persona Card — migrasjonsscript v3
-- Kjør i Supabase SQL Editor: https://supabase.com/dashboard/project/czwxovxmxljabtidttty/sql/new
-- Dropper og gjenskaper tabellene om de eksisterer fra v1/v2

DROP TABLE IF EXISTS community_persona_history;
DROP TABLE IF EXISTS community_personas;

-- ─── Aktiv persona (én per bruker per sesong) ────────────────────────────────
CREATE TABLE community_personas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT NOT NULL,
  discord_id           TEXT NOT NULL,
  username             TEXT NOT NULL,
  display_name         TEXT,
  season               TEXT NOT NULL DEFAULT 'default',

  -- AI-output V2
  persona_title        TEXT,
  persona_class        TEXT,
  archetype            TEXT,
  rarity               TEXT NOT NULL DEFAULT 'Common',
  description          TEXT,
  signature_move       TEXT,
  signature_move_desc  TEXT,
  quote                TEXT,
  flavor_text          TEXT,
  stats                JSONB,
  image_prompt         TEXT,

  -- Generert bilde
  image_url            TEXT,

  -- Metadata
  xp_cost              INTEGER NOT NULL DEFAULT 0,
  reroll_count         INTEGER NOT NULL DEFAULT 0,

  -- Generator-metadata
  generator_version    TEXT DEFAULT 'v2',
  model                TEXT DEFAULT 'gpt-4o-mini',
  image_model          TEXT DEFAULT 'dall-e-3',
  generated_at         TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Én aktiv persona per bruker per sesong
  UNIQUE (workspace_id, discord_id, season)
);

CREATE INDEX idx_community_personas_workspace_discord
  ON community_personas (workspace_id, discord_id);

CREATE INDEX idx_community_personas_rarity
  ON community_personas (workspace_id, rarity, created_at DESC);


-- ─── Persona-historikk (alle genereringer noensinne — aldri slett) ───────────
-- Brukeren ser sin fulle samling på tvers av sesonger:
--   Winter 2026 → Legendary Viking ⭐⭐⭐⭐
--   Spring 2027 → Chaos Goblin ⭐⭐⭐
--   Halloween   → Pumpkin Slayer ⭐⭐⭐⭐⭐
CREATE TABLE community_persona_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT NOT NULL,
  discord_id           TEXT NOT NULL,
  username             TEXT NOT NULL,
  display_name         TEXT,
  season               TEXT NOT NULL DEFAULT 'default',

  -- AI-output V2
  persona_title        TEXT,
  persona_class        TEXT,
  archetype            TEXT,
  rarity               TEXT NOT NULL DEFAULT 'Common',
  description          TEXT,
  signature_move       TEXT,
  signature_move_desc  TEXT,
  quote                TEXT,
  flavor_text          TEXT,
  stats                JSONB,
  image_prompt         TEXT,

  -- Generert bilde
  image_url            TEXT,

  -- Metadata
  xp_cost              INTEGER NOT NULL DEFAULT 0,
  reroll_count         INTEGER NOT NULL DEFAULT 0,

  -- Generator-metadata
  generator_version    TEXT DEFAULT 'v2',
  model                TEXT DEFAULT 'gpt-4o-mini',
  image_model          TEXT DEFAULT 'dall-e-3',
  generated_at         TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_persona_history_user
  ON community_persona_history (workspace_id, discord_id, created_at DESC);

CREATE INDEX idx_persona_history_rarity
  ON community_persona_history (workspace_id, rarity, created_at DESC);
