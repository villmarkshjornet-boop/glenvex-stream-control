-- Stream Coach Tips: actionable recommendations per stream with outcome tracking
CREATE TABLE IF NOT EXISTS stream_coach_tips (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  stream_id     TEXT        NOT NULL,
  tip_text      TEXT        NOT NULL,
  tip_category  TEXT        NOT NULL DEFAULT 'general',
  sort_order    INT         NOT NULL DEFAULT 0,
  is_executed   BOOLEAN     NOT NULL DEFAULT false,
  executed_at   TIMESTAMPTZ,
  outcome       TEXT        CHECK (outcome IN ('positive', 'negative', 'pending')),
  metrics_before JSONB,
  metrics_after  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_coach_tips_ws_stream
  ON stream_coach_tips (workspace_id, stream_id);
