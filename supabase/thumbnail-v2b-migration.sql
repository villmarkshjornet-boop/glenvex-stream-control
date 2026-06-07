-- Legg til thumbnail_started_at for stale-deteksjon
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_started_at TIMESTAMPTZ;
