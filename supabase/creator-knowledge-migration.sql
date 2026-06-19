-- Creator Knowledge table for Learning Engine (Phase 18)
-- Stores structured knowledge derived from historical analysis.
-- Upserted on each learning run; never fabricates values.

CREATE TABLE IF NOT EXISTS creator_knowledge (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL REFERENCES workspaces(id),
  knowledge_type   TEXT        NOT NULL,   -- promotion_pattern | rejection_pattern | platform_preference | decision_accuracy | stream_behaviour | creator_preference | partner_performance | timing_pattern
  key              TEXT        NOT NULL,   -- unique within (workspace, type): e.g. 'partner:Shark Gaming', 'reasonCode:cooldown'
  title            TEXT        NOT NULL,
  finding          TEXT        NOT NULL,   -- human-readable conclusion
  confidence       INTEGER     NOT NULL DEFAULT 0,   -- 0–100, derived from evidence_count
  evidence_count   INTEGER     NOT NULL DEFAULT 0,   -- number of data points behind this finding
  evidence_summary JSONB       NOT NULL DEFAULT '{}', -- raw numbers (approvalRate, counts, etc.)
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, knowledge_type, key)
);

CREATE INDEX IF NOT EXISTS idx_creator_knowledge_ws_updated
  ON creator_knowledge (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_knowledge_ws_type
  ON creator_knowledge (workspace_id, knowledge_type);
