export interface HealthItem { ok: boolean; melding: string; }
export interface HealthData {
  twitch: HealthItem; discord: HealthItem; scheduler: HealthItem;
  contentFactory: HealthItem; clipWorker: HealthItem; supabase: HealthItem; openai: HealthItem;
}
export interface SlowData {
  health: HealthData;
  streamStatus: {
    isLive: boolean; viewers: number; game: string | null; title: string | null;
    thumbnailUrl: string | null;
    startedAt: string | null;
    nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  };
  meta: { hentetKl: string };
}
export interface SystemEvent {
  id: string;
  source: string;
  event_type: string;
  title: string;
  description?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata?: Record<string, any>;
  created_at: string;
}
export interface KlippetHighlight {
  id: string; vodId: string; title: string | null; vodTitle: string | null;
  clip_url_16_9: string | null; clip_url_9_16: string | null; clippedAt: string;
}
export interface AiInnsikt {
  title: string; summary: string; confidenceScore: number; createdAt: string;
}
export interface VodStatus {
  id: string; title: string; status: string; progressPercent: number | null;
  statusMessage: string | null; errorMessage: string | null; createdAt: string;
  highlights: number; klipp: number; readyForClip: number; clipping: number;
}
export interface LærdommTiltak { summary: string; game?: string | null; executedAt: string; agentType?: string; }
export interface Lærdom {
  utførteTiltak: LærdommTiltak[];
  avvisteTiltak: { summary: string; executedAt: string }[];
  raidHistorikk: { summary: string; executedAt: string }[];
  totalDatapunkter: number;
  confidenceLabel: string;
  siste30dager: { utført: number; avvist: number; raids: number; analyser: number };
  notat: string;
}
export interface AiLearning {
  lastAggregation: string | null;
  lastAggregationTitle: string | null;
  lastFeedbackRun: string | null;
  lastFeedbackTitle: string | null;
  lastMemoryUpdate: string | null;
  lastInsightAt: string | null;
  eventsLast60min: number;
  decisionsLast24h: number;
  feedbackDecisionsLast24h: number;
  sisteInnsikt: { title: string; summary: string; createdAt: string } | null;
}
export interface RaidTarget {
  username: string; login: string; viewers: number; game: string; score: number; grunn: string; url: string;
}

export interface HeroStream {
  streamId: string;
  title: string;
  game: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  peakViewers: number;
  avgViewers: number;
  chatMessages: number;
  uniqueChatters: number;
  streamScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  scoreBreakdown: { viewers: number; retention: number; chat: number; growth: number; community: number };
  checklist: {
    streamHistory: boolean;
    audienceData: boolean;
    retentionCurve: boolean;
    chatEvents: boolean;
    streamCoach: boolean;
    vodDetected: boolean;
    aiLearning: boolean;
  };
  ok: boolean;
  failureReasons: string[];
  historyMissingReason: string | null;
  source?: 'stream_history' | 'vod_recovery' | 'event_fallback';
  dataIntegrity: {
    status: 'full' | 'partial' | 'broken';
    botStatus: 'ok' | 'crashed' | 'offline' | 'auth_failed' | 'unknown' | 'manual_repair';
    missingDataReasons: Array<{ source: string; expected: string; reason: string; lastSeen: string | null }>;
    repairedSources?: Array<{ source: string; note: string; repairedAt: string }>;
  };
}

export interface ActionCenterItem {
  type: string;
  priority: 'error' | 'warning' | 'action';
  title: string;
  detail?: string;
  href: string;
  createdAt: string;
}

export interface RecentStream {
  streamId: string;
  title: string;
  game: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  peakViewers: number;
  avgViewers: number;
  streamScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  retentionPct: number;
  broken?: boolean;
}

export interface CoverageEntry {
  key: string; label: string; lastSeen: string | null;
  status: 'active' | 'stale' | 'offline' | 'passive';
  count24h: number; passive: boolean; errors24h: number;
}

export interface LiveAgentTip {
  id: string; category: string; message: string;
  reasoning?: string | null; priority: number; created_at: string;
}

export interface PollManagerData {
  activePoll: { id: string; pollType: string; question: string; options: { label: string }[]; createdAt: string; reason: string | null } | null;
  lastPoll: { id: string; pollType: string; question: string; winner: string | null; totalVotes: number; closedAt: string | null; reason: string | null } | null;
  pollLearning: string | null;
  totalPollsThisStream: number;
}

export interface LiveData {
  activeJobs: { agent: string; task: string; progress: number; href: string; detail?: string }[];
  sjekkliste:  { label: string; done: boolean; href: string }[];
  sisteResultater: VodStatus[];
  nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  preHype: { status: 'klar'|'planlagt'|'sendt'|'ikke_planlagt'; sendtAt: string|null; tidTilUtsending: string|null } | null;
  clipStatus: { clipping: number; readyForClip: number; sisteKlippede: KlippetHighlight[] };
  nyesteInnsikter: AiInnsikt[];
  liveEvents: any[];
  systemEvents: SystemEvent[];
  kontrollsenter?: { key: string; label: string; status: 'ok'|'feil'|'ingen_aktivitet'; sisteKjøring: string|null; sisteEvent: string|null; sisteTitle: string|null; antall24h: number }[];
  coverage?: CoverageEntry[];
  lærdom?: Lærdom;
  aiLearning?: AiLearning;
  heroStream?: HeroStream | null;
  actionCenter?: ActionCenterItem[];
  liveAgentTips?: LiveAgentTip[];
  pollManager?: PollManagerData | null;
  twitchAuthStatus?: 'ok' | 'token_fetch_failed' | 'auth_failed' | 'unknown';
  recentStreams?: RecentStream[];
  lastVodSync?: {
    checkedAt: string | null;
    vodFound: boolean | null;
    lastVodTitle: string | null;
  };
  debug?: Record<string, any>;
  ts: string;
}
