-- Thumbnail V6 — Gemini Director System
-- Adds columns for storing the full Gemini strategy and context

ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_director_strategy JSONB,
  ADD COLUMN IF NOT EXISTS thumbnail_gemini_context    JSONB;

COMMENT ON COLUMN content_highlights.thumbnail_director_strategy IS
  'ThumbnailStrategy returned by Gemini Director: headline, emotion, focusTimestamp, arrowRequired, etc.';
COMMENT ON COLUMN content_highlights.thumbnail_gemini_context IS
  'GeminiContext: which frames were sent, timestamps, model used, duration';
