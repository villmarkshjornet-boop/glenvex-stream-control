-- GLENVEX Community Manager — Enhanced Members View
-- Adds twitch_sub_since + community_twitch_subscribers table
-- Replaces community_member_overview with full-featured version for Members tab
-- Idempotent — safe to run multiple times

-- ─── 1. Add twitch_sub_since to community_members ────────────────────────────

ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS twitch_sub_since TIMESTAMPTZ;

-- ─── 2. Twitch subscriber history ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS community_twitch_subscribers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT        NOT NULL,
  discord_id      TEXT        NOT NULL,
  twitch_username TEXT        NOT NULL,
  twitch_user_id  TEXT,
  sub_tier        TEXT        NOT NULL DEFAULT 'tier1',
  sub_since       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, discord_id)
);

CREATE INDEX IF NOT EXISTS idx_twitch_subs_workspace
  ON community_twitch_subscribers (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_twitch_subs_discord
  ON community_twitch_subscribers (workspace_id, discord_id);

-- ─── 3. Replace community_member_overview with full-featured version ──────────
-- Includes: messages, voice, streams, streak, coins, sub status, card counts,
-- active card, and computed last_activity_at

CREATE OR REPLACE VIEW community_member_overview AS
SELECT
  m.discord_id,
  m.workspace_id,
  m.display_name,
  m.username,
  m.nickname,
  m.top_role,
  m.xp,
  m.level,
  m.messages,
  m.voice_minutes,
  m.streams_attended,
  m.streak_days,
  m.coins_balance,
  m.total_coins_earned,
  m.total_coins_spent,
  m.twitch_sub_status,
  m.twitch_sub_tier,
  m.twitch_sub_since,
  m.badges,
  m.joined_at,
  m.last_seen,
  m.last_coin_earned_at,
  GREATEST(
    COALESCE(m.last_seen,           '1970-01-01'::TIMESTAMPTZ),
    COALESCE(m.last_coin_earned_at, '1970-01-01'::TIMESTAMPTZ)
  )                                         AS last_activity_at,
  COALESCE(rc.total_cards,     0)           AS total_cards,
  COALESCE(rc.common_count,    0)           AS common_cards,
  COALESCE(rc.rare_count,      0)           AS rare_cards,
  COALESCE(rc.epic_count,      0)           AS epic_cards,
  COALESCE(rc.legendary_count, 0)           AS legendary_cards,
  COALESCE(rc.mythic_count,    0)           AS mythic_cards,
  ac.card_image_url                         AS active_card_image_url,
  ac.title                                  AS active_card_title,
  ac.rarity                                 AS active_card_rarity,
  ac.class                                  AS active_card_class
FROM community_members m
LEFT JOIN community_card_rarity_counts rc
  ON  rc.workspace_id = m.workspace_id
  AND rc.user_id      = m.discord_id
LEFT JOIN community_cards ac
  ON  ac.workspace_id = m.workspace_id
  AND ac.user_id      = m.discord_id
  AND ac.card_type    = 'persona'
  AND ac.is_active    = true;

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT
  discord_id,
  display_name,
  top_role,
  xp,
  coins_balance,
  twitch_sub_status,
  total_cards,
  active_card_title,
  active_card_rarity,
  last_activity_at
FROM community_member_overview
WHERE workspace_id = 'glenvex'
ORDER BY xp DESC;
