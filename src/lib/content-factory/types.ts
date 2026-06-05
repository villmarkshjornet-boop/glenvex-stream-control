export type VodStatus = 'PENDING' | 'DOWNLOADING' | 'TRANSCRIBING' | 'ANALYZING' | 'COMPLETE' | 'FAILED';
export type AssetType = 'SHORTS' | 'TIKTOK' | 'REEL' | 'YOUTUBE_HIGHLIGHT' | 'LONGFORM';
export type AssetFormat = '9:16' | '16:9' | '1:1';
export type AssetStatus = 'PENDING' | 'RENDERING' | 'READY' | 'FAILED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PipelineStep = 'DOWNLOAD' | 'TRANSCRIBE' | 'DISCOVER' | 'RANK' | 'CUT' | 'SUBTITLE' | 'RENDER' | 'COPYWRITE' | 'QUEUE';
export type HighlightCategory = 'FUNNY' | 'FAIL' | 'CLUTCH' | 'RAGE' | 'REACTION' | 'TACTICAL' | 'RP_MOMENT' | 'EDUCATIONAL';

export interface ContentVod {
  id: string;
  workspaceId: string;
  streamId: string;
  twitchVodId?: string;
  title?: string;
  category?: string;
  durationSeconds: number;
  status: VodStatus;
  vodUrl?: string;
  thumbnailUrl?: string;
  startedAt?: string;
  createdAt: string;
}

export interface ContentTranscript {
  id: string;
  vodId: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
}

export interface ContentHighlight {
  id: string;
  vodId: string;
  startTime: number;
  endTime: number;
  score: number;
  category?: HighlightCategory;
  title?: string;
  begrunnelse?: string;
  signals: string[];
  rank?: number;
  status: string;
}

export interface HighlightSignal {
  type: 'chat_spike' | 'volume_spike' | 'viewer_peak' | 'raid' | 'sub' | 'follow' | 'emotional' | 'marker';
  timestamp: number;
  intensity: number;
  description: string;
}

export interface ContentAsset {
  id: string;
  vodId: string;
  highlightId?: string;
  type: AssetType;
  format: AssetFormat;
  storagePath?: string;
  storageUrl?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  status: AssetStatus;
}

export interface ContentCopy {
  id: string;
  vodId: string;
  highlightId?: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'discord';
  tittel?: string;
  beskrivelse?: string;
  hashtags?: string[];
  caption?: string;
  discordPost?: string;
}

export interface ReviewQueueItem {
  id: string;
  vodId: string;
  highlightId?: string;
  assetId?: string;
  type: string;
  status: ReviewStatus;
  notes?: string;
}

export interface PipelineLog {
  vodId: string;
  step: PipelineStep;
  status: 'STARTED' | 'COMPLETE' | 'FAILED';
  message?: string;
  durationMs?: number;
  costEstimate?: number;
  outputCount?: number;
}

// Publishing interfaces (fremtidig – ikke implementert ennå)
export interface PublishingInterface {
  platform: 'tiktok' | 'youtube' | 'instagram' | 'discord';
  publish(assetId: string, copy: ContentCopy): Promise<{ ok: boolean; url?: string }>;
}
