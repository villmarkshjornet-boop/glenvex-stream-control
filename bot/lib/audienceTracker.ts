/**
 * Audience tracking for Twitch streams.
 * Stores one consolidated AUDIENCE_SESSION_COMPLETE event and one RETENTION_CURVE
 * event per stream into ai_agent_events (existing architecture — no new tables).
 */

import { logBotAgentEvent } from './agentLogger';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

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

export function startAudienceTracking(streamId: string, game: string, title: string): void {
  activeSessions.clear();
  retentionSnapshots = [];
  activeStreamId = streamId;

  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_STARTED',
    title: `Publikumssporing startet: ${(title || game).slice(0, 60)}`,
    severity: 'info',
    metadata: { streamId, game, title },
  });
}

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

export function recordViewerCount(count: number): void {
  if (!activeStreamId) return;
  retentionSnapshots.push({ ts: new Date().toISOString(), count });
}

export async function stopAudienceTracking(): Promise<void> {
  if (!activeStreamId) return;

  const streamId = activeStreamId;
  const sessions = Array.from(activeSessions.values());

  const knownViewers = await fetchKnownViewers();

  const enriched = sessions.map(s => ({
    ...s,
    returningViewer: knownViewers.has(s.username.toLowerCase()),
    firstTimeSeen: !knownViewers.has(s.username.toLowerCase()),
  }));

  if (enriched.length > 0) {
    logBotAgentEvent({
      source: 'twitch',
      event_type: 'AUDIENCE_SESSION_COMPLETE',
      importance_score: 90,
      metadata: {
        stream_id: streamId,
        viewers: enriched,
        total: enriched.length,
        new_viewers: enriched.filter(v => !v.returningViewer).length,
        returning_viewers: enriched.filter(v => v.returningViewer).length,
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

  if (retentionSnapshots.length > 0) {
    logBotAgentEvent({
      source: 'twitch',
      event_type: 'RETENTION_CURVE',
      importance_score: 80,
      metadata: {
        stream_id: streamId,
        snapshots: retentionSnapshots,
      },
    });
  }

  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'AUDIENCE_TRACKING_STOPPED',
    title: `Publikumssporing ferdig: ${enriched.length} brukere, ${enriched.filter(v => !v.returningViewer).length} nye`,
    severity: 'info',
    metadata: {
      streamId,
      totalObserved: enriched.length,
      newViewers: enriched.filter(v => !v.returningViewer).length,
      returningViewers: enriched.filter(v => v.returningViewer).length,
      subscribers: enriched.filter(v => v.subscriber).length,
    },
  });

  activeSessions.clear();
  retentionSnapshots = [];
  activeStreamId = null;
}

async function fetchKnownViewers(): Promise<Set<string>> {
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return new Set();

    const res = await fetch(
      `${sbUrl}/rest/v1/ai_agent_memory?workspace_id=eq.${encodeURIComponent(WORKSPACE_ID)}&memory_type=eq.viewer&select=key`,
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
