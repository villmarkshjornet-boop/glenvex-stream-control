import { createClient } from '@supabase/supabase-js';

type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface SystemEvent {
  workspaceId?: string;
  source: string;
  event_type: string;
  title: string;
  description?: string;
  severity?: Severity;
  metadata?: Record<string, any>;
}

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';

let _queue: SystemEvent[] = [];
let _flushing = false;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Node.js < 22 mangler native WebSocket — må sende ws-pakken eksplisitt
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(flush, 5_000);
}

async function flush() {
  _flushTimer = null;
  if (_flushing || _queue.length === 0) return;
  _flushing = true;
  const batch = _queue.splice(0, _queue.length);
  try {
    const sb = getClient();
    if (!sb) return;
    const { error } = await sb.from('system_events').insert(
      batch.map(e => ({
        workspace_id: e.workspaceId ?? WORKSPACE_ID,
        source:       e.source,
        event_type:   e.event_type,
        title:        e.title,
        description:  e.description ?? null,
        severity:     e.severity    ?? 'info',
        metadata:     e.metadata    ?? null,
      }))
    );
    if (error) {
      console.error('[SystemEvents] Flush feilet:', error.message);
      _queue = [...batch.slice(0, 50), ..._queue];
    }
  } catch (err: any) {
    console.error('[SystemEvents] Flush exception:', err?.message);
    _queue = [...batch.slice(0, 50), ..._queue];
  } finally {
    _flushing = false;
  }
}

export function logSystemEvent(event: SystemEvent): void {
  _queue.push(event);
  if (_queue.length > 200) _queue = _queue.slice(-200);
  scheduleFlush();
}

export async function logSystemEventNow(event: SystemEvent): Promise<void> {
  const sb = getClient();
  if (!sb) { logSystemEvent(event); return; }
  try {
    const { error } = await sb.from('system_events').insert({
      workspace_id: event.workspaceId ?? WORKSPACE_ID,
      source:       event.source,
      event_type:   event.event_type,
      title:        event.title,
      description:  event.description ?? null,
      severity:     event.severity    ?? 'info',
      metadata:     event.metadata    ?? null,
    });
    if (error) logSystemEvent(event);
  } catch {
    logSystemEvent(event);
  }
}

export function startSystemEventsFlusher(): void {
  setInterval(flush, 5_000);
}

/**
 * Log a MISSION_COMPLETED event from the bot side.
 * Used by poll manager, partner promo, raid, etc. to auto-complete missions
 * without requiring the user to click "Gjort ✓" manually.
 */
export function completeMission(
  workspaceId: string,
  missionId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
): void {
  logSystemEvent({
    workspaceId,
    source: 'bot',
    event_type: 'MISSION_COMPLETED',
    title: `Mission auto-fullført: ${missionId}`,
    severity: 'info',
    metadata: { missionId, reason, ...metadata },
  });
}
