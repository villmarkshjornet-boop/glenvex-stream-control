-- GLENVEX Community — Unified Member Model
-- Felles modell for Discord + Twitch: én rad per person, begge plattformer
-- Idempotent — safe to run multiple times
-- Kjør i Supabase SQL Editor

-- ─── 1. Nye kolonner på community_members ─────────────────────────────────────

ALTER TABLE community_members
  -- Identifisering
  ADD COLUMN IF NOT EXISTS member_type              TEXT        NOT NULL DEFAULT 'discord',
  ADD COLUMN IF NOT EXISTS twitch_username          TEXT,
  ADD COLUMN IF NOT EXISTS twitch_display_name      TEXT,
  ADD COLUMN IF NOT EXISTS twitch_linked            BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discord_avatar_url       TEXT,
  ADD COLUMN IF NOT EXISTS joined_discord_at        TIMESTAMPTZ,
  -- Twitch sub tracking (may already exist from earlier migration)
  ADD COLUMN IF NOT EXISTS twitch_sub_since         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS twitch_sub_last_seen_at  TIMESTAMPTZ,
  -- XP per plattform
  ADD COLUMN IF NOT EXISTS discord_xp               INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS twitch_xp                INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_xp                 INTEGER     NOT NULL DEFAULT 0,
  -- Meldinger per plattform
  ADD COLUMN IF NOT EXISTS messages_discord         INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS messages_twitch          INTEGER     NOT NULL DEFAULT 0,
  -- Siste aktivitet per plattform
  ADD COLUMN IF NOT EXISTS last_discord_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_twitch_activity_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_stream_at      TIMESTAMPTZ;

-- ─── 2. Backfill: tw_-prefix = Twitch-only member ─────────────────────────────

UPDATE community_members SET
  member_type             = 'twitch',
  twitch_xp               = xp,
  total_xp                = xp,
  messages_twitch         = messages,
  twitch_username         = username,
  twitch_display_name     = display_name,
  last_twitch_activity_at = last_seen,
  last_seen_stream_at     = last_seen
WHERE discord_id LIKE 'tw_%';

-- ─── 3. Backfill: Discord members ─────────────────────────────────────────────

UPDATE community_members SET
  member_type              = CASE
    WHEN twitch_id IS NOT NULL AND twitch_id != '' THEN 'linked'
    ELSE 'discord'
  END,
  discord_xp               = xp,
  total_xp                 = xp,
  messages_discord         = messages,
  last_discord_activity_at = last_seen,
  joined_discord_at        = joined_at,
  twitch_linked            = (twitch_id IS NOT NULL AND twitch_id != '')
WHERE discord_id NOT LIKE 'tw_%';

-- ─── 4. Oppdater community_member_overview view med alle nye kolonner ─────────
-- DROP first because CREATE OR REPLACE cannot reorder/rename existing columns

DROP VIEW IF EXISTS community_member_overview;
CREATE VIEW community_member_overview AS
SELECT
  m.discord_id,
  m.workspace_id,
  m.display_name,
  m.username,
  m.nickname,
  m.top_role,
  -- Identifisering
  m.member_type,
  m.twitch_id,
  m.twitch_username,
  m.twitch_display_name,
  m.twitch_linked,
  m.discord_avatar_url,
  m.joined_discord_at,
  -- XP
  m.xp,
  m.discord_xp,
  m.twitch_xp,
  m.total_xp,
  m.level,
  -- Meldinger
  m.messages,
  m.messages_discord,
  m.messages_twitch,
  -- Annen aktivitet
  m.voice_minutes,
  m.streams_attended,
  m.streak_days,
  -- Coins
  m.coins_balance,
  m.total_coins_earned,
  m.total_coins_spent,
  -- Twitch sub
  m.twitch_sub_status,
  m.twitch_sub_tier,
  m.twitch_sub_since,
  m.twitch_sub_last_seen_at,
  -- Badges
  m.badges,
  -- Tidsstempler
  m.joined_at,
  m.last_seen,
  m.last_coin_earned_at,
  m.last_discord_activity_at,
  m.last_twitch_activity_at,
  m.last_seen_stream_at,
  GREATEST(
    COALESCE(m.last_discord_activity_at, '1970-01-01'::TIMESTAMPTZ),
    COALESCE(m.last_twitch_activity_at,  '1970-01-01'::TIMESTAMPTZ),
    COALESCE(m.last_seen_stream_at,      '1970-01-01'::TIMESTAMPTZ),
    COALESCE(m.last_coin_earned_at,      '1970-01-01'::TIMESTAMPTZ)
  )                                             AS last_activity_at,
  -- Kort
  COALESCE(rc.total_cards,     0)               AS total_cards,
  COALESCE(rc.common_count,    0)               AS common_cards,
  COALESCE(rc.rare_count,      0)               AS rare_cards,
  COALESCE(rc.epic_count,      0)               AS epic_cards,
  COALESCE(rc.legendary_count, 0)               AS legendary_cards,
  COALESCE(rc.mythic_count,    0)               AS mythic_cards,
  ac.card_image_url                             AS active_card_image_url,
  ac.title                                      AS active_card_title,
  ac.rarity                                     AS active_card_rarity,
  ac.class                                      AS active_card_class
FROM community_members m
LEFT JOIN community_card_rarity_counts rc
  ON  rc.workspace_id = m.workspace_id
  AND rc.user_id      = m.discord_id
LEFT JOIN community_cards ac
  ON  ac.workspace_id = m.workspace_id
  AND ac.user_id      = m.discord_id
  AND ac.card_type    = 'persona'
  AND ac.is_active    = true;

-- ─── Verifisering ─────────────────────────────────────────────────────────────

SELECT
  discord_id,
  display_name,
  member_type,
  twitch_linked,
  discord_xp,
  twitch_xp,
  total_xp,
  messages_discord,
  messages_twitch,
  twitch_sub_status,
  coins_balance,
  total_cards,
  last_activity_at
FROM community_member_overview
WHERE workspace_id = 'glenvex'
ORDER BY total_xp DESC;
