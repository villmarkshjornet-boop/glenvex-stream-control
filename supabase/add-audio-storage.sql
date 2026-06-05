-- Legg til audio storage felt i content_vods
ALTER TABLE content_vods
  ADD COLUMN IF NOT EXISTS audio_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS audio_signed_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_url_expires_at TIMESTAMPTZ;
