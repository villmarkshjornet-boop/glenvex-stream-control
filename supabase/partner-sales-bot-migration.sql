-- Partner Sales Bot V1 Migration
-- Tables: partner_proposals, partner_polls, partner_audience_preferences, twitter_drafts

-- ── partner_proposals ─────────────────────────────────────────────────────────
-- Pending promo proposals. requireApproval=true means bot writes here instead of
-- posting directly. User approves/rejects/edits from the dashboard.

CREATE TABLE IF NOT EXISTS partner_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  partner_id      UUID,                -- references partners(id)
  partner_name    TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('twitch', 'discord', 'both')),
  trigger_type    TEXT NOT NULL,       -- 'chat_silence' | 'viewer_peak' | 'context_match' | 'timer' | 'manual'
  message_twitch  TEXT,
  message_discord TEXT,
  affiliate_url   TEXT,
  discount_code   TEXT,
  confidence      NUMERIC(4,3),        -- 0.000–1.000
  scoring_detail  JSONB,               -- { relevance, historical, context, cooldown }
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'expired')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  sent_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_proposals_workspace_status
  ON partner_proposals (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_proposals_expires
  ON partner_proposals (expires_at) WHERE status = 'pending';

-- ── partner_polls ─────────────────────────────────────────────────────────────
-- Tracks polls posted in Twitch chat or Discord, and collected responses.

CREATE TABLE IF NOT EXISTS partner_polls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  partner_id      UUID,
  partner_name    TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('twitch', 'discord')),
  poll_type       TEXT NOT NULL DEFAULT 'interest', -- 'interest' | 'timing' | 'format'
  question        TEXT NOT NULL,
  options         JSONB NOT NULL,                   -- [{ label, value, votes }]
  discord_message_id TEXT,
  twitch_message  TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'timed_out')),
  total_responses INT NOT NULL DEFAULT 0,
  winning_option  TEXT,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_polls_workspace
  ON partner_polls (workspace_id, created_at DESC);

-- ── partner_audience_preferences ─────────────────────────────────────────────
-- Aggregated preference signals learned from polls and engagement.
-- One row per (workspace_id, partner_id) — upsert on conflict.

CREATE TABLE IF NOT EXISTS partner_audience_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  partner_id        UUID NOT NULL,
  partner_name      TEXT NOT NULL,
  interest_score    NUMERIC(4,3) NOT NULL DEFAULT 0.500,  -- 0=low interest, 1=high
  preferred_timing  TEXT,                                  -- 'early_stream' | 'mid_stream' | 'end_stream'
  preferred_format  TEXT,                                  -- 'short' | 'detailed' | 'code_only'
  total_poll_votes  INT NOT NULL DEFAULT 0,
  positive_votes    INT NOT NULL DEFAULT 0,
  last_poll_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_audience_pref_workspace
  ON partner_audience_preferences (workspace_id, partner_id);

-- ── twitter_drafts ────────────────────────────────────────────────────────────
-- AI-generated Twitter/X drafts for partner promos, awaiting manual review.

CREATE TABLE IF NOT EXISTS twitter_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  partner_id      UUID,
  partner_name    TEXT NOT NULL,
  draft_text      TEXT NOT NULL,
  hashtags        TEXT[],
  affiliate_url   TEXT,
  media_url       TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'rejected', 'archived')),
  ai_model        TEXT,                -- which model generated this draft
  ai_prompt_hint  TEXT,                -- brief context used in generation
  posted_at       TIMESTAMPTZ,
  posted_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_twitter_drafts_workspace_status
  ON twitter_drafts (workspace_id, status, created_at DESC);

-- ── RLS policies ──────────────────────────────────────────────────────────────
-- Follow the same workspace-isolation pattern as other tables.

ALTER TABLE partner_proposals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_polls             ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_audience_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE twitter_drafts            ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (Railway bot uses service role key)
-- Auth'd users can only see their own workspace (workspace_id from JWT user_metadata)

-- partner_proposals
CREATE POLICY "service_role_all_partner_proposals" ON partner_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "user_own_workspace_partner_proposals" ON partner_proposals
  FOR ALL USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
             WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

-- partner_polls
CREATE POLICY "service_role_all_partner_polls" ON partner_polls
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "user_own_workspace_partner_polls" ON partner_polls
  FOR ALL USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
             WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

-- partner_audience_preferences
CREATE POLICY "service_role_all_partner_audience_preferences" ON partner_audience_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "user_own_workspace_partner_audience_preferences" ON partner_audience_preferences
  FOR ALL USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
             WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

-- twitter_drafts
CREATE POLICY "service_role_all_twitter_drafts" ON twitter_drafts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "user_own_workspace_twitter_drafts" ON twitter_drafts
  FOR ALL USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
             WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));
