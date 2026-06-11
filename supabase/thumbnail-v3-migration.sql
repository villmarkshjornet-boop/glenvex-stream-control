-- Thumbnail V3: variant layouts + CTR scoring
-- Run once in Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_variant_b_url  TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_variant_c_url  TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_ctr_score      INTEGER,
  ADD COLUMN IF NOT EXISTS thumbnail_ctr_reason     TEXT;
