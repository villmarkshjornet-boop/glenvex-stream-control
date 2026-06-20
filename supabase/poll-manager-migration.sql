-- Poll Learning Engine — persistent poll storage
-- The Poll Manager writes here; the dashboard reads it.
-- Separate from partner_polls (which is partner-specific, different schema).

CREATE TABLE IF NOT EXISTS poll_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  stream_id     TEXT        NOT NULL,
  poll_type     TEXT        NOT NULL,   -- GAME_PREFERENCE | CONTENT_TYPE | PARTNER_FIT | GIVEAWAY_CHECK | STREAM_DIRECTION | DISCORD_GROWTH
  platform      TEXT        NOT NULL,   -- twitch | discord | both
  question      TEXT        NOT NULL,
  options       JSONB       NOT NULL,   -- [{label, twitchVotes, discordVotes}]
  winner        TEXT,                   -- winning option label
  total_votes   INTEGER     DEFAULT 0,
  reason        TEXT,                   -- why this poll was asked
  context       JSONB,                  -- stream context at time of poll
  status        TEXT        DEFAULT 'active',  -- active | closed | failed
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_poll_events_stream
  ON poll_events(workspace_id, stream_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_poll_events_recent
  ON poll_events(workspace_id, status, created_at DESC);

-- Also ensure ai_agent_memory supports upsert on (workspace_id, key)
-- (needed for poll learning saves)
-- This index may already exist; IF NOT EXISTS is safe to run again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_memory_ws_key
  ON ai_agent_memory(workspace_id, key);
