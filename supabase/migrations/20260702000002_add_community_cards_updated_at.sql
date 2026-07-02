-- Migration: add updated_at to community_cards
--
-- community_cards was created without updated_at.
-- tradeService.ts writes updated_at when transferring card ownership,
-- causing "could not find the updated_at column" errors during trades.
--
-- Adds the column, backfills existing rows from created_at,
-- then locks in NOT NULL + default so future inserts are consistent.

ALTER TABLE community_cards
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill: existing rows get their created_at value (not NOW())
-- so history is accurate rather than stamped with migration time.
UPDATE community_cards
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- Now enforce NOT NULL and set default for future inserts
ALTER TABLE community_cards
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- Index to support time-ordered queries on updated_at
CREATE INDEX IF NOT EXISTS idx_community_cards_updated_at
  ON community_cards (workspace_id, updated_at DESC);

-- Reload PostgREST schema cache so the new column is visible immediately
NOTIFY pgrst, 'reload schema';
