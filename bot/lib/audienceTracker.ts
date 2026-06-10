/**
 * Audience tracking for Twitch streams.
 *
 * Architecture:
 *   - In-memory Map is the live cache (fast, low-latency per message)
 *   - Supabase ai_agent_events is source of truth (AUDIENCE_SNAPSHOT every 2 min)
 *   - On Railway restart: restoreFromSnapshot() reloads sessions from latest DB snapshot
 *   - AUDIENCE_TRACKING_HEARTBEAT written every 2 min → dashboard can show live status
 *   - Errors → AUDIENCE_TRACKING_FAILED in system_events
 */

import { logBotAgentEvent } from './agentLogger';
import { logSystemEvent } from './systemEvents';

const DEFAULT_WORKSPACE_ID  = process.env.WORKSPACE_ID ?? 'glenvex-default';
const HEARTBEAT_INTERVAL_MS = 2 * 60_000;

// Kan overstyres per-stream av startAudienceTracking for multi-tenant.
let currentWorkspaceId = DEFAULT_WORKSPACE_ID;

interface ViewerSession {
  username: string;
  firstSeen: string;
  lastSeen: string;
  messagesSent: number;
  follower: boolean;
  subscriber: boolean;
  moderator: boolean;
  vip: boolean;
}

const activeSessions = new Map<string, ViewerSession>();
let activeStreamId: string | null = null;
let retentionSnapshots: Array<{ ts: string; count: number }> = [];
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ── Start tracking ────────────────────────────────────────────────────────────

export function startAudienceTracking(streamId: string, game: string, title: string, workspaceId?: string): void {
  currentWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  activeSessions.clear();
  retentionSnapshots = [];
  activeStreamId = streamId;

  // Attempt to restore previous snapshot (handles Railway restart mid-stream)
  restoreFromSnapshot(streamId).catch(err => {
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'AUDIENCE_TRACKING_FAILED',
      title: `Snapshot-gjenoppretting feilet: ${err?.message ?? 'ukjent'}`,
      severity: 'error',
      metadata: { streamId, error: err?.message },
    });
  });

  // Periodic heartbeat + Supabase flush
  heartbeatTimer = setInterval(() => {
    writeHeartbeatAndFlush().catch(err => {
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'AUDIENCE_TRACKING_FAILED',
        title: `Heartbeat/snapshot feilet: ${err?.message ?? 'ukjent'}`,
        severity: 'error',
        metadata: { streamId: activeStreamId ?? streamId, error: err?.message },
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  logSystemEvent({
    workspaceId: currentWorkspaceId,
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_STARTED',
    title: `Publikumssporing startet: ${(title || game).slice(0, 60)}`,
    severity: 'info',
    metadata: { workspaceId: currentWorkspaceId, streamId, game, title },
  });
}

// ── Record viewer activity ────────────────────────────────────────────────────

export function recordViewerActivity(
  username: string,
  tags: {
    subscriber?: boolean | string;
    mod?: boolean;
    vip?: boolean;
    badges?: Record<string, string | undefined>;
  }
): void {
  if (!activeStreamId || !username) return;

  const now = new Date().toISOString();
  const lower = username.toLowerCase();
  const existing = activeSessions.get(lower);

  const isSubscriber = tags.subscriber === true || tags.subscriber === '1' || tags.subscriber === 'true';
  const isMod = !!tags.mod;
  const isVip = !!(tags.badges?.vip);
  const isFollower = !!(tags.badges?.subscriber || tags.badges?.founder) || isSubscriber;

  if (existing) {
    existing.lastSeen = now;
    existing.messagesSent++;
    if (isSubscriber) existing.subscriber = true;
    if (isMod) existing.moderator = true;
    if (isVip) existing.vip = true;
    if (isFollower) existing.follower = true;
  } else {
    activeSessions.set(lower, {
      username,
      firstSeen: now,
      lastSeen: now,
      messagesSent: 1,
      follower: isFollower,
      subscriber: isSubscriber,
      moderator: isMod,
      vip: isVip,
    });
  }
}

// ── Record viewer count (for retention curve) ─────────────────────────────────

export function recordViewerCount(count: number): void {
  if (!activeStreamId) return;
  retentionSnapshots.push({ ts: new Date().toISOString(), count });
}

// ── Heartbeat + snapshot ──────────────────────────────────────────────────────

async function writeHeartbeatAndFlush(): Promise<void> {
  if (!activeStreamId) return;
  const streamId = activeStreamId;
  const sessions = Array.from(activeSessions.values());

  // Heartbeat to system_events (lightweight, for dashboard live status)
  logSystemEvent({
    workspaceId: currentWorkspaceId,
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_HEARTBEAT',
    title: `Audience tracking aktiv – ${sessions.length} brukere observert`,
    severity: 'info',
    metadata: {
      workspaceId: currentWorkspaceId,
      streamId,
      totalObserved: sessions.length,
      subscribers: sessions.filter(s => s.subscriber).length,
      activeChattters: sessions.filter(s => s.messagesSent > 0).length,
      lastViewerCount: retentionSnapshots[retentionSnapshots.length - 1]?.count ?? 0,
      retentionDatapoints: retentionSnapshots.length,
    },
  });

  // Full snapshot to ai_agent_events (for Stream Coach + restart recovery)
  await writeSnapshotDirect(streamId, sessions);
}

async function writeSnapshotDirect(streamId: string, sessions: ViewerSession[]): Promise<void> {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  const res = await fetch(`${sbUrl}/rest/v1/ai_agent_events`, {
    method: 'POST',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      workspace_id: currentWorkspaceId,
      source: 'twitch',
      event_type: 'AUDIENCE_SNAPSHOT',
      importance_score: 70,
      metadata: {
        stream_id: streamId,
        viewers: sessions,
        retention_snapshots: retentionSnapshots,
        snapshot_at: new Date().toISOString(),
        total: sessions.length,
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
}

// ── Restore from snapshot (Railway restart recovery) ─────────────────────────

async function restoreFromSnapshot(streamId: string): Promise<void> {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  const wsEncoded = encodeURIComponent(currentWorkspaceId);
  // Twitch stream IDs are numeric — safe to embed directly in the URL filter.
  // Server-side filter on both workspace_id AND metadata stream_id prevents
  // cross-stream or cross-workspace restore contamination.
  const res = await fetch(
    `${sbUrl}/rest/v1/ai_agent_events` +
    `?workspace_id=eq.${wsEncoded}` +
    `&event_type=eq.AUDIENCE_SNAPSHOT` +
    `&metadata->>stream_id=eq.${encodeURIComponent(streamId)}` +
    `&order=created_at.desc&limit=1` +
    `&select=metadata,created_at`,
    {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!res.ok) return;

  const rows = await res.json() as Array<{ metadata: any; created_at: string }>;
  if (!rows.length) return;

  const latest = rows[0];
  const viewers: ViewerSession[] = latest.metadata?.viewers ?? [];
  if (!viewers.length) return;

  let restoredCount = 0;
  for (const session of viewers) {
    const key = session.username.toLowerCase();
    // Don't overwrite sessions updated by new chat activity during restore window
    if (!activeSessions.has(key)) {
      activeSessions.set(key, session);
      restoredCount++;
    }
  }

  // Restore retention curve
  const snapshots = latest.metadata?.retention_snapshots;
  if (Array.isArray(snapshots) && snapshots.length > retentionSnapshots.length) {
    retentionSnapshots = snapshots;
  }

  console.log(`[AudienceTracker] Restored ${restoredCount} sessions from ${latest.created_at}`);

  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_RESUMED',
    title: `Audience tracking gjenopptatt: ${restoredCount} sessions fra Supabase`,
    severity: 'info',
    metadata: {
      streamId,
      restoredCount,
      snapshotAt: latest.created_at,
    },
  });
}

// ── Stop tracking ─────────────────────────────────────────────────────────────

export async function stopAudienceTracking(): Promise<void> {
  if (!activeStreamId) return;

  // Stop the timer and capture+clear state immediately.
  // activeStreamId = null before any await so heartbeats can't fire after stop,
  // and so STOPPED is always reachable even if enrichment throws.
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const streamId = activeStreamId;
  const stoppedWorkspaceId = currentWorkspaceId;
  const sessions = Array.from(activeSessions.values());
  const retentionCopy = retentionSnapshots.slice();
  activeSessions.clear();
  retentionSnapshots = [];
  activeStreamId = null;

  // Enrichment + agent events — wrapped so STOPPED is always written below
  let enriched: ReturnType<typeof sessions.map> = sessions;
  try {
    const knownViewers = await fetchKnownViewers();
    enriched = sessions.map(s => ({
      ...s,
      returningViewer: knownViewers.has(s.username.toLowerCase()),
      firstTimeSeen: !knownViewers.has(s.username.toLowerCase()),
    }));

    // Final AUDIENCE_SESSION_COMPLETE (Stream Coach reads this)
    if (enriched.length > 0) {
      logBotAgentEvent({
        source: 'twitch',
        event_type: 'AUDIENCE_SESSION_COMPLETE',
        importance_score: 90,
        metadata: {
          stream_id: streamId,
          viewers: enriched,
          total: enriched.length,
          new_viewers: enriched.filter(v => !(v as any).returningViewer).length,
          returning_viewers: enriched.filter(v => (v as any).returningViewer).length,
          subscribers: enriched.filter(v => v.subscriber).length,
          moderators: enriched.filter(v => v.moderator).length,
          vips: enriched.filter(v => v.vip).length,
          active_chatters: enriched.filter(v => v.messagesSent > 0).length,
          top_chatters: [...enriched]
            .sort((a, b) => b.messagesSent - a.messagesSent)
            .slice(0, 10)
            .map(v => ({ username: v.username, messages: v.messagesSent })),
        },
      });
    }

    // Final retention curve (Stream Coach reads this)
    if (retentionCopy.length > 0) {
      logBotAgentEvent({
        source: 'twitch',
        event_type: 'RETENTION_CURVE',
        importance_score: 80,
        metadata: {
          stream_id: streamId,
          snapshots: retentionCopy,
        },
      });
    }
  } catch (err: any) {
    logSystemEvent({
      workspaceId: stoppedWorkspaceId,
      source: 'twitch_bot',
      event_type: 'AUDIENCE_TRACKING_FAILED',
      title: `Feil ved avslutning av audience tracking: ${err?.message ?? 'ukjent'}`,
      severity: 'error',
      metadata: { workspaceId: stoppedWorkspaceId, streamId, error: err?.message },
    });
  }

  // Always written — even if enrichment threw above
  logSystemEvent({
    workspaceId: stoppedWorkspaceId,
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_STOPPED',
    title: `Publikumssporing ferdig: ${enriched.length} brukere`,
    severity: 'info',
    metadata: {
      workspaceId: stoppedWorkspaceId,
      streamId,
      totalObserved: enriched.length,
      newViewers: enriched.filter(v => !(v as any).returningViewer).length,
      returningViewers: enriched.filter(v => (v as any).returningViewer).length,
      subscribers: enriched.filter(v => v.subscriber).length,
    },
  });
}

// ── Fetch known viewers (returning viewer detection) ──────────────────────────

async function fetchKnownViewers(): Promise<Set<string>> {
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return new Set();

    const res = await fetch(
      `${sbUrl}/rest/v1/ai_agent_memory?workspace_id=eq.${encodeURIComponent(currentWorkspaceId)}&memory_type=eq.viewer&select=key`,
      {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return new Set();
    const data = await res.json() as Array<{ key: string }>;
    return new Set(data.map(d => d.key.toLowerCase()));
  } catch {
    return new Set();
  }
}
