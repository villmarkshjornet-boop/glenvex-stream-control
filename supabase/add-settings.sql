-- Legg til settings-kolonne på workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}';
