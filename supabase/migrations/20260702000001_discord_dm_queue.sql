-- Discord DM queue for admin-initiated coin adjustments and other bot DMs
CREATE TABLE IF NOT EXISTS discord_dm_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  discord_id   text NOT NULL,
  message      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  error        text
);

CREATE INDEX IF NOT EXISTS discord_dm_queue_workspace_status ON discord_dm_queue(workspace_id, status);
