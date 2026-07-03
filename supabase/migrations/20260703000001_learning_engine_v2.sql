-- Learning Engine V2
-- Extends ai_agent_memory with strength, decay, categories, admin controls.
-- Deduplicates ai_agent_insights via insight_key.
-- Adds engagement delta tracking to ai_agent_decisions (feedback loop).
-- All changes are idempotent (IF NOT EXISTS / DO NOTHING patterns).

-- ─── 1. ai_agent_memory — V2 columns ─────────────────────────────────────────
-- strength:       0.0–1.0, increases with evidence, decays over time
-- decay_rate:     per-day decay fraction (high-frequency memories decay slower)
-- source_count:   how many distinct sources confirmed this (twitch/discord/vod)
-- memory_category: coarse category for dashboard grouping and filtered prompts
-- last_decayed_at: when the decay job last touched this row
-- locked:         admin-set immunity from decay and auto-deletion
-- admin_approved: null=unreviewed, true=confirmed valid, false=rejected
-- importance_boost: admin manual confidence override (+/-)

ALTER TABLE ai_agent_memory
  ADD COLUMN IF NOT EXISTS strength          FLOAT       NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS decay_rate        FLOAT       NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS source_count      INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS memory_category   TEXT        NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS last_decayed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked            BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_approved    BOOLEAN,
  ADD COLUMN IF NOT EXISTS importance_boost  FLOAT       NOT NULL DEFAULT 0.0;

-- Constrain category values
DO $$ BEGIN
  ALTER TABLE ai_agent_memory
    ADD CONSTRAINT ai_agent_memory_category_check
    CHECK (memory_category IN (
      'community','interests','stream','creator',
      'discord','twitch','economy','partner','humor','general'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill sensible strength from existing confidence_score
UPDATE ai_agent_memory
  SET strength = LEAST(1.0, GREATEST(0.1, confidence_score))
  WHERE strength = 1.0 AND confidence_score IS NOT NULL AND confidence_score > 0;

-- Backfill categories from existing memory_type values
UPDATE ai_agent_memory SET memory_category = 'community'  WHERE memory_type IN ('viewer','member','member_profile') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'interests'  WHERE memory_type IN ('topic','joke','community_phrase','meme','game_pattern') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'stream'     WHERE memory_type IN ('stream_pattern','content_pattern','retention_pattern') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'creator'    WHERE memory_type IN ('creator_style','creator_preference','creator_strength','creator_weakness') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'discord'    WHERE memory_type IN ('discord_pattern','channel_pattern') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'twitch'     WHERE memory_type IN ('twitch_pattern','raid_pattern','clip_pattern','hype_pattern') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'economy'    WHERE memory_type IN ('economy_pattern','coin_pattern','xp_pattern','reward_pattern') AND memory_category = 'general';
UPDATE ai_agent_memory SET memory_category = 'partner'    WHERE memory_type IN ('partner_pattern','sponsor_pattern','affiliate_pattern') AND memory_category = 'general';

-- Slow-decay for high-confidence memories (they should stick longer)
UPDATE ai_agent_memory
  SET decay_rate = 0.01
  WHERE confidence_score >= 0.85 OR occurrence_count >= 10;

UPDATE ai_agent_memory
  SET decay_rate = 0.02
  WHERE confidence_score >= 0.70 AND decay_rate = 0.05;

-- Index: decay job (find stale unlocked memories)
CREATE INDEX IF NOT EXISTS idx_ai_agent_memory_decay_job
  ON ai_agent_memory (workspace_id, last_decayed_at, locked)
  WHERE locked = false AND admin_approved IS NOT FALSE;

-- Index: Community Brain dashboard (category view, sorted by strength)
CREATE INDEX IF NOT EXISTS idx_ai_agent_memory_category_strength
  ON ai_agent_memory (workspace_id, memory_category, strength DESC);

-- Index: admin panel (unreviewed memories)
CREATE INDEX IF NOT EXISTS idx_ai_agent_memory_unreviewed
  ON ai_agent_memory (workspace_id, admin_approved)
  WHERE admin_approved IS NULL;

-- ─── 2. ai_agent_insights — deduplication key ────────────────────────────────
-- insight_key prevents identical insights accumulating.
-- Set to a normalized slug of the title so re-generated insights upsert instead of duplicate.

ALTER TABLE ai_agent_insights
  ADD COLUMN IF NOT EXISTS insight_key     TEXT,
  ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS strength        FLOAT NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS admin_approved  BOOLEAN;

-- Backfill insight_key from existing titles (lowercase, strip non-alphanumeric except spaces)
UPDATE ai_agent_insights
  SET insight_key = LOWER(REGEXP_REPLACE(title, '[^a-z0-9 ]', '', 'gi'))
  WHERE insight_key IS NULL AND title IS NOT NULL AND title <> '';

-- Deduplicate: keep most recent row per (workspace_id, insight_key), nullify the rest
-- so the unique index below does not fail on pre-existing duplicate titles.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY workspace_id, insight_key
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM ai_agent_insights
  WHERE insight_key IS NOT NULL AND insight_key <> ''
)
UPDATE ai_agent_insights
  SET insight_key = NULL
  FROM ranked
  WHERE ai_agent_insights.id = ranked.id AND ranked.rn > 1;

-- Partial unique index: dedup by (workspace_id, insight_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_insights_key
  ON ai_agent_insights (workspace_id, insight_key)
  WHERE insight_key IS NOT NULL AND insight_key <> '';

-- ─── 3. ai_agent_decisions — feedback loop ───────────────────────────────────
-- engagement_delta: measured change in viewer count / chat rate after the decision
-- measured_at: when the measurement was taken (typically ~30 min after decision)
-- These columns close the feedback loop for the AI decision engine.

ALTER TABLE ai_agent_decisions
  ADD COLUMN IF NOT EXISTS engagement_delta  FLOAT,
  ADD COLUMN IF NOT EXISTS measured_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_approved    BOOLEAN;

-- ─── 4. creator_knowledge — decay support ────────────────────────────────────
ALTER TABLE creator_knowledge
  ADD COLUMN IF NOT EXISTS last_decayed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_approved   BOOLEAN,
  ADD COLUMN IF NOT EXISTS strength         FLOAT   NOT NULL DEFAULT 1.0;

-- Backfill strength from confidence
UPDATE creator_knowledge
  SET strength = LEAST(1.0, GREATEST(0.1, confidence::float / 100.0))
  WHERE strength = 1.0 AND confidence > 0;

-- ─── 5. cross_platform_users — richer identity fusion ────────────────────────
ALTER TABLE cross_platform_users
  ADD COLUMN IF NOT EXISTS twitch_user_id   TEXT,
  ADD COLUMN IF NOT EXISTS discord_user_id  TEXT,
  ADD COLUMN IF NOT EXISTS match_method     TEXT NOT NULL DEFAULT 'username',
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_confirmed  BOOLEAN;

-- Index: look up by either platform ID
CREATE INDEX IF NOT EXISTS idx_cross_platform_twitch_id
  ON cross_platform_users (workspace_id, twitch_user_id)
  WHERE twitch_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cross_platform_discord_id
  ON cross_platform_users (workspace_id, discord_user_id)
  WHERE discord_user_id IS NOT NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
