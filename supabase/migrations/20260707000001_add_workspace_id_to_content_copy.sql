-- Add workspace_id to content_copy for proper tenant isolation.
-- Previously content_copy had no workspace_id — only vod_id/highlight_id.
-- This migration adds the column and backfills from joined tables.

ALTER TABLE content_copy ADD COLUMN IF NOT EXISTS workspace_id TEXT;

-- Backfill via direct vod_id FK (content_highlights has no workspace_id column)
UPDATE content_copy cc
SET workspace_id = cv.workspace_id
FROM content_vods cv
WHERE cc.vod_id = cv.id
  AND cc.workspace_id IS NULL;

-- Backfill remaining rows via highlight → vod chain
UPDATE content_copy cc
SET workspace_id = cv.workspace_id
FROM content_highlights ch
JOIN content_vods cv ON ch.vod_id = cv.id
WHERE cc.highlight_id = ch.id
  AND cc.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS content_copy_workspace_id_idx ON content_copy(workspace_id);

-- Enable RLS and add policy matching other content tables
ALTER TABLE content_copy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_content_copy" ON content_copy;
CREATE POLICY "service_role_all_content_copy"
  ON content_copy FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "user_own_workspace_content_copy" ON content_copy;
CREATE POLICY "user_own_workspace_content_copy"
  ON content_copy FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));
