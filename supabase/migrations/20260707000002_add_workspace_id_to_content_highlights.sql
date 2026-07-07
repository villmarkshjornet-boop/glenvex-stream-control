-- Add workspace_id to content_highlights for proper tenant isolation.
-- Backfill via vod_id → content_vods.workspace_id FK.

ALTER TABLE content_highlights ADD COLUMN IF NOT EXISTS workspace_id TEXT;

UPDATE content_highlights ch
SET workspace_id = cv.workspace_id
FROM content_vods cv
WHERE ch.vod_id = cv.id
  AND ch.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS content_highlights_workspace_id_idx ON content_highlights(workspace_id);

ALTER TABLE content_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_content_highlights" ON content_highlights;
CREATE POLICY "service_role_all_content_highlights"
  ON content_highlights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "user_own_workspace_content_highlights" ON content_highlights;
CREATE POLICY "user_own_workspace_content_highlights"
  ON content_highlights FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));
