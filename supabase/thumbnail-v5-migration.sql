-- Thumbnail V5: CTR-score, concept type, hook metadata
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_ctr_score    integer,
  ADD COLUMN IF NOT EXISTS thumbnail_concept      text,
  ADD COLUMN IF NOT EXISTS thumbnail_hook         jsonb;

-- Thumbnail V5.5: reject counter for CTR Gate retry loop
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_reject_count integer DEFAULT 0;
