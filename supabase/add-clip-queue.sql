-- Auto Clip Queue status
ALTER TABLE content_highlights
  ADD COLUMN IF NOT EXISTS clip_status TEXT DEFAULT 'READY_FOR_CLIP';
-- Status: READY_FOR_CLIP → CLIPPING → CLIPPED → POSTED

-- Kostnadssporing på VODs
ALTER TABLE content_vods
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0;

-- Retry-telling på pipeline logs
ALTER TABLE content_pipeline_logs
  ADD COLUMN IF NOT EXISTS forsøk INTEGER DEFAULT 1;
