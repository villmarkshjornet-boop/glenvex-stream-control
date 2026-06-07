-- GLENVEX Creator OS — Community Intelligence Migration
-- Extends community_members with full engagement tracking
-- Run this in Supabase SQL Editor

ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS twitch_id        TEXT,
  ADD COLUMN IF NOT EXISTS reactions        INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_minutes    INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streams_attended INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS community_score  INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS joined_at        TIMESTAMPTZ;

-- Backfill joined_at from updated_at where missing (table has no created_at)
UPDATE community_members SET joined_at = updated_at WHERE joined_at IS NULL AND updated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_members_xp
  ON community_members(workspace_id, xp DESC);

CREATE INDEX IF NOT EXISTS idx_community_members_last_seen
  ON community_members(workspace_id, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_community_members_joined_at
  ON community_members(workspace_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_members_engagement
  ON community_members(workspace_id, engagement_score DESC);
