-- Auth migration: link workspaces to Supabase auth users
-- Run this AFTER schema.sql

-- Add owner_user_id to workspaces if not already there
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS owner_user_id UUID;

-- Index for fast user → workspace lookups
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);

-- Store per-user credentials in settings_json (already exists via add-settings.sql)
-- settings_json.credentials will contain:
--   twitch_client_id, twitch_client_secret, twitch_username
--   discord_bot_token, discord_guild_id, discord_invite_url
--   discord_live_channel_id, discord_chat_channel_id
--   discord_clips_channel_id, discord_partner_channel_id

-- No RLS for alpha (using service role key which bypasses RLS anyway)
-- TODO: Add RLS policies before public launch
