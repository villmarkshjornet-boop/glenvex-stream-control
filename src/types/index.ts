export interface StreamInfo {
  isLive: boolean;
  id?: string;
  title?: string;
  game?: string;
  viewerCount?: number;
  startedAt?: string;
  thumbnailUrl?: string;
  streamUrl?: string;
  userName?: string;
}

export interface SocialLinks {
  twitch?: string;
  tiktok?: string;
  instagram?: string;
  twitter?: string;
  youtube?: string;
  discord?: string;
}

export interface Settings {
  discordLiveChannelId: string;
  discordLiveRoleId: string;
  twitchUsername: string;
  twitchUrl: string;
  autoPostLive: boolean;
  autoPostPromo: boolean;
  pingRole: boolean;
  socials: SocialLinks;
  lastNotifiedStreamId: string | null;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  status: string;
}

export interface PromoContent {
  tiktok: string;
  instagram: string;
  twitter: string;
  discord: string;
  youtube: string;
  clipTitles: string[];
  imageUrl?: string;
}

export interface GuildInfo {
  id: string;
  name: string;
  member_count?: number;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  icon?: string;
}

export interface StatusResponse {
  twitchApi: 'online' | 'offline' | 'error';
  discordBot: 'online' | 'offline' | 'error';
  stream: StreamInfo | null;
  guild: GuildInfo | null;
  lastNotification: string | null;
  recentLogs: LogEntry[];
  totalAlerts: number;
  settings: Settings;
}
