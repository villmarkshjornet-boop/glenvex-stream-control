-- Alpha Preparation Sprint — schema additions
-- Run this in Supabase SQL editor before deploying.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS twitch_user_id        TEXT,
  ADD COLUMN IF NOT EXISTS twitch_login          TEXT,
  ADD COLUMN IF NOT EXISTS twitch_display_name   TEXT,
  ADD COLUMN IF NOT EXISTS twitch_profile_image  TEXT,
  ADD COLUMN IF NOT EXISTS twitch_access_token   TEXT,
  ADD COLUMN IF NOT EXISTS twitch_refresh_token  TEXT,
  ADD COLUMN IF NOT EXISTS twitch_connected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discord_guild_name    TEXT,
  ADD COLUMN IF NOT EXISTS discord_connected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alpha_enabled         BOOLEAN DEFAULT FALSE;

-- Admin queries index
CREATE INDEX IF NOT EXISTS idx_workspaces_alpha   ON workspaces(alpha_enabled);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner   ON workspaces(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_twitch  ON workspaces(twitch_login);
