/**
 * WorkspaceBot – én Discord-bot + Twitch-lytter per workspace.
 * Bruker den delte tmi.js-klienten via registerExternalChannel.
 * Default-workspacet (glenvex) håndteres av bot/index.ts og berøres ikke.
 */

import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import type * as tmi from 'tmi.js';
import OpenAI from 'openai';
import { logBotAgentEvent, logChatMessage } from './agentLogger';
import { logSystemEvent } from './systemEvents';
import { registerExternalChannel, sayInChannel } from './twitchBot';

export interface WorkspaceBotConfig {
  workspaceId: string;
  brandName: string;
  twitchChannel: string;
  discordBotToken: string;
  discordGuildId: string;
  discordLiveChannelId?: string;
  discordChatChannelId?: string;
  discordInviteUrl?: string;
  twitchClientId?: string;
  twitchClientSecret?: string;
}

export class WorkspaceBot {
  readonly config: WorkspaceBotConfig;
  private discord: Client;
  private unregisterTwitch: (() => void) | null = null;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private cooldowns = new Map<string, number>();
  private streamState = { isLive: false, lastStreamId: '' };

  constructor(config: WorkspaceBotConfig) {
    this.config = config;
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });
    this.setupHandlers();
  }

  private get wid() { return this.config.workspaceId; }

  private getChatChannel(): TextChannel | null {
    if (this.config.discordChatChannelId) {
      const ch = this.discord.channels.cache.get(this.config.discordChatChannelId);
      if (ch instanceof TextChannel) return ch;
    }
    const fallback = this.discord.channels.cache.find(
      ch => ch instanceof TextChannel &&
        (ch.name.includes('chat') || ch.name.includes('general') || ch.name.includes('snakk'))
    );
    return (fallback instanceof TextChannel) ? fallback : null;
  }

  private buildSystemPrompt(): string {
    const { brandName, twitchChannel, discordInviteUrl } = this.config;
    return `Du er ${brandName} BOT – AI-kompis og community manager for det norske Twitch-communityet ${brandName}.

Personlighet:
- Norsk, litt rå og direkte – som en gaming-kompis
- Mørk humor, gaming-sjargong, naturlig og ufiltrert tone
- Genuint engasjert i folka i communityet

Som community manager for ${brandName}:
- Skap engasjement og FOMO
- Minne om twitch.tv/${twitchChannel} og varslinger når det passer${discordInviteUrl ? `\n- Discord: ${discordInviteUrl}` : ''}

Regler:
- Svar ALLTID på norsk
- Maks 2-3 setninger – punchline, ikke roman
- Emojis naturlig og sparsomt`;
  }

  private async aiReply(prompt: string): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: this.buildSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.9,
      });
      return res.choices[0]?.message?.content?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private setupHandlers() {
    this.discord.once('ready', () => this.onReady());

    this.discord.on('guildMemberAdd', async (member) => {
      if (member.guild.id !== this.config.discordGuildId) return;

      logBotAgentEvent({
        workspaceId: this.wid, source: 'discord', event_type: 'member_join',
        username: member.user.username, importance_score: 50,
        metadata: { workspaceId: this.wid, userId: member.user.id },
      });

      const kanal = this.getChatChannel();
      if (!kanal) return;

      const svar = await this.aiReply(
        `Skriv en varm velkomst på norsk for ${member.displayName}. ` +
        `De er nye i ${this.config.brandName} sitt Discord-community. Maks 2 setninger.`
      );
      const fallback = `Hei **${member.displayName}**, velkommen til **${this.config.brandName}**! ` +
        `Sjekk twitch.tv/${this.config.twitchChannel} og slå på varslinger 🔔`;
      await kanal.send(svar ?? fallback).catch(() => {});
    });

    this.discord.on('messageCreate', async (message) => {
      if (message.author.bot || !this.discord.user) return;
      if (message.guild?.id !== this.config.discordGuildId) return;

      // Logg relevante Discord-meldinger for AI-læring
      if (!message.author.bot) {
        const wc = message.content.split(/\s+/).filter(Boolean).length;
        if (wc >= 3 && message.content.length <= 600) {
          logChatMessage({
            workspaceId: this.wid, source: 'discord',
            username: message.author.username,
            message_text: message.content.slice(0, 500),
            channel_id: message.channelId,
            importance_score: 20,
            metadata: { workspaceId: this.wid },
          });
        }
      }

      const erTagget = message.mentions.has(this.discord.user);
      const erIChatKanal = this.config.discordChatChannelId
        ? message.channelId === this.config.discordChatChannelId
        : false;

      if (!erTagget && !erIChatKanal) return;

      const tekst = message.content.replace(/<@!?[\d]+>/g, '').trim();
      if (!tekst || tekst.length < 2) return;

      const sist = this.cooldowns.get(message.author.id);
      if (sist && Date.now() - sist < 8_000) return;
      this.cooldowns.set(message.author.id, Date.now());

      await message.channel.sendTyping().catch(() => {});
      const svar = await this.aiReply(`${message.author.username}: ${tekst}`);
      if (svar) await message.reply(svar).catch(() => {});
    });
  }

  // ─── Twitch-kanalhandler (mottar meldinger via delt tmi.js-klient) ─────────

  private onTwitchMessage(channel: string, username: string, text: string, _tags: tmi.ChatUserstate) {
    const lower = text.toLowerCase();

    // Logg for AI-læring
    logChatMessage({
      workspaceId: this.wid, source: 'twitch', username,
      message_text: text.slice(0, 500), importance_score: 15,
      metadata: { workspaceId: this.wid, channel },
    });

    // Discord-spørsmål → svar i Twitch-chat
    if ((lower.includes('discord') || lower === '!discord') && this.config.discordInviteUrl) {
      sayInChannel(channel, `@${username} Discord: ${this.config.discordInviteUrl} PogChamp`);
    }
  }

  // ─── Live-sjekk via Twitch API ─────────────────────────────────────────────

  private async checkLive() {
    const clientId = this.config.twitchClientId ?? process.env.TWITCH_CLIENT_ID;
    const clientSecret = this.config.twitchClientSecret ?? process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;

    try {
      const tokenRes = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
        { method: 'POST' }
      );
      if (!tokenRes.ok) return;
      const { access_token } = await tokenRes.json() as { access_token: string };

      const streamRes = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${this.config.twitchChannel}`,
        { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access_token}` } }
      );
      if (!streamRes.ok) return;
      const { data } = await streamRes.json() as { data: any[] };
      const stream = data?.[0];

      if (stream && stream.id !== this.streamState.lastStreamId) {
        this.streamState.isLive = true;
        this.streamState.lastStreamId = stream.id;

        logBotAgentEvent({
          workspaceId: this.wid, source: 'twitch', event_type: 'stream_live',
          importance_score: 100,
          metadata: { workspaceId: this.wid, title: stream.title, game: stream.game_name },
        });
        logSystemEvent({
          workspaceId: this.wid, source: 'twitch_bot', event_type: 'LIVE_DETECTED',
          title: `${this.config.brandName}: Live`,
          severity: 'info',
          metadata: { workspaceId: this.wid, streamId: stream.id, title: stream.title, game: stream.game_name },
        });

        const liveKanalId = this.config.discordLiveChannelId;
        if (liveKanalId) {
          const ch = this.discord.channels.cache.get(liveKanalId) as TextChannel | undefined;
          if (ch) {
            const embed = new EmbedBuilder()
              .setColor(0x9146ff)
              .setTitle(`🔴 ${this.config.brandName} er LIVE!`)
              .setDescription(`**${stream.title}**\nSpiller: ${stream.game_name}`)
              .setURL(`https://twitch.tv/${this.config.twitchChannel}`)
              .setFooter({ text: `${this.config.brandName} Stream Control` })
              .setTimestamp();

            const ai = await this.aiReply(
              `${this.config.brandName} er nå live med "${stream.title}" (${stream.game_name}). ` +
              `Lag et kort energisk live-varsel på norsk, 1-2 setninger. Ikke inkluder URL.`
            );
            await ch.send({
              content: `@here ${ai ?? `🔴 **${this.config.brandName}** er LIVE!`}`,
              embeds: [embed],
            }).catch(() => {});
          }
        }
      } else if (!stream && this.streamState.isLive) {
        this.streamState.isLive = false;
        logBotAgentEvent({
          workspaceId: this.wid, source: 'twitch', event_type: 'stream_offline',
          importance_score: 80, metadata: { workspaceId: this.wid },
        });
      }
    } catch {}
  }

  // ─── Proaktive meldinger ───────────────────────────────────────────────────

  private async sendProaktivMelding() {
    const kanal = this.getChatChannel();
    if (!kanal) return;
    const temaer = [
      `Er det noen som følger ${this.config.brandName} på Twitch? Husk varslinger 🔔 twitch.tv/${this.config.twitchChannel}`,
      `Hva er favorittminnet fra stream? Del clips!`,
      `Hva ønsker dere å se mer av på stream?`,
    ];
    const svar = await this.aiReply(temaer[Math.floor(Math.random() * temaer.length)]);
    if (svar) await kanal.send(svar).catch(() => {});
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  private onReady() {
    console.log(`[${this.wid}] Discord bot tilkoblet: ${this.discord.user?.tag}`);

    if (this.config.twitchChannel) {
      this.unregisterTwitch = registerExternalChannel(
        this.config.twitchChannel,
        (ch, username, text, tags) => this.onTwitchMessage(ch, username, text, tags)
      );
      console.log(`[${this.wid}] Twitch kanal registrert: #${this.config.twitchChannel}`);
    }

    // Live-sjekk hvert 2. min; proaktiv melding hvert 8. time
    const liveInt = setInterval(() => this.checkLive().catch(() => {}), 2 * 60 * 1000);
    const proInt = setInterval(() => this.sendProaktivMelding().catch(() => {}), 8 * 60 * 60 * 1000);
    this.intervals.push(liveInt, proInt);
    setTimeout(() => this.checkLive().catch(() => {}), 15_000);

    logSystemEvent({
      workspaceId: this.wid, source: 'discord_bot', event_type: 'BOT_STARTED',
      title: `${this.config.brandName} Bot startet`, severity: 'info',
      metadata: { workspaceId: this.wid },
    });
  }

  async start(): Promise<void> {
    await this.discord.login(this.config.discordBotToken);
  }

  stop(): void {
    for (const i of this.intervals) clearInterval(i);
    this.intervals = [];
    this.unregisterTwitch?.();
    this.unregisterTwitch = null;
    this.discord.destroy();
    console.log(`[${this.wid}] Bot stoppet`);
  }
}
