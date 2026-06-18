// Stream State Sync — bridges existing stream events to Creator Brain state
// This module is the ONLY place that writes to CreatorState for stream events.
// Existing modules (streamHistory, audienceTracker, twitchBot) are untouched.
// Phase 2 constraint: double-write only. No AI calls. No dashboard changes.
// V3 Architecture: Section 5 (Creator State) + Section 1 (OBSERVE step of Kernel Loop)

import { WORKSPACE_ID } from './supabase';
import { logSystemEvent } from './systemEvents';
import { updateCreatorState, getCreatorState } from './creatorState';

export interface StreamLivePayload {
  streamId: string;
  title: string;
  game: string;
  viewerCount: number | null | undefined;
  startedAt: string;
}

// ─── Live Start ───────────────────────────────────────────────────────────────

export function onStreamLive(payload: StreamLivePayload, workspaceId?: string): void {
  const ws = workspaceId ?? WORKSPACE_ID;

  updateCreatorState(ws, state => {
    state.stream.isLive = true;
    state.stream.streamId = payload.streamId;
    state.stream.title = payload.title;
    state.stream.game = payload.game;
    state.stream.viewerCount = payload.viewerCount ?? 0;
    state.stream.viewerPeak = payload.viewerCount ?? 0;
    state.stream.startedAt = new Date(payload.startedAt);
    state.stream.phase = 'opening';
    state.stream.durationMin = 0;
    state.stream.energy = 'high';
  });

  logSystemEvent({
    workspaceId: ws,
    source: 'creator_brain',
    event_type: 'CREATOR_STATE_UPDATED',
    title: `State: LIVE — ${payload.game}: ${payload.title.slice(0, 60)}`,
    severity: 'info',
    metadata: {
      subtype: 'STREAM_LIVE',
      streamId: payload.streamId,
      game: payload.game,
      title: payload.title,
      viewerCount: payload.viewerCount ?? 0,
      startedAt: payload.startedAt,
    },
  });
}

// ─── Viewer Count Update ──────────────────────────────────────────────────────
// Called every poll cycle (~60s). State is always updated.
// System event only fires on new viewer peak to avoid event flood.

// Tracks the viewer count at last emitted event per workspace.
const _lastEmittedViewers = new Map<string, number>();

export function onViewerUpdate(viewerCount: number, workspaceId?: string): void {
  const ws = workspaceId ?? WORKSPACE_ID;
  const state = getCreatorState(ws);

  if (!state.stream.isLive) return;

  const prevPeak = state.stream.viewerPeak ?? 0;
  const isNewPeak = viewerCount > prevPeak;

  const durationMin = state.stream.startedAt
    ? Math.round((Date.now() - state.stream.startedAt.getTime()) / 60_000)
    : null;

  const phase =
    durationMin === null ? state.stream.phase
    : durationMin < 15   ? 'opening'
    : durationMin < 120  ? 'mid'
    :                      'closing';

  updateCreatorState(ws, s => {
    s.stream.viewerCount = viewerCount;
    if (isNewPeak) s.stream.viewerPeak = viewerCount;
    s.stream.durationMin = durationMin;
    s.stream.phase = phase;
  });

  if (!isNewPeak) return;

  _lastEmittedViewers.set(ws, viewerCount);

  logSystemEvent({
    workspaceId: ws,
    source: 'creator_brain',
    event_type: 'CREATOR_STATE_UPDATED',
    title: `State: ny seer-topp — ${viewerCount} seere (${durationMin ?? '?'} min inn)`,
    severity: 'info',
    metadata: {
      subtype: 'VIEWER_PEAK',
      viewerCount,
      prevPeak,
      durationMin,
      phase,
    },
  });
}

// ─── Stream Offline ───────────────────────────────────────────────────────────

export function onStreamOffline(workspaceId?: string): void {
  const ws = workspaceId ?? WORKSPACE_ID;
  const state = getCreatorState(ws);

  const streamId = state.stream.streamId;
  const durationMin = state.stream.startedAt
    ? Math.round((Date.now() - state.stream.startedAt.getTime()) / 60_000)
    : null;

  updateCreatorState(ws, s => {
    s.stream.isLive = false;
    s.stream.phase = 'post';
    s.stream.durationMin = durationMin;
    s.stream.energy = 'normal';
  });

  _lastEmittedViewers.delete(ws);

  logSystemEvent({
    workspaceId: ws,
    source: 'creator_brain',
    event_type: 'CREATOR_STATE_UPDATED',
    title: `State: OFFLINE — ${durationMin != null ? `${durationMin} min` : 'ukjent varighet'}`,
    severity: 'info',
    metadata: {
      subtype: 'STREAM_OFFLINE',
      streamId,
      durationMin,
      viewerPeak: state.stream.viewerPeak,
    },
  });
}

// ─── Content Pipeline ─────────────────────────────────────────────────────────

export type ContentPipelineStatus =
  | 'CLIP_DONE'
  | 'THUMBNAIL_DONE'
  | 'THUMBNAIL_FAILED'
  | 'VOD_STARTED';

export function onContentPipelineUpdate(opts: {
  status: ContentPipelineStatus;
  highlightId?: string;
  vodId?: string;
  workspaceId?: string;
}): void {
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  updateCreatorState(ws, state => {
    if (opts.status === 'CLIP_DONE' && opts.highlightId) {
      if (!state.contentFactory.activeClipIds.includes(opts.highlightId)) {
        state.contentFactory.activeClipIds.push(opts.highlightId);
        if (state.contentFactory.activeClipIds.length > 20) {
          state.contentFactory.activeClipIds.shift();
        }
      }
    }
    if (opts.status === 'VOD_STARTED' && opts.vodId) {
      state.contentFactory.activeVodId = opts.vodId;
      state.contentFactory.vodStatus = 'PROCESSING';
    }
    if (opts.status === 'THUMBNAIL_DONE' && opts.highlightId) {
      state.contentFactory.pendingThumbnailIds =
        state.contentFactory.pendingThumbnailIds.filter(id => id !== opts.highlightId);
    }
  });

  const titles: Record<ContentPipelineStatus, string> = {
    CLIP_DONE:         'Content: klipp klar til publisering',
    THUMBNAIL_DONE:    'Content: thumbnail ferdig',
    THUMBNAIL_FAILED:  'Content: thumbnail feilet',
    VOD_STARTED:       'Content: VOD-prosessering startet',
  };

  logSystemEvent({
    workspaceId: ws,
    source: 'creator_brain',
    event_type: 'CREATOR_STATE_UPDATED',
    title: titles[opts.status],
    severity: opts.status === 'THUMBNAIL_FAILED' ? 'warning' : 'info',
    metadata: {
      subtype: 'CONTENT_PIPELINE',
      status: opts.status,
      highlightId: opts.highlightId ?? null,
      vodId: opts.vodId ?? null,
    },
  });
}
