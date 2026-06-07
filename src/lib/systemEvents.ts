import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface SystemEvent {
  source: string;
  event_type: string;
  title: string;
  description?: string;
  severity?: Severity;
  metadata?: Record<string, any>;
}

export async function logSystemEvent(event: SystemEvent): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('system_events').insert({
      workspace_id: getWorkspaceId(),
      source:       event.source,
      event_type:   event.event_type,
      title:        event.title,
      description:  event.description ?? null,
      severity:     event.severity    ?? 'info',
      metadata:     event.metadata    ?? null,
    });
  } catch {}
}
