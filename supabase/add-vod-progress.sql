-- Legg til progress-sporing på content_vods
ALTER TABLE content_vods
  ADD COLUMN IF NOT EXISTS current_step TEXT,
  ADD COLUMN IF NOT EXISTS progress_percent INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_message TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Legg til klipp-kolonner på content_highlights (hvis ikke allerede kjørt)
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS clip_status TEXT DEFAULT 'READY_FOR_CLIP',
  ADD COLUMN IF NOT EXISTS clip_url TEXT,
  ADD COLUMN IF NOT EXISTS vertical_clip_url TEXT,
  ADD COLUMN IF NOT EXISTS clip_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clip_error TEXT;

-- Indekser
CREATE INDEX IF NOT EXISTS idx_highlights_clip_status ON content_highlights(clip_status);
CREATE INDEX IF NOT EXISTS idx_vods_status ON content_vods(status);
