-- Legg til klipp-kolonner på content_highlights
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS clip_status TEXT DEFAULT 'READY_FOR_CLIP',
  ADD COLUMN IF NOT EXISTS clip_url TEXT,
  ADD COLUMN IF NOT EXISTS vertical_clip_url TEXT,
  ADD COLUMN IF NOT EXISTS clip_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clip_error TEXT;

-- Index for clip worker
CREATE INDEX IF NOT EXISTS idx_highlights_clip_status ON content_highlights(clip_status);
