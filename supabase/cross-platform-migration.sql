-- Cross-platform user matching
CREATE TABLE IF NOT EXISTS cross_platform_users (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT    NOT NULL,

  twitch_user_id    TEXT,
  twitch_username   TEXT,
  discord_user_id   TEXT,
  discord_username  TEXT,

  display_name      TEXT,
  known_aliases     TEXT[]  DEFAULT '{}',
  platform_sources  TEXT[]  DEFAULT '{}',

  confidence_score  FLOAT   DEFAULT 0.0,
  -- pending | confirmed | rejected
  match_status      TEXT    DEFAULT 'pending',
  match_notes       TEXT,

  first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ DEFAULT NOW(),
  notes             JSONB   DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpu_workspace_twitch
  ON cross_platform_users (workspace_id, twitch_username)
  WHERE twitch_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cpu_workspace_discord
  ON cross_platform_users (workspace_id, discord_user_id)
  WHERE discord_user_id IS NOT NULL;

-- Partner content result log
CREATE TABLE IF NOT EXISTS partner_content_log (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT    NOT NULL,
  partner_name        TEXT,

  posted_at           TIMESTAMPTZ DEFAULT NOW(),
  platform            TEXT    NOT NULL,   -- discord | twitch
  channel             TEXT,

  affiliate_url_used  TEXT,
  had_affiliate_url   BOOLEAN DEFAULT FALSE,
  missing_affiliate   BOOLEAN DEFAULT FALSE,
  copy_text           TEXT,
  cta_variant         TEXT,

  discord_message_id  TEXT,
  clicks              INTEGER DEFAULT 0,
  reactions           INTEGER DEFAULT 0,
  replies             INTEGER DEFAULT 0,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcl_workspace_posted
  ON partner_content_log (workspace_id, posted_at DESC);
