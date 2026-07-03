-- Community Cards V2 — Sell, Showcase, Pity System

-- ─── Extend community_cards ────────────────────────────────────────────────────
ALTER TABLE community_cards
  ADD COLUMN IF NOT EXISTS status   TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS sold_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sold_for INTEGER;

-- Add CHECK constraint idempotently
DO $$ BEGIN
  ALTER TABLE community_cards
    ADD CONSTRAINT community_cards_status_check
    CHECK (status IN ('active','sold'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Showcase card on community_members ────────────────────────────────────────
ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS showcase_card_id UUID;

-- ─── Pity draw tracking on community_members ──────────────────────────────────
ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS pity_common_streak        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pity_draws_without_rare   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pity_draws_without_epic   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pity_total_draws          INTEGER NOT NULL DEFAULT 0;

-- Index: active cards for user
CREATE INDEX IF NOT EXISTS idx_community_cards_user_status
  ON community_cards (workspace_id, user_id, status);

-- Index: showcase lookup
CREATE INDEX IF NOT EXISTS idx_community_members_showcase
  ON community_members (workspace_id, showcase_card_id)
  WHERE showcase_card_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
