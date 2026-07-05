-- Stream History — VOD recovery fields
-- Adds source tracking and VOD cross-reference to stream_history rows.
-- source: how the row was created (live_event=bot recorded live, vod_recovery=recovered from Twitch VOD, manual=inserted by hand)
-- vod_id: Twitch VOD ID that corresponds to this stream
-- vod_url: direct Twitch VOD URL

ALTER TABLE stream_history
  ADD COLUMN IF NOT EXISTS source   TEXT        DEFAULT 'live_event',
  ADD COLUMN IF NOT EXISTS vod_id   TEXT,
  ADD COLUMN IF NOT EXISTS vod_url  TEXT;

-- Constrain source values
DO $$ BEGIN
  ALTER TABLE stream_history
    ADD CONSTRAINT stream_history_source_check
    CHECK (source IN ('live_event', 'twitch_poll', 'vod_recovery', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill existing rows as live_event
UPDATE stream_history
  SET source = 'live_event'
  WHERE source IS NULL;

-- Index: Content Factory VOD cross-reference (find stream by VOD ID)
CREATE INDEX IF NOT EXISTS idx_stream_history_vod_id
  ON stream_history (workspace_id, vod_id)
  WHERE vod_id IS NOT NULL;

-- Index: source tracking for dashboard (find recovered streams)
CREATE INDEX IF NOT EXISTS idx_stream_history_source
  ON stream_history (workspace_id, source, started_at DESC)
  WHERE source != 'live_event';
