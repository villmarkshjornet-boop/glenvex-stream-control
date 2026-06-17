-- Spor publisering av klipp, slik at Action Center ikke anbefaler et klipp som allerede er postet.
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discord_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_highlights_published_at ON content_highlights(published_at);
