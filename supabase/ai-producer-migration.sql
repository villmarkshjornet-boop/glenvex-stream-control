-- AI Producer Memory Tables
-- Kjør i Supabase SQL Editor

-- Stream-minne: én rad per analysert stream
CREATE TABLE IF NOT EXISTS ai_producer_stream_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'glenvex-default',
  vod_id TEXT,
  stream_title TEXT,
  game TEXT,
  streamed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  highlights_count INTEGER DEFAULT 0,
  top_categories JSONB DEFAULT '[]',
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Innholds-mønstre: hvilke highlight-kategorier fungerer best
CREATE TABLE IF NOT EXISTS ai_producer_content_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'glenvex-default',
  category TEXT NOT NULL,
  avg_score FLOAT DEFAULT 0,
  occurrence_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, category)
);

-- Community-kunnskap: inside jokes, faste tittere, gjentakende temaer
CREATE TABLE IF NOT EXISTS ai_producer_community_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'glenvex-default',
  entry_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  occurrence_count INTEGER DEFAULT 1,
  first_seen_vod_id TEXT,
  last_seen_vod_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, entry_type, name)
);

-- Spill-kunnskap: game-spesifikk kontekst per spill
CREATE TABLE IF NOT EXISTS ai_producer_game_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'glenvex-default',
  game TEXT NOT NULL,
  knowledge TEXT NOT NULL,
  highlight_types JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, game)
);

-- Syntetisert kunnskap brukt i neste VOD-analyse
CREATE TABLE IF NOT EXISTS ai_producer_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'glenvex-default',
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  stream_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, category)
);

-- Indekser
CREATE INDEX IF NOT EXISTS idx_ai_stream_memory_workspace ON ai_producer_stream_memory(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_stream_memory_vod ON ai_producer_stream_memory(vod_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_memory_workspace ON ai_producer_content_memory(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_workspace ON ai_producer_knowledge(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_community_workspace ON ai_producer_community_memory(workspace_id);
