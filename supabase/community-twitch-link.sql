-- GLENVEX Community — Verifisert Discord ↔ Twitch Link System
-- Idempotent — safe to run multiple times

-- ─── 1. Pending link-tabell ───────────────────────────────────────────────────
-- Midlertidig tabell for uverifiserte link-forespørsler

CREATE TABLE IF NOT EXISTS community_twitch_link_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT        NOT NULL,
  discord_id      TEXT        NOT NULL,
  discord_username TEXT       NOT NULL,
  twitch_username TEXT        NOT NULL,
  verify_code     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  -- status: pending | verified | expired | cancelled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  verified_at     TIMESTAMPTZ,
  twitch_user_id  TEXT,
  UNIQUE(workspace_id, discord_id, status)  -- én pending per Discord-bruker
);

CREATE INDEX IF NOT EXISTS idx_link_requests_code
  ON community_twitch_link_requests (verify_code, status);

CREATE INDEX IF NOT EXISTS idx_link_requests_discord
  ON community_twitch_link_requests (workspace_id, discord_id, status);

-- ─── 2. Unmatched Twitch subs ─────────────────────────────────────────────────
-- Subs fra Twitch som ikke lot seg koble til Discord

CREATE TABLE IF NOT EXISTS community_twitch_unlinked_subs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT        NOT NULL,
  twitch_username TEXT        NOT NULL,
  twitch_user_id  TEXT,
  sub_tier        TEXT        NOT NULL DEFAULT 'tier1',
  event_type      TEXT        NOT NULL DEFAULT 'sub',
  -- event_type: sub | resub | gift | mystery_gift
  months          INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_discord_id TEXT,
  UNIQUE(workspace_id, twitch_username, event_type, created_at)
);

CREATE INDEX IF NOT EXISTS idx_unlinked_subs_workspace
  ON community_twitch_unlinked_subs (workspace_id, resolved_at)
  WHERE resolved_at IS NULL;

-- ─── Verifisering ─────────────────────────────────────────────────────────────

SELECT 'community_twitch_link_requests og community_twitch_unlinked_subs opprettet' AS status;
