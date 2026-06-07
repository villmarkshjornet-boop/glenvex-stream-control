-- GLENVEX Creator OS — Global Event Bus
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS system_events (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id TEXT         NOT NULL,
  source       TEXT         NOT NULL,
  event_type   TEXT         NOT NULL,
  title        TEXT         NOT NULL,
  description  TEXT,
  severity     TEXT         NOT NULL DEFAULT 'info',
  metadata     JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_events_ws_ts
  ON system_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_events_source
  ON system_events(workspace_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_events_type
  ON system_events(workspace_id, event_type, created_at DESC);
