/**
 * WorkspaceRuntime — per-workspace live-sjekk og Discord-posting.
 *
 * Bruker delt Discord-klient (den globale boten er invitert til alle guilds via OAuth).
 * Bruker delte Twitch-app-credentials (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET).
 * Én instans per aktivt alpha-workspace.
 */

import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { logBotAgentEvent } from './agentLogger';
import { logSystemEvent } from './systemEvents';
import { registerExternalChannel } from './twitchBot';

interface ViewerRecord {
  username: string;
  firstSeen: string;
  lastSeen: string;
  messagesSent: number;
  follower: boolean;
  subscriber: boolean;
  moderator: boolean;
  vip: boolean;
}

export interface WorkspaceConfig {
  workspaceId: string;
  brandName: string;
  twitchLogin: string;
  twitchUserId: string;
  discordGuildId: string;
  liveChannelId: string;
  chatChannelId?: string;
  kanalPreferanser: Record<string, string>;
}

interface LiveState {
  isLive: boolean;
  lastStreamId: string;
  lastChecked: number;
}

export class WorkspaceRuntime {
  readonly config: WorkspaceConfig;
  private liveState: LiveState = { isLive: false, lastStreamId: '', lastChecked: 0 };
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private channelCleanup: (() => void) | null = null;
  private viewerSessions = new Map<string, ViewerRecord>();

  constructor(config: WorkspaceConfig) {
    this.config = config;
  }

  get workspaceId() { return this.config.workspaceId; }

  // ── Twitch app-token (cached, reused across workspaces via shared module-level cache) ──

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;
    const clientId = process.env.TWITCH_CLIENT_ID;
    const secret   = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !secret) return null;
    try {
      const res = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${secret}&grant_type=client_credentials`,
        { method: 'POST', signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return null;
      const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
      this.accessToken = access_token;
      this.tokenExpiry = Date.now() + (expires_in - 120) * 1000;
      return access_token;
    } catch { return null; }
  }

  // ── Live-sjekk ────────────────────────────────────────────────────────────────

  async checkLive(discordClient: Client): Promise<void> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const token = await this.getAccessToken();
    if (!token || !clientId) return;

    try {
      const res = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(this.config.twitchLogin)}`,
        { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return;
      const { data } = await res.json() as { data: any[] };
      const stream = data?.[0] ?? null;

      if (stream && stream.id !== this.liveState.lastStreamId) {
        this.liveState.isLive = true;
        this.liveState.lastStreamId = stream.id;
        await this.onLiveStart(discordClient, stream);

      } else if (!stream && this.liveState.isLive) {
        this.liveState.isLive = false;
        this.onLiveEnd();
      }

      this.liveState.lastChecked = Date.now();

    } catch (err: any) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'twitch_bot',
        event_type: 'BOT_WORKSPACE_ERROR',
        title: `${this.config.brandName}: live-sjekk feilet — ${err.message?.slice(0, 80)}`,
        severity: 'error',
        metadata: { workspaceId: this.workspaceId, error: err.message?.slice(0, 200), twitchLogin: this.config.twitchLogin },
      });
    }
  }

  private async onLiveStart(discordClient: Client, stream: any): Promise<void> {
    logSystemEvent({
      workspaceId: this.workspaceId,
      source: 'twitch_bot',
      event_type: 'TWITCH_LIVE_DETECTED',
      title: `${this.config.brandName} er live: ${stream.title?.slice(0, 60)}`,
      severity: 'info',
      metadata: {
        workspaceId: this.workspaceId,
        streamId: stream.id,
        title: stream.title,
        game: stream.game_name,
        viewerCount: stream.viewer_count,
        twitchLogin: this.config.twitchLogin,
      },
    });

    logBotAgentEvent({
      workspaceId: this.workspaceId,
      source: 'twitch',
      event_type: 'stream_live',
      importance_score: 100,
      metadata: { workspaceId: this.workspaceId, title: stream.title, game: stream.game_name },
    });

    const liveChannelId = this.config.liveChannelId;
    if (!liveChannelId) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'discord_bot',
        event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SKIPPED',
        title: `${this.config.brandName}: ingen live-kanal konfigurert`,
        severity: 'warning',
        metadata: { workspaceId: this.workspaceId, reason: 'missing_channel_preference', streamId: stream.id },
      });
      return;
    }

    const ch = discordClient.channels.cache.get(liveChannelId);
    if (!(ch instanceof TextChannel)) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'discord_bot',
        event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SKIPPED',
        title: `${this.config.brandName}: kanal ${liveChannelId} ikke tilgjengelig`,
        severity: 'warning',
        metadata: { workspaceId: this.workspaceId, channelId: liveChannelId, reason: 'channel_not_in_cache', guildId: this.config.discordGuildId },
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle(`🔴 ${this.config.brandName} er LIVE!`)
      .setDescription(`**${stream.title}**\nSpiller: ${stream.game_name}`)
      .setURL(`https://twitch.tv/${this.config.twitchLogin}`)
      .setFooter({ text: `${this.config.brandName} · Stream Control` })
      .setTimestamp();

    const sent = await ch.send({ content: '@here', embeds: [embed] }).then(() => true).catch((err: any) => {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'discord_bot',
        event_type: 'DISCORD_LIVE_ANNOUNCEMENT_FAILED',
        title: `${this.config.brandName}: live-varsel feilet — ${err.message?.slice(0, 80)}`,
        severity: 'error',
        metadata: { workspaceId: this.workspaceId, error: err.message, channelId: liveChannelId },
      });
      return false;
    });

    if (sent) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'discord_bot',
        event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SENT',
        title: `${this.config.brandName}: live-varsel postet i ${ch.name}`,
        severity: 'info',
        metadata: { workspaceId: this.workspaceId, channelId: liveChannelId, channelName: ch.name, streamId: stream.id },
      });
    }
  }

  private onLiveEnd(): void {
    logSystemEvent({
      workspaceId: this.workspaceId,
      source: 'twitch_bot',
      event_type: 'TWITCH_OFFLINE_DETECTED',
      title: `${this.config.brandName} gikk offline`,
      severity: 'info',
      metadata: { workspaceId: this.workspaceId, twitchLogin: this.config.twitchLogin },
    });
    logBotAgentEvent({
      workspaceId: this.workspaceId,
      source: 'twitch',
      event_type: 'stream_offline',
      importance_score: 80,
      metadata: { workspaceId: this.workspaceId },
    });
  }

  // ── Multi-tenant chat ──────────────────────────────────────────────────────────

  private registerChatChannel(): void {
    const login = this.config.twitchLogin;
    if (!login) return;

    try {
      this.channelCleanup = registerExternalChannel(login, (channel, username, text, tags) => {
        this.handleChatMessage(username, text, tags);
      });

      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'twitch_bot',
        event_type: 'TWITCH_CHAT_CHANNEL_REGISTERED',
        title: `Chat-lytter registrert: #${login}`,
        severity: 'info',
        metadata: { workspaceId: this.workspaceId, twitchLogin: login },
      });
    } catch (err: any) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'twitch_bot',
        event_type: 'TWITCH_CHAT_CHANNEL_REGISTER_FAILED',
        title: `Chat-registrering feilet for #${login}: ${err?.message?.slice(0, 80)}`,
        severity: 'error',
        metadata: { workspaceId: this.workspaceId, twitchLogin: login, error: err?.message },
      });
    }
  }

  private handleChatMessage(
    username: string,
    text: string,
    tags: { subscriber?: string | boolean; mod?: boolean; badges?: Record<string, string | undefined> }
  ): void {
    if (!username) return;
    const now = new Date().toISOString();
    const key = username.toLowerCase();
    const existing = this.viewerSessions.get(key);

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
      this.viewerSessions.set(key, {
        username,
        firstSeen: now,
        lastSeen: now,
        messagesSent: 1,
        follower: isFollower,
        subscriber: isSubscriber,
        moderator: isMod,
        vip: isVip,
      });

      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'twitch_bot',
        event_type: 'TWITCH_CHAT_MESSAGE_OBSERVED',
        title: `Ny chatter observert: ${username}`,
        severity: 'info',
        metadata: {
          workspaceId: this.workspaceId,
          twitchLogin: this.config.twitchLogin,
          username,
          subscriber: isSubscriber,
          moderator: isMod,
          vip: isVip,
        },
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────

  updateConfig(config: WorkspaceConfig): void {
    const prev = this.config.liveChannelId;
    (this.config as any).liveChannelId   = config.liveChannelId;
    (this.config as any).chatChannelId   = config.chatChannelId;
    (this.config as any).kanalPreferanser = config.kanalPreferanser;
    if (prev !== config.liveChannelId) {
      logSystemEvent({
        workspaceId: this.workspaceId,
        source: 'workspace_manager',
        event_type: 'WORKSPACE_RUNTIME_UPDATED',
        title: `${this.config.brandName}: kanalpreferanser oppdatert`,
        severity: 'info',
        metadata: { workspaceId: this.workspaceId, liveChannelId: config.liveChannelId },
      });
    }
  }

  start(): void {
    this.registerChatChannel();

    logSystemEvent({
      workspaceId: this.workspaceId,
      source: 'workspace_manager',
      event_type: 'WORKSPACE_RUNTIME_STARTED',
      title: `${this.config.brandName} runtime startet`,
      severity: 'info',
      metadata: {
        workspaceId: this.workspaceId,
        twitchLogin: this.config.twitchLogin,
        discordGuildId: this.config.discordGuildId,
        liveChannelId: this.config.liveChannelId,
      },
    });

    logSystemEvent({
      workspaceId: this.workspaceId,
      source: 'twitch_bot',
      event_type: 'AUDIENCE_TRACKING_STARTED',
      title: `Publikumssporing klar for ${this.config.brandName}`,
      severity: 'info',
      metadata: { workspaceId: this.workspaceId, twitchLogin: this.config.twitchLogin },
    });
  }

  stop(): void {
    this.channelCleanup?.();
    this.channelCleanup = null;
    this.viewerSessions.clear();

    logSystemEvent({
      workspaceId: this.workspaceId,
      source: 'workspace_manager',
      event_type: 'WORKSPACE_RUNTIME_STOPPED',
      title: `${this.config.brandName} runtime stoppet`,
      severity: 'info',
      metadata: { workspaceId: this.workspaceId },
    });
  }

  getStatus() {
    return {
      workspaceId: this.workspaceId,
      brandName:   this.config.brandName,
      twitchLogin: this.config.twitchLogin,
      isLive:      this.liveState.isLive,
      lastStreamId: this.liveState.lastStreamId,
      lastChecked:  this.liveState.lastChecked,
    };
  }
}
