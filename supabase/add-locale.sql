-- i18n: add locale column to workspaces
-- Default 'no' — existing workspaces stay Norwegian

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'no'
  CHECK (locale IN ('no', 'en'));

COMMENT ON COLUMN workspaces.locale IS 'UI language preference: no (Norwegian) or en (English)';
