-- Content Factory V2 — Clip quality score columns
-- Populated by highlightDiscovery.ts V2 (GPT-4o multi-pass analysis)
-- All scores: 0-100

ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS clip_quality_score        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clip_quality_entertainment NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clip_quality_emotion      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clip_quality_surprise     NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clip_quality_viral        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clip_quality_story_arc    NUMERIC(5,2);

CREATE INDEX IF NOT EXISTS idx_highlights_quality_score
  ON content_highlights(clip_quality_score DESC NULLS LAST)
  WHERE clip_status = 'CLIPPED';
