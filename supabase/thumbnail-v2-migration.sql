-- Thumbnail V2: quality score + source frame timestamp
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS thumbnail_source_frame  FLOAT;
