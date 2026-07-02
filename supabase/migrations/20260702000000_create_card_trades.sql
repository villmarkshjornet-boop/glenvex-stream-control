-- Migration: create card_trades table for GLENVEX korthandel
-- Run in Supabase SQL editor or via Supabase CLI

CREATE TABLE IF NOT EXISTS public.card_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  from_user_id        TEXT NOT NULL,
  to_user_id          TEXT NOT NULL,
  offered_card_id     UUID NOT NULL,
  requested_card_id   UUID,
  offered_coins       INTEGER NOT NULL DEFAULT 0,
  requested_coins     INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at         TIMESTAMPTZ,
  declined_at         TIMESTAMPTZ
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_card_trades_workspace       ON public.card_trades (workspace_id);
CREATE INDEX IF NOT EXISTS idx_card_trades_from_user       ON public.card_trades (workspace_id, from_user_id);
CREATE INDEX IF NOT EXISTS idx_card_trades_to_user         ON public.card_trades (workspace_id, to_user_id);
CREATE INDEX IF NOT EXISTS idx_card_trades_status          ON public.card_trades (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_card_trades_offered_card    ON public.card_trades (offered_card_id);

-- Enable RLS (but allow service role full access)
ALTER TABLE public.card_trades ENABLE ROW LEVEL SECURITY;

-- Service role bypass (bot uses service role key)
CREATE POLICY "service_role_all" ON public.card_trades
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
