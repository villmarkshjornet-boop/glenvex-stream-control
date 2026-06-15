-- Community Manager V2: streak tracking
-- Run in Supabase SQL editor

ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS streak_days       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_streak_date  date;

COMMENT ON COLUMN community_members.streak_days      IS 'Consecutive days the member has been active';
COMMENT ON COLUMN community_members.last_streak_date IS 'ISO date of the last day streak was updated';
