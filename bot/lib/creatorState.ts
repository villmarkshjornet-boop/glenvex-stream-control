// Creator State — real-time in-memory snapshot of GLENVEX
// Read < 5ms (always in-memory). Only Creator Brain kernel mutates this.
// V3 Architecture: Section 5 — Creator State + Supplement A (kernel owns state)

export type StreamPhase = 'pre' | 'opening' | 'mid' | 'closing' | 'post' | null;
export type EnergyLevel = 'high' | 'normal' | 'low' | 'declining';
export type ChatActivity = 'spike' | 'high' | 'normal' | 'low' | 'silent';
export type ServiceStatus = 'ok' | 'degraded' | 'offline';

export interface CreatorState {
  workspaceId: string;
  updatedAt: Date;

  stream: {
    isLive: boolean;
    streamId: string | null;
    game: string | null;
    title: string | null;
    viewerCount: number | null;
    viewerPeak: number | null;
    startedAt: Date | null;
    phase: StreamPhase;
    durationMin: number | null;
    energy: EnergyLevel;
    // Historical 30-day viewer average — cached from stream_history at stream start.
    // Avoids a DB round-trip on every promo check. Null until first stream in session.
    avgViewers30d: number | null;
  };

  community: {
    chatActivity: ChatActivity;
    chatMsgsLastMin: number;
    lastRaidAt: Date | null;
    lastRaidFrom: string | null;
    promosThisStream: number;
    lastPromoAt: Date | null;
  };

  contentFactory: {
    activeVodId: string | null;
    vodStatus: string | null;
    activeClipIds: string[];
    pendingThumbnailIds: string[];
  };

  health: {
    botDiscord: ServiceStatus;
    botTwitch: ServiceStatus;
    contentFactory: ServiceStatus;
    lastHeartbeatAt: Date | null;
    initializedAt: Date | null;
  };
}

function makeDefaultState(workspaceId: string): CreatorState {
  return {
    workspaceId,
    updatedAt: new Date(),
    stream: {
      isLive: false,
      streamId: null,
      game: null,
      title: null,
      viewerCount: null,
      viewerPeak: null,
      startedAt: null,
      phase: null,
      durationMin: null,
      energy: 'normal',
      avgViewers30d: null,
    },
    community: {
      chatActivity: 'silent',
      chatMsgsLastMin: 0,
      lastRaidAt: null,
      lastRaidFrom: null,
      promosThisStream: 0,
      lastPromoAt: null,
    },
    contentFactory: {
      activeVodId: null,
      vodStatus: null,
      activeClipIds: [],
      pendingThumbnailIds: [],
    },
    health: {
      botDiscord: 'ok',
      botTwitch: 'ok',
      contentFactory: 'ok',
      lastHeartbeatAt: null,
      initializedAt: null,
    },
  };
}

const _states = new Map<string, CreatorState>();

export function getCreatorState(workspaceId: string): CreatorState {
  if (!_states.has(workspaceId)) {
    _states.set(workspaceId, makeDefaultState(workspaceId));
  }
  return _states.get(workspaceId)!;
}

// Only Creator Brain kernel calls this. Modules do not mutate state directly.
export function updateCreatorState(
  workspaceId: string,
  patch: (draft: CreatorState) => void
): void {
  const state = getCreatorState(workspaceId);
  patch(state);
  state.updatedAt = new Date();
}
