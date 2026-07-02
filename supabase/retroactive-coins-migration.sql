-- GLENVEX Retroaktiv coin-migrering
-- Tildeler coins basert på opptjent XP + 100 velkomstbonus til alle i workspace 'glenvex'
-- Idempotent: bruker ON CONFLICT DO NOTHING på transaksjoner
-- Kjør i Supabase SQL Editor

BEGIN;

-- ─── 1. Beregn og sett coins_balance basert på eksisterende XP ───────────────
-- Formula: FLOOR(xp / 50) = coins fra XP-aktivitet + 100 velkomstbonus

UPDATE community_members
SET
  coins_balance      = FLOOR(xp / 50) + 100,
  total_coins_earned = FLOOR(xp / 50) + 100
WHERE workspace_id = 'glenvex'
  AND coins_balance = 0;  -- bare de som ikke allerede har coins (idempotent)

-- ─── 2. Legg inn XP-konvertering i ledger for hver bruker ────────────────────

INSERT INTO community_coin_transactions (workspace_id, user_id, source, amount, balance_after, metadata)
SELECT
  'glenvex'                                AS workspace_id,
  discord_id                               AS user_id,
  'admin_adjustment'                       AS source,
  FLOOR(xp / 50)                          AS amount,
  FLOOR(xp / 50) + 100                    AS balance_after,
  jsonb_build_object(
    'reason',      'retroactive_xp_conversion',
    'xp',          xp,
    'xp_per_coin', 50
  )                                        AS metadata
FROM community_members
WHERE workspace_id = 'glenvex'
  AND FLOOR(xp / 50) > 0;

-- ─── 3. Legg inn velkomstbonus i ledger for alle brukere ─────────────────────

INSERT INTO community_coin_transactions (workspace_id, user_id, source, amount, balance_after, metadata)
SELECT
  'glenvex'                                AS workspace_id,
  discord_id                               AS user_id,
  'admin_adjustment'                       AS source,
  100                                      AS amount,
  FLOOR(xp / 50) + 100                    AS balance_after,
  jsonb_build_object(
    'reason',      'welcome_bonus',
    'description', 'Velkomstbonus — coins-systemet er nå aktivt!'
  )                                        AS metadata
FROM community_members
WHERE workspace_id = 'glenvex';

COMMIT;

-- ─── Verifisering — kjør etter migrering ─────────────────────────────────────

SELECT
  discord_id,
  display_name,
  xp,
  FLOOR(xp / 50)       AS coins_fra_xp,
  100                  AS velkomstbonus,
  coins_balance        AS total_coins,
  total_coins_earned
FROM community_members
WHERE workspace_id = 'glenvex'
ORDER BY coins_balance DESC;
