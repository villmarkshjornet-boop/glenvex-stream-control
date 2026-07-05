-- Poll Topic Scores — engagement-based per-topic scoring for Poll Manager V2.
-- Each row tracks how well a specific poll type performs for a given topic key.
-- Used by choosePollType() to balance exploitation (proven types) vs exploration.

CREATE TABLE IF NOT EXISTS poll_topic_scores (
  workspace_id    TEXT        NOT NULL,
  topic_key       TEXT        NOT NULL,           -- e.g. 'game_choice', 'partner_vote', 'community'
  poll_type       TEXT        NOT NULL,           -- 'CHOICE','VERSUS','RANKED','RATING','PREDICTION'
  asked_count     INTEGER     NOT NULL DEFAULT 0, -- how many times this type was used for this topic
  total_votes     INTEGER     NOT NULL DEFAULT 0, -- total votes collected
  avg_votes       FLOAT       NOT NULL DEFAULT 0, -- rolling average votes per poll
  engagement_score FLOAT      NOT NULL DEFAULT 0.5, -- normalized 0–1 engagement score
  negative_count  INTEGER     NOT NULL DEFAULT 0, -- polls with very low engagement (<3 votes)
  last_winner     TEXT,                           -- the winning option from the last poll (raw text)
  last_asked_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (workspace_id, topic_key, poll_type)
);

-- Row-level security: same pattern as other bot tables
ALTER TABLE poll_topic_scores ENABLE ROW LEVEL SECURITY;

-- Service role has full access (bot writes via service key)
CREATE POLICY "service_role_all_poll_topic_scores"
  ON poll_topic_scores
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workspace-scoped read for authenticated users
CREATE POLICY "workspace_read_poll_topic_scores"
  ON poll_topic_scores
  FOR SELECT
  TO authenticated
  USING (workspace_id = (auth.jwt() ->> 'workspace_id'));

-- Index: Poll Manager reads all scores for a workspace at context-build time
CREATE INDEX IF NOT EXISTS idx_poll_topic_scores_workspace
  ON poll_topic_scores (workspace_id);

-- Index: find top-performing types for a specific topic
CREATE INDEX IF NOT EXISTS idx_poll_topic_scores_topic
  ON poll_topic_scores (workspace_id, topic_key, engagement_score DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_poll_topic_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_poll_topic_scores_updated_at ON poll_topic_scores;
CREATE TRIGGER trg_poll_topic_scores_updated_at
  BEFORE UPDATE ON poll_topic_scores
  FOR EACH ROW EXECUTE FUNCTION update_poll_topic_scores_updated_at();
