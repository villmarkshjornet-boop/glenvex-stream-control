-- Live Agent V2 — persistent tip storage
-- The continuous bot loop writes here; the dashboard polls it.

CREATE TABLE IF NOT EXISTS live_agent_tips (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  stream_id     TEXT        NOT NULL,    -- Twitch stream/broadcast ID
  category      TEXT        NOT NULL,    -- chat | viewers | promotion | raid | sponsor | content | general
  message       TEXT        NOT NULL,    -- Human-readable tip shown on dashboard
  reasoning     TEXT,                   -- Why this tip was generated (for observability)
  priority      INTEGER     DEFAULT 50, -- 0-100, higher = top of feed
  expires_at    TIMESTAMPTZ,            -- NULL = permanent for this stream
  source        TEXT        DEFAULT 'live_agent',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_agent_tips_stream
  ON live_agent_tips(workspace_id, stream_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_agent_tips_active
  ON live_agent_tips(workspace_id, stream_id, expires_at)
  WHERE expires_at IS NOT NULL;
