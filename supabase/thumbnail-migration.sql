-- AI Thumbnail Generator – isolert migrering
-- Legg til thumbnail-felter på content_highlights
-- Ikke bland med clip_status eller eksisterende pipeline

ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_status        TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_youtube_url   TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_tiktok_url    TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_error         TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_generated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_prompt        TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_headline      TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_subheadline   TEXT;

-- thumbnail_status verdier: PENDING | GENERATING | DONE | FAILED

CREATE INDEX IF NOT EXISTS idx_content_highlights_thumbnail_status
  ON content_highlights (thumbnail_status)
  WHERE thumbnail_status = 'PENDING';
