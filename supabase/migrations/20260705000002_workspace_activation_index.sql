-- Fast lookup for WorkspaceManager's newly-activated workspace scan
CREATE INDEX IF NOT EXISTS idx_system_events_onboarding_ready
  ON system_events (workspace_id, event_type, created_at DESC)
  WHERE event_type = 'WORKSPACE_ONBOARDING_READY';
