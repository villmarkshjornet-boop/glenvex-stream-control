-- Thumbnail V5: CTR-score, concept type, hook metadata
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_ctr_score  integer,
  ADD COLUMN IF NOT EXISTS thumbnail_concept    text,
  ADD COLUMN IF NOT EXISTS thumbnail_hook       jsonb;
