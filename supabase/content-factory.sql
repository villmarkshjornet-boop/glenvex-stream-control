-- Content Factory Schema
-- IKKE aktiv i produksjon – feature flag: CONTENT_FACTORY_ENABLED=false

-- VODs
CREATE TABLE IF NOT EXISTS content_vods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  stream_id TEXT NOT NULL,
  twitch_vod_id TEXT,
  title TEXT,
  category TEXT,
  duration_seconds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  vod_url TEXT,
  thumbnail_url TEXT,
  started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcripts
CREATE TABLE IF NOT EXISTS content_transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  start_time NUMERIC NOT NULL,
  end_time NUMERIC NOT NULL,
  text TEXT NOT NULL,
  confidence NUMERIC,
  speaker TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcripts_vod ON content_transcripts(vod_id);

-- Highlights
CREATE TABLE IF NOT EXISTS content_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  start_time NUMERIC NOT NULL,
  end_time NUMERIC NOT NULL,
  score INTEGER DEFAULT 0,
  category TEXT,
  title TEXT,
  begrunnelse TEXT,
  signals JSONB DEFAULT '[]',
  rank INTEGER,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets (rendered video files)
CREATE TABLE IF NOT EXISTS content_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  highlight_id UUID REFERENCES content_highlights(id),
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  storage_path TEXT,
  storage_url TEXT,
  file_size_bytes BIGINT,
  duration_seconds NUMERIC,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Captions
CREATE TABLE IF NOT EXISTS content_captions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  highlight_id UUID REFERENCES content_highlights(id),
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Copywriting
CREATE TABLE IF NOT EXISTS content_copy (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  highlight_id UUID REFERENCES content_highlights(id),
  platform TEXT NOT NULL,
  tittel TEXT,
  beskrivelse TEXT,
  hashtags TEXT[],
  caption TEXT,
  discord_post TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Review Queue
CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  highlight_id UUID REFERENCES content_highlights(id),
  asset_id UUID REFERENCES content_assets(id),
  type TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline Logs
CREATE TABLE IF NOT EXISTS content_pipeline_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  duration_ms INTEGER,
  cost_estimate NUMERIC,
  output_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Copy (tekster per highlight og plattform)
CREATE TABLE IF NOT EXISTS content_copy (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vod_id UUID REFERENCES content_vods(id),
  highlight_id UUID REFERENCES content_highlights(id),
  platform TEXT NOT NULL,
  tittel TEXT,
  beskrivelse TEXT,
  hashtags TEXT[],
  caption TEXT,
  discord_post TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vods_stream ON content_vods(stream_id);
CREATE INDEX IF NOT EXISTS idx_highlights_vod ON content_highlights(vod_id);
CREATE INDEX IF NOT EXISTS idx_assets_vod ON content_assets(vod_id);
CREATE INDEX IF NOT EXISTS idx_review_status ON content_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_vod ON content_pipeline_logs(vod_id);
