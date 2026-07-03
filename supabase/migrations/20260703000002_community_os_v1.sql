-- Community OS V1
-- Rank System, Badge System, Perks, Prestige, Hero of the Day,
-- Blackjack, Roulette, RNG Audit Log, Achievements, Quests,
-- Workspace Feature Flags.
-- All tables: workspace_id required. All idempotent (IF NOT EXISTS).

-- ─── Extend community_members ──────────────────────────────────────────────────
ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS prestige_level     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS twitch_sub_months  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hero_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reputation_score   INTEGER NOT NULL DEFAULT 0;

-- ─── 1. community_ranks ────────────────────────────────────────────────────────
-- Configurable rank bands per workspace. Seeded by RankService at first boot.
CREATE TABLE IF NOT EXISTS community_ranks (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  level_min    INTEGER     NOT NULL,
  level_max    INTEGER     NOT NULL,
  rank_name    TEXT        NOT NULL,
  rank_icon    TEXT        NOT NULL,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, level_min)
);
CREATE INDEX IF NOT EXISTS idx_community_ranks_ws ON community_ranks (workspace_id);

-- ─── 2. community_badges ───────────────────────────────────────────────────────
-- Badge definitions per workspace. badge_type: 'auto' | 'manual' | 'admin'
CREATE TABLE IF NOT EXISTS community_badges (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  badge_key    TEXT        NOT NULL,
  badge_name   TEXT        NOT NULL,
  badge_icon   TEXT        NOT NULL,
  badge_type   TEXT        NOT NULL DEFAULT 'manual'
                           CHECK (badge_type IN ('auto','manual','admin')),
  description  TEXT,
  auto_rules   JSONB,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, badge_key)
);
CREATE INDEX IF NOT EXISTS idx_community_badges_ws ON community_badges (workspace_id);

-- ─── 3. community_member_badges ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_member_badges (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id   TEXT        NOT NULL,
  badge_key    TEXT        NOT NULL,
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by   TEXT,
  note         TEXT,
  UNIQUE(workspace_id, discord_id, badge_key)
);
CREATE INDEX IF NOT EXISTS idx_community_member_badges_ws_member
  ON community_member_badges (workspace_id, discord_id);

-- ─── 4. community_perks ────────────────────────────────────────────────────────
-- XP/coins multipliers and loot bonuses per rank name.
CREATE TABLE IF NOT EXISTS community_perks (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rank_name             TEXT        NOT NULL,
  xp_multiplier         FLOAT       NOT NULL DEFAULT 1.0,
  coins_multiplier      FLOAT       NOT NULL DEFAULT 1.0,
  loot_chance_bonus     FLOAT       NOT NULL DEFAULT 0.0,
  reroll_cost_reduction INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, rank_name)
);
CREATE INDEX IF NOT EXISTS idx_community_perks_ws ON community_perks (workspace_id);

-- ─── 5. community_prestige_log ─────────────────────────────────────────────────
-- History of every prestige event. Shown as ⭐I, ⭐⭐II etc.
CREATE TABLE IF NOT EXISTS community_prestige_log (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id   TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id     TEXT        NOT NULL,
  prestige_level INTEGER     NOT NULL,
  level_at_reset INTEGER     NOT NULL DEFAULT 100,
  xp_at_reset    INTEGER     NOT NULL DEFAULT 0,
  prestiged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_prestige_ws_member
  ON community_prestige_log (workspace_id, discord_id);

-- ─── 6. community_hero ─────────────────────────────────────────────────────────
-- One hero per workspace per day. Contribution-based (not pure XP).
CREATE TABLE IF NOT EXISTS community_hero (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id         TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id           TEXT        NOT NULL,
  hero_date            DATE        NOT NULL,
  contribution_score   INTEGER     NOT NULL DEFAULT 0,
  selection_metadata   JSONB,
  announced_at         TIMESTAMPTZ,
  UNIQUE(workspace_id, hero_date)
);
CREATE INDEX IF NOT EXISTS idx_community_hero_ws ON community_hero (workspace_id, hero_date DESC);

-- ─── 7. community_blackjack_games ──────────────────────────────────────────────
-- Full game record. outcome: 'win' | 'loss' | 'blackjack' | 'push'
CREATE TABLE IF NOT EXISTS community_blackjack_games (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id   TEXT        NOT NULL,
  bet_amount   INTEGER     NOT NULL,
  outcome      TEXT        NOT NULL CHECK (outcome IN ('win','loss','blackjack','push')),
  player_cards JSONB       NOT NULL,
  dealer_cards JSONB       NOT NULL,
  player_score INTEGER     NOT NULL,
  dealer_score INTEGER     NOT NULL,
  coins_delta  INTEGER     NOT NULL,
  played_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_blackjack_ws_member
  ON community_blackjack_games (workspace_id, discord_id, played_at DESC);

-- ─── 8. community_roulette_bets ────────────────────────────────────────────────
-- bet_type: 'red'|'black'|'green'|'number'|'odd'|'even'|'1to18'|'19to36'|'dozen1'|'dozen2'|'dozen3'
CREATE TABLE IF NOT EXISTS community_roulette_bets (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id    TEXT        NOT NULL,
  bet_type      TEXT        NOT NULL,
  bet_amount    INTEGER     NOT NULL,
  bet_target    TEXT,
  result_number INTEGER     NOT NULL CHECK (result_number BETWEEN 0 AND 36),
  outcome       TEXT        NOT NULL CHECK (outcome IN ('win','loss')),
  coins_delta   INTEGER     NOT NULL,
  rng_log_id    UUID,
  played_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_roulette_ws_member
  ON community_roulette_bets (workspace_id, discord_id, played_at DESC);

-- ─── 9. community_rng_log ──────────────────────────────────────────────────────
-- Immutable audit trail of every server-side RNG result (Discord ToS compliance).
CREATE TABLE IF NOT EXISTS community_rng_log (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  game_type    TEXT        NOT NULL CHECK (game_type IN ('blackjack','roulette','loot')),
  discord_id   TEXT        NOT NULL,
  rng_value    FLOAT       NOT NULL,
  rng_result   JSONB       NOT NULL,
  context      TEXT,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_rng_ws ON community_rng_log (workspace_id, logged_at DESC);

-- ─── 10. community_achievements ────────────────────────────────────────────────
-- Achievement definitions. unlock_condition: {type: 'messages'|'xp'|'level'|..., threshold: N}
CREATE TABLE IF NOT EXISTS community_achievements (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id     TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  achievement_key  TEXT        NOT NULL,
  achievement_name TEXT        NOT NULL,
  description      TEXT,
  icon             TEXT        NOT NULL DEFAULT '🏆',
  category         TEXT        NOT NULL DEFAULT 'general'
                               CHECK (category IN ('social','games','economy','loyalty','general')),
  unlock_condition JSONB       NOT NULL,
  reward_xp        INTEGER     NOT NULL DEFAULT 0,
  reward_coins     INTEGER     NOT NULL DEFAULT 0,
  is_secret        BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, achievement_key)
);
CREATE INDEX IF NOT EXISTS idx_community_achievements_ws
  ON community_achievements (workspace_id, category);

-- ─── 11. community_member_achievements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_member_achievements (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id      TEXT        NOT NULL,
  achievement_key TEXT        NOT NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified        BOOLEAN     NOT NULL DEFAULT false,
  UNIQUE(workspace_id, discord_id, achievement_key)
);
CREATE INDEX IF NOT EXISTS idx_community_member_ach_ws_member
  ON community_member_achievements (workspace_id, discord_id);
CREATE INDEX IF NOT EXISTS idx_community_member_ach_unnotified
  ON community_member_achievements (workspace_id, notified)
  WHERE notified = false;

-- ─── 12. community_quests ──────────────────────────────────────────────────────
-- Quest definitions. objective_type: 'messages'|'xp'|'coins_spent'|'games_played'|'reactions'|'voice_minutes'
CREATE TABLE IF NOT EXISTS community_quests (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id     TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quest_key        TEXT        NOT NULL,
  quest_name       TEXT        NOT NULL,
  description      TEXT,
  quest_type       TEXT        NOT NULL CHECK (quest_type IN ('daily','weekly')),
  objective_type   TEXT        NOT NULL,
  objective_target INTEGER     NOT NULL,
  reward_xp        INTEGER     NOT NULL DEFAULT 0,
  reward_coins     INTEGER     NOT NULL DEFAULT 0,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, quest_key)
);
CREATE INDEX IF NOT EXISTS idx_community_quests_ws ON community_quests (workspace_id, quest_type);

-- ─── 13. community_member_quests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_member_quests (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id   TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_id     TEXT        NOT NULL,
  quest_key      TEXT        NOT NULL,
  progress       INTEGER     NOT NULL DEFAULT 0,
  completed      BOOLEAN     NOT NULL DEFAULT false,
  completed_at   TIMESTAMPTZ,
  reward_claimed BOOLEAN     NOT NULL DEFAULT false,
  period_start   DATE        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, discord_id, quest_key, period_start)
);
CREATE INDEX IF NOT EXISTS idx_community_member_quests_ws_member
  ON community_member_quests (workspace_id, discord_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_community_member_quests_unclaimed
  ON community_member_quests (workspace_id, reward_claimed, completed)
  WHERE completed = true AND reward_claimed = false;

-- ─── 14. workspace_feature_flags ───────────────────────────────────────────────
-- Per-workspace on/off switches and game limits for all Community OS systems.
CREATE TABLE IF NOT EXISTS workspace_feature_flags (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id                TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  ranks_enabled               BOOLEAN     NOT NULL DEFAULT true,
  badges_enabled              BOOLEAN     NOT NULL DEFAULT true,
  hero_enabled                BOOLEAN     NOT NULL DEFAULT true,
  blackjack_enabled           BOOLEAN     NOT NULL DEFAULT true,
  roulette_enabled            BOOLEAN     NOT NULL DEFAULT true,
  prestige_enabled            BOOLEAN     NOT NULL DEFAULT true,
  achievements_enabled        BOOLEAN     NOT NULL DEFAULT true,
  quests_enabled              BOOLEAN     NOT NULL DEFAULT true,
  blackjack_min_bet           INTEGER     NOT NULL DEFAULT 10,
  blackjack_max_bet           INTEGER     NOT NULL DEFAULT 1000,
  blackjack_cooldown_minutes  INTEGER     NOT NULL DEFAULT 5,
  roulette_min_bet            INTEGER     NOT NULL DEFAULT 5,
  roulette_max_bet            INTEGER     NOT NULL DEFAULT 500,
  roulette_cooldown_minutes   INTEGER     NOT NULL DEFAULT 3,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
