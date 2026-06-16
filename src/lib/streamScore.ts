import { getDb } from './db';

export interface StreamScore {
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  breakdown: { viewers: number; retention: number; chat: number; growth: number; community: number };
}

export function calcStreamScore(stream: any, audience: any): StreamScore {
  const peak = stream?.peak_viewers ?? 0;
  const avg = stream?.avg_viewers ?? 0;
  const chat = stream?.chat_messages ?? 0;
  const duration = stream?.duration_minutes ?? 0;
  const followers = stream?.followers_gained ?? 0;
  const subs = stream?.subs_gained ?? 0;
  const raids = stream?.raids_during ?? 0;

  const viewers = Math.min(20, (peak / 30) * 20);
  const retention = peak > 0 ? Math.min(20, (avg / peak) * 20) : 0;
  const chatPerHour = duration > 0 ? chat / (duration / 60) : 0;
  const chatScore = Math.min(20, (chatPerHour / 80) * 20);
  const growthScore = Math.min(20, (followers / 4) * 15 + (subs / 3) * 5);
  const communityScore = Math.min(20, (raids / 2) * 10 + (audience?.subscribers ?? 0) * 0.5);

  const total = Math.round(viewers + retention + chatScore + growthScore + communityScore);
  const grade = total >= 80 ? 'S' : total >= 65 ? 'A' : total >= 50 ? 'B' : total >= 35 ? 'C' : 'D';

  return {
    total: Math.min(100, total),
    grade,
    breakdown: {
      viewers: Math.round(viewers),
      retention: Math.round(retention),
      chat: Math.round(chatScore),
      growth: Math.round(growthScore),
      community: Math.round(communityScore),
    },
  };
}

/**
 * Bygger en syntetisk stream-rapport fra ai_agent_events når stream_history mangler raden.
 * Brukt av Stream Coach og Dashboard Hero så de aldri viser "ingen stream" når ekte event-data finnes.
 */
export async function buildFallbackFromEvents(db: NonNullable<ReturnType<typeof getDb>>, workspaceId: string) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: events } = await db
    .from('ai_agent_events')
    .select('event_type, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .in('event_type', ['AUDIENCE_SESSION_COMPLETE', 'RETENTION_CURVE', 'AUDIENCE_SNAPSHOT', 'active_chatter', 'stream_offline'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  if (!events || events.length === 0) return null;

  const withStreamId = events.find(e => (e.metadata as any)?.stream_id);
  const targetStreamId: string | null = withStreamId ? (withStreamId.metadata as any).stream_id : null;

  // Grupper events som hører til samme stream: match på stream_id hvis tilgjengelig,
  // ellers fall tilbake til et 6-timers tidsvindu fra siste event som proxy for "samme stream".
  const grouped = targetStreamId
    ? events.filter(e => (e.metadata as any)?.stream_id === targetStreamId)
    : events.filter(e => new Date(events[0].created_at).getTime() - new Date(e.created_at).getTime() <= 6 * 3600_000);

  if (grouped.length === 0) return null;

  const sessionComplete = grouped.find(e => e.event_type === 'AUDIENCE_SESSION_COMPLETE');
  const retention = grouped.find(e => e.event_type === 'RETENTION_CURVE');
  const snapshot = grouped.find(e => e.event_type === 'AUDIENCE_SNAPSHOT');
  const offline = grouped.find(e => e.event_type === 'stream_offline');

  const meta = ((sessionComplete ?? snapshot)?.metadata ?? {}) as any;
  const retentionMeta = (retention?.metadata ?? {}) as any;
  const snapshots: Array<{ ts: string; count: number }> = retentionMeta.snapshots ?? [];

  const oldestEvent = grouped[grouped.length - 1];
  const startedAt = snapshots[0]?.ts ?? oldestEvent.created_at;
  const endedAt = offline?.created_at ?? sessionComplete?.created_at ?? grouped[0].created_at;

  const durationMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));
  const peak = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.count)) : (meta.total ?? 0);
  const avg = snapshots.length > 0 ? Math.round(snapshots.reduce((sum, s) => sum + s.count, 0) / snapshots.length) : (meta.total ?? 0);
  const chatMessages = Array.isArray(meta.viewers)
    ? meta.viewers.reduce((sum: number, v: any) => sum + (v.messagesSent ?? v.messages_sent ?? 0), 0)
    : (meta.active_chatters ?? 0);

  const syntheticStream = {
    id: targetStreamId ?? `fallback-${oldestEvent.created_at}`,
    stream_id: targetStreamId,
    title: meta.title ?? '',
    game: meta.game ?? '',
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: durationMinutes,
    peak_viewers: peak,
    avg_viewers: avg,
    chat_messages: chatMessages,
    followers_gained: 0,
    subs_gained: meta.subscribers ?? 0,
    raids_during: 0,
  };

  const audienceData = (sessionComplete || snapshot) ? {
    viewers: meta.viewers ?? [],
    total: meta.total ?? 0,
    newViewers: meta.new_viewers ?? 0,
    returningViewers: meta.returning_viewers ?? 0,
    subscribers: meta.subscribers ?? 0,
    moderators: meta.moderators ?? 0,
    vips: meta.vips ?? 0,
    activeChattters: meta.active_chatters ?? 0,
    topChattters: meta.top_chatters ?? [],
    lurkers: (meta.total ?? 0) - (meta.active_chatters ?? 0),
  } : null;

  const retentionCurve = snapshots.length > 0
    ? snapshots.map(s => ({
        ts: s.ts,
        count: s.count,
        minuteFromStart: Math.round((new Date(s.ts).getTime() - new Date(startedAt).getTime()) / 60_000),
      })).filter(s => s.minuteFromStart >= 0)
    : null;

  return { syntheticStream, audienceData, retentionCurve };
}
