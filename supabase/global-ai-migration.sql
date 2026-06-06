-- ============================================================
-- GLENVEX Creator OS – Global AI Memory Layer
-- Kjør i Supabase SQL Editor
-- ============================================================

-- 1. Rå hendelser fra alle agenter (billig logg, ingen GPT)
CREATE TABLE IF NOT EXISTS ai_agent_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  source        TEXT        NOT NULL,  -- twitch | discord | content_factory | ai_producer
  event_type    TEXT        NOT NULL,  -- sub | raid | highlight_found | clip_done | follow | message | etc
  user_id       TEXT,
  username      TEXT,
  channel_id    TEXT,
  message_text  TEXT,
  importance_score INTEGER  DEFAULT 0,
  metadata      JSONB       DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Kondensert kunnskap – det systemet husker
CREATE TABLE IF NOT EXISTS ai_agent_memory (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL,
  agent_type       TEXT        NOT NULL,  -- twitch | discord | content | global
  memory_type      TEXT        NOT NULL,  -- viewer | member | joke | topic | content_pattern | game_pattern | stream_pattern | community_pattern | event_pattern
  key              TEXT        NOT NULL,  -- unik nøkkel innen (workspace, agent, type)
  summary          TEXT        NOT NULL,
  confidence_score FLOAT       DEFAULT 0.5,
  occurrence_count INTEGER     DEFAULT 1,
  last_seen_at     TIMESTAMPTZ DEFAULT NOW(),
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, agent_type, memory_type, key)
);

-- 3. Innsikter – hva systemet har oppdaget
CREATE TABLE IF NOT EXISTS ai_agent_insights (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  summary          TEXT        NOT NULL,
  confidence_score FLOAT       DEFAULT 0.5,
  source_data      JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Beslutninger tatt av AI – for sporbarhet og læring
CREATE TABLE IF NOT EXISTS ai_agent_decisions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL,
  agent_type       TEXT        NOT NULL,
  decision_type    TEXT        NOT NULL,
  input_context    JSONB       DEFAULT '{}',
  decision_summary TEXT        NOT NULL,
  outcome          TEXT,       -- success | failure | pending | unknown
  feedback_score   FLOAT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indekser for ytelse
CREATE INDEX IF NOT EXISTS idx_agent_events_workspace   ON ai_agent_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_source      ON ai_agent_events(workspace_id, source, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_workspace   ON ai_agent_memory(workspace_id, agent_type, memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_occurrence  ON ai_agent_memory(workspace_id, occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_agent_insights_workspace ON ai_agent_insights(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_ws       ON ai_agent_decisions(workspace_id, created_at DESC);
