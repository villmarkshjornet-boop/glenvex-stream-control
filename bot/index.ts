import {
  Client, GatewayIntentBits, Collection, Interaction,
  TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ThreadChannel, ButtonInteraction,
} from 'discord.js';
import { liveCommand } from './commands/live';
import { twitchCommand } from './commands/twitch';
import { promoCommand } from './commands/promo';
import { setupCommand } from './commands/setup';
import { statusCommand } from './commands/status';
import { socialsCommand } from './commands/socials';
import { clipCommand } from './commands/clip';
import { kanalerCommand, handleSlettKanalKnapp } from './commands/kanaler';
import { addLog } from '@/lib/logger';
import { getStreamInfo, getBroadcasterId, getTopClips, getChannelStats } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings, saveSettings } from '@/lib/settings';
import { generateChatReply, getProaktivMelding, isOnCooldown, setCooldown, ChatReply } from './lib/aiPersonality';
import { startTwitchBot, setOnSubCallback } from './lib/twitchBot';
import { startThumbnailWorker } from './lib/thumbnailGenerator';
import { startClipWorker } from './lib/clipWorker';
import { byggSocialsEmbed } from './commands/socials';
import { topRaids, topGiftSubs } from './lib/eventTracker';
import { tweetLiveNå } from './lib/twitter';
import { innsendCommand } from './commands/innsend';
import { addMessageXP, upsertMember, setLastWelcomed, getMember, getAllMembers, lasterMedlemmerFraSupabase, addReaction, addVoiceMinutes, addStreamAttendance } from './lib/memberTracker';
import { logBotEvent, updateStreamSyklus, resetStreamSyklus, getStreamSyklus, getStreamplan, updateStreamEntryStatus, StreamEntry } from './lib/botEvents';
import { startSession, endSession, updateSession, incrementChatMessages, incrementFollowerGain, addRaidToSession, addSubToSession, getActiveSession } from './lib/streamHistory';
import { tildeltRolle, tildeltRolleKonfigurert } from './lib/roleManager';
import { startDataApi } from './lib/dataApi';
import { addToMemory, getBotSettings, getPersonalityPrompt } from '@/lib/botMemory';
import { addContent } from '@/lib/contentLibrary';
import { logBotAgentEvent, upsertBotMemory, logChatMessage } from './lib/agentLogger';
import { startLearningAggregator } from './lib/learningAggregator';
import { getRandomActivePartner, logPartnerPromoResult, trackPartnerExposure } from './lib/partnerHelper';
import { decidePromotion, loadPartnerBotSettings } from './lib/partnerPromotionEngine';
import { getBotTone, getPauseProaktiv, getAktiv, getPauseDiscord, getPauseLiveVarsler, getTwitchUrl, getChatKanalId as getSbChatKanalId, getLiveKanalId, getClipsKanalId as getSbClipsKanalId, getPartnerKanalId as getSbPartnerKanalId, getAdminKanalId, getPreHypeKanalId, getCommunityKanalId, getCommunitySettings } from './lib/botKanalPreferanser';
import { getRecentCrossPlatformContext, summarizeRecentActivity, hentCommunityMemorySummary, isCommandCooldown, setCommandCooldown } from './lib/crossPlatformContext';
import { startRecoveryEngine } from './lib/recoveryEngine';
import { startSystemEventsFlusher, logSystemEvent } from './lib/systemEvents';
import { scanForDuplicates, dupReports } from './lib/duplicateDetector';
import { withCron, logApiError } from './lib/observability';
import { startWorkspaceManager } from './lib/workspaceManager';
import { startDiscordHistoryBootstrap } from './lib/discordHistoryBootstrap';
import { initCreatorBrain } from './lib/creatorBrain';
import { velgDagensMVP, sendCommunityHype, sjekkIdleOgPrompt } from './lib/communityManager';
import OpenAI from 'openai';

// Log + send Discord-melding
async function discordSend(kanal: TextChannel, melding: string | object, kontekst?: Record<string, any>): Promise<void> {
  try {
    const payload = typeof melding === 'string' ? melding : melding;
    if (typeof payload === 'string') {
      await kanal.send(payload);
    } else {
      await kanal.send(payload as any);
    }
  } catch {}
  const preview = typeof melding === 'string' ? melding.slice(0, 100) : JSON.stringify(melding).slice(0, 100);
  logSystemEvent({
    source: 'discord_bot',
    event_type: 'BOT_DISCORD_MESSAGE',
    title: preview,
    severity: 'info',
    metadata: { channel: kanal.name, channelId: kanal.id, ...kontekst },
  });
}

const token     = process.env.DISCORD_BOT_TOKEN;
const BOT_BRAND = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'streameren';
if (!token) {
  console.error('DISCORD_BOT_TOKEN mangler i .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const commands = new Collection<string, { data: any; execute: (interaction: any) => Promise<any> }>();
for (const cmd of [liveCommand, twitchCommand, promoCommand, setupCommand, statusCommand, socialsCommand, clipCommand, kanalerCommand, innsendCommand]) {
  commands.set(cmd.data.name, cmd);
}

const postedeClips = new Set<string>();
let sisteStatsukeNr = -1;
let sisteRyddUke = -1;

// Kanaler som aldri skal slettes automatisk
const BESKYTTEDE_KANALER = [
  'live', 'chat', 'general', 'general', 'regler', 'rules', 'info',
  'velkomst', 'welcome', 'kunngjøring', 'annonsering', 'bot-logs',
  'nyheter', 'highlights', 'klipp',
];

// ─── Hjelpefunksjoner ────────────────────────────────────────────────────────

// Cache for chat-kanal-ID fra Supabase (10 min TTL)
let _chatKanalIdCache: string | null = null;
let _chatKanalIdTs = 0;

async function finnChatKanal(): Promise<TextChannel | null> {
  // 1. Prøv Supabase-settings (oppdatert fra web UI)
  const now = Date.now();
  if (now - _chatKanalIdTs > 10 * 60_000) {
    _chatKanalIdCache = await getSbChatKanalId().catch(() => null);
    _chatKanalIdTs = now;
  }
  if (_chatKanalIdCache) {
    const ch = client.channels.cache.get(_chatKanalIdCache);
    if (ch instanceof TextChannel) return ch;
  }
  // 2. Env var fallback
  const envId = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (envId) {
    const ch = client.channels.cache.get(envId);
    if (ch instanceof TextChannel) return ch;
  }
  // 3. Name-based fallback
  const fallback = client.channels.cache.find(
    ch => ch instanceof TextChannel &&
    (ch.name.includes('chat') || ch.name.includes('general') || ch.name.includes('gaming'))
  );
  return (fallback as TextChannel) ?? null;
}

let _clipsKanalIdCache: string | null = null;
let _clipsKanalIdTs = 0;

async function finnClipsKanal(): Promise<TextChannel | null> {
  const now = Date.now();
  if (now - _clipsKanalIdTs > 10 * 60_000) {
    _clipsKanalIdCache = await getSbClipsKanalId().catch(() => null);
    _clipsKanalIdTs = now;
  }
  if (_clipsKanalIdCache) {
    const ch = client.channels.cache.get(_clipsKanalIdCache);
    if (ch instanceof TextChannel) return ch;
  }
  return finnChatKanal(); // fall back to chat if no clips channel configured
}

let _partnerKanalIdCache: string | null = null;
let _partnerKanalIdTs = 0;

async function finnPartnerKanal(): Promise<TextChannel | null> {
  const now = Date.now();
  if (now - _partnerKanalIdTs > 10 * 60_000) {
    _partnerKanalIdCache = await getSbPartnerKanalId().catch(() => null);
    _partnerKanalIdTs = now;
  }
  if (_partnerKanalIdCache) {
    const ch = client.channels.cache.get(_partnerKanalIdCache);
    if (ch instanceof TextChannel) return ch;
  }
  return finnChatKanal(); // fall back to chat if no partner channel configured
}

async function finnAdminKanal(): Promise<TextChannel | null> {
  const id = await getAdminKanalId().catch(() => '');
  if (id) {
    const ch = client.channels.cache.get(id);
    if (ch instanceof TextChannel) return ch;
  }
  // No public fallback per spec — missing admin channel must be logged and skipped
  return null;
}

async function finnPreHypeKanal(): Promise<TextChannel | null> {
  const id = await getPreHypeKanalId().catch(() => '');
  if (!id) return null;
  const ch = client.channels.cache.get(id);
  return ch instanceof TextChannel ? ch : null;
}

async function finnCommunityKanal(): Promise<TextChannel | null> {
  const id = await getCommunityKanalId().catch(() => '');
  if (!id) return null;
  const ch = client.channels.cache.get(id);
  return ch instanceof TextChannel ? ch : null;
  // No public fallback — missing community channel = skip, not post to chat
}

// ─── Community Manager wrappers ───────────────────────────────────────────────

async function sjekkOgSendMVP(): Promise<void> {
  const settings = await getCommunitySettings().catch(() => null);
  if (settings?.aktiv === false) return;

  // Only post MVP after noon Oslo time
  const osloHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false }).format(new Date()),
    10,
  );
  if (osloHour < 12) return;

  const kanal = await finnCommunityKanal();
  if (!kanal) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_MISSING_CHANNEL',
      title: 'MVP hoppet over – community-kanal ikke konfigurert',
      severity: 'warning',
      metadata: { type: 'mvp', fix: 'Innstillinger → Discord Kanaler → sett Community-kanal' },
    });
    return;
  }
  await velgDagensMVP(kanal).catch(() => {});
}

async function sjekkOgSendHype(): Promise<void> {
  const settings = await getCommunitySettings().catch(() => null);
  if (settings?.aktiv === false || settings?.communityHypeAktiv === false) return;

  const kanal = await finnCommunityKanal();
  if (!kanal) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_HYPE_SKIPPED_MISSING_CHANNEL',
      title: 'Community hype hoppet over – community-kanal ikke konfigurert',
      severity: 'warning',
      metadata: { fix: 'Innstillinger → Discord Kanaler → sett Community-kanal' },
    });
    return;
  }
  await sendCommunityHype(kanal).catch(() => {});
}

async function sjekkIdlePrompt(): Promise<void> {
  if (!client.user) return;
  const settings = await getCommunitySettings().catch(() => null);
  if (settings?.aktiv === false || settings?.idlePromptsAktiv === false) return;

  const kanal = await finnCommunityKanal();
  if (!kanal) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_MISSING_CHANNEL',
      title: 'Idle-prompt hoppet over – community-kanal ikke konfigurert',
      severity: 'warning',
      metadata: { fix: 'Innstillinger → Discord Kanaler → sett Community-kanal' },
    });
    return;
  }
  const threshold = settings?.idleThresholdMinutes ?? 120;
  await sjekkIdleOgPrompt(kanal, client.user.id, threshold).catch(() => {});
}

function ukeNummer(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

// ─── Supabase-settings sync (5-min cache, bot leser fra Supabase ikke bare fil) ──

let _sbSettings: any = null;
let _sbSettingsTs = 0;
const SB_SETTINGS_TTL = 5 * 60_000;

async function getSettingsFresh() {
  const file = getSettings();
  if (Date.now() - _sbSettingsTs < SB_SETTINGS_TTL && _sbSettings) {
    return { ...file, ..._sbSettings };
  }
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const wid = process.env.WORKSPACE_ID ?? 'glenvex-default';
    if (sbUrl && sbKey) {
      const res = await fetch(`${sbUrl}/rest/v1/workspaces?id=eq.${encodeURIComponent(wid)}&select=settings_json`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as any[];
        if (data?.[0]?.settings_json) {
          _sbSettings = data[0].settings_json;
          _sbSettingsTs = Date.now();
          return { ...file, ..._sbSettings };
        }
      }
    }
  } catch {}
  return file;
}

// ─── Live-sjekk med stream-analyse ───────────────────────────────────────────

async function checkLive() {
  try {
    const settings = await getSettingsFresh();
    if (!settings.autoPostLive) return;
    const stream = await getStreamInfo();

    // VOD Watcher – automatisk pipeline etter stream
    if (process.env.CONTENT_FACTORY_ENABLED === 'true') {
      try {
        const { sjekkForNyVod } = await import('@/lib/content-factory/vod/vodWatcher');
        const botApiUrl = process.env.BOT_API_URL;
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
        await sjekkForNyVod(stream.isLive ?? false, async (twitchVodId, twitchVodUrl) => {
          if (!appUrl) return;
          const url = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
          await fetch(`${url}/api/content-factory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId: twitchVodId, twitchVodUrl }),
          }).catch(console.error);
        });
      } catch {}
    }

    if (stream.isLive && stream.id && stream.id !== settings.lastNotifiedStreamId) {
      if (await getPauseLiveVarsler().catch(() => false)) return;

      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'LIVE_DETECTED',
        title: `Stream er live: ${stream.title?.slice(0, 60) ?? 'Ingen tittel'}`,
        description: `Spill: ${stream.game ?? 'Ukjent'} · Seere: ${stream.viewerCount ?? 0}`,
        severity: 'info',
        metadata: { streamId: stream.id, title: stream.title, game: stream.game, viewerCount: stream.viewerCount },
      });

      // Hent kanal-ID fra Supabase (dashboard-settings) — dette er source of truth.
      // Faller tilbake til lokal fil/env kun om Supabase-verdien mangler.
      const dbLiveKanalId = await getLiveKanalId().catch(() => '');
      const envLiveKanalId = settings.discordLiveChannelId;
      const effectiveLiveKanalId = dbLiveKanalId || envLiveKanalId;
      const kanalKilde = dbLiveKanalId ? 'supabase' : (envLiveKanalId ? 'env_or_file' : 'ingen');

      console.log(
        `[DISCORD ANNOUNCEMENT DEBUG]` +
        `\n  workspace=${process.env.WORKSPACE_ID ?? 'glenvex-default'}` +
        `\n  dbChannel=${dbLiveKanalId || '(ikke satt i Supabase)'}` +
        `\n  envChannel=${envLiveKanalId || '(ikke satt i env/fil)'}` +
        `\n  actualChannel=${effectiveLiveKanalId || '(INGEN — varslet vil feile)'}` +
        `\n  source=${kanalKilde}`
      );

      logSystemEvent({
        source: 'discord_bot',
        event_type: 'LIVE_CHANNEL_RESOLVED',
        title: `Live-kanal løst: ${effectiveLiveKanalId || 'INGEN'}`,
        severity: effectiveLiveKanalId ? 'info' : 'error',
        metadata: {
          dbKanalId: dbLiveKanalId || null,
          envKanalId: envLiveKanalId || null,
          effectiveKanalId: effectiveLiveKanalId || null,
          source: kanalKilde,
        },
      });

      // Krav 4: Ingen kanal → logg og stopp. Ikke post tilfeldig i #chat.
      if (!effectiveLiveKanalId) {
        logSystemEvent({
          source: 'discord_bot',
          event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SKIPPED',
          title: 'Live-varsel hoppet over — ingen kanal konfigurert',
          severity: 'warning',
          metadata: {
            reason: 'missing_channel_preference',
            streamId: stream.id,
            workspaceId: process.env.WORKSPACE_ID ?? 'glenvex-default',
            fix: 'Gå til Dashboard → Settings → Discord → Velg live-kanal',
          },
        });
        saveSettings({ lastNotifiedStreamId: stream.id });
        return;
      }

      const guildId = process.env.DISCORD_GUILD_ID ?? null;
      const ch = client.channels.cache.get(effectiveLiveKanalId);
      const channelName = (ch && 'name' in ch ? (ch as any).name : null) ?? '(ukjent)';
      const liveSettings = { ...settings, discordLiveChannelId: effectiveLiveKanalId };

      let liveEmbedOk = false;
      try {
        await postLiveEmbed(stream, liveSettings);
        liveEmbedOk = true;
        logSystemEvent({
          source: 'discord_bot',
          event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SENT',
          title: `Discord live-varsel postet: ${stream.title?.slice(0, 60) ?? ''}`,
          severity: 'info',
          metadata: {
            workspaceId: process.env.WORKSPACE_ID ?? 'glenvex-default',
            guildId,
            channelId: effectiveLiveKanalId,
            channelName,
            source: kanalKilde,
            streamId: stream.id,
          },
        });
      } catch (liveErr: any) {
        logSystemEvent({
          source: 'discord_bot',
          event_type: 'DISCORD_LIVE_ANNOUNCEMENT_FAILED',
          title: `Discord live-varsel feilet: ${liveErr.message?.slice(0, 100)}`,
          severity: 'error',
          metadata: {
            streamId: stream.id,
            error: liveErr.message,
            channelId: effectiveLiveKanalId,
            channelName,
            source: kanalKilde,
          },
        });
      }

      saveSettings({ lastNotifiedStreamId: stream.id });
      addLog(liveEmbedOk ? 'success' : 'warning', `Auto live-varsel ${liveEmbedOk ? 'postet' : 'feilet'}: ${stream.title}`, liveEmbedOk ? 'OK' : 'WARN');
      startSession({ id: stream.id, title: stream.title ?? '', game: stream.game ?? '', startedAt: stream.startedAt ?? new Date().toISOString(), viewerCount: stream.viewerCount });

      // Lagre til content library
      addContent({
        tittel: `Live-varsel: ${stream.title}`,
        type: 'live-varsel',
        status: 'publisert',
        tekst: `🔴 ${BOT_BRAND} ER LIVE – ${stream.game}: ${stream.title}`,
        kanalId: effectiveLiveKanalId,
        modul: 'Auto Live',
        opprettetAv: 'bot',
        publisert: new Date().toISOString(),
        tags: [stream.game ?? '', 'live'],
      });

      addToMemory({ type: 'live-varsel', innhold: stream.title ?? '' });
      tweetLiveNå(stream).catch(() => {});
      await analyserStreamKontekst(stream.title ?? '', stream.game ?? '');
      await postPreLiveHype(stream.title ?? '', stream.game ?? '');
      updateStreamSyklus({ stream_start_at: new Date().toISOString(), sist_live_id: stream.id }).catch(() => {});
      logBotEvent('stream_live', { tittel: stream.title ?? '', spill: stream.game ?? '' });
      logBotAgentEvent({ source: 'twitch', event_type: 'stream_live', importance_score: 100, metadata: { title: stream.title, game: stream.game, streamId: stream.id } });
    } else if (stream.isLive && stream.id) {
      // Gjenopprett session hvis boten restartet mens stream var live
      if (!getActiveSession()) {
        startSession({ id: stream.id, title: stream.title ?? '', game: stream.game ?? '', startedAt: stream.startedAt ?? new Date().toISOString(), viewerCount: stream.viewerCount });
        addLog('info', `Stream Coach: gjenopprettet session for pågående stream "${stream.title}"`, 'OK');
      }
      updateSession(stream.viewerCount ?? 0);
    } else if (!stream.isLive && settings.lastNotifiedStreamId) {
      saveSettings({ lastNotifiedStreamId: null });
      await endSession(0);
      logBotEvent('stream_offline', {});
      logBotAgentEvent({ source: 'twitch', event_type: 'stream_offline', importance_score: 80 });
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'STREAM_OFFLINE_DETECTED',
        title: 'Stream gikk offline – VOD-watcher starter om 15 min',
        severity: 'info',
        metadata: { resetSyklusOm: '2t' },
      });
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'POST_STREAM_STARTED',
        title: 'Post-stream fase startet – VOD-prosessering og opprydding',
        severity: 'info',
        metadata: { streamId: settings.lastNotifiedStreamId ?? null },
      });
      // Reset syklus 2 timer etter stream slutt (gir tid til VOD-prosessering å fullføres)
      setTimeout(() => resetStreamSyklus().catch(() => {}), 2 * 60 * 60 * 1000);
    }
  } catch (error) {
    const msg = (error as Error).message ?? '';
    const match = msg.match(/HTTP (\d{3})/);
    const statusCode = match ? parseInt(match[1]) : null;
    const eventType =
      statusCode === 401 ? 'TWITCH_AUTH_ERROR' :
      statusCode === 429 ? 'TWITCH_RATE_LIMIT' :
      !statusCode        ? 'TWITCH_NETWORK_ERROR' :
                           'LIVE_DETECTION_FAILED';
    addLog('error', `Live-sjekk feil: ${msg}`, 'ERROR');
    logSystemEvent({
      source: 'twitch_bot',
      event_type: eventType,
      title: `Live-deteksjon feilet: ${msg.slice(0, 100)}`,
      severity: statusCode === 429 ? 'warning' : 'error',
      metadata: { error: msg.slice(0, 200), statusCode },
    });
  }
}

// ─── Stream-kontekst analyse ─────────────────────────────────────────────────

async function analyserStreamKontekst(tittel: string, spill: string) {
  const kanal = await finnChatKanal();
  if (!kanal) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const combined = `${tittel} ${spill}`.toLowerCase();

  // Detekter GTA RP / Future RP
  const erFutureRP = combined.includes('future') || combined.includes('future rp') || combined.includes('frp');
  const erGTARP = combined.includes('gta rp') || combined.includes('gtarp') || combined.includes('nopixel') || combined.includes('nxt') || combined.includes('rp');
  const erTarkov = combined.includes('tarkov') || combined.includes('eft');

  if (!erFutureRP && !erGTARP && !erTarkov) return;

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `${BOT_BRAND} er nå live med tittel: "${tittel}" og spill: "${spill}".
Lag en kort norsk melding (2 setninger) til Discord-chatten som:
1. Nevner spillet/serveren naturlig
2. Spør om de vil oppdatere Discord-strukturen for dette spillet (f.eks. legge til ${erFutureRP ? 'Future RP' : 'GTA RP'}-kanaler, fjerne utdaterte)

Vær direkte og engasjerende.`,
      }],
      max_tokens: 120,
      temperature: 0.8,
    });

    const melding = res.choices[0]?.message?.content ?? '';
    if (!melding) return;

    const serverNavn = erFutureRP ? 'Future RP' : erTarkov ? 'Escape from Tarkov' : 'GTA RP';

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle(`◆ Stream detektert – ${serverNavn}`)
      .setDescription(melding)
      .setFooter({ text: 'Stream Control • Smart Live-deteksjon' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`stream_opprett_karakter_${serverNavn.replace(/ /g, '_')}`)
        .setLabel('Opprett karakter')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`stream_oppdater_discord_${serverNavn.replace(/ /g, '_')}`)
        .setLabel('Oppdater Discord')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('stream_ignorer')
        .setLabel('Ignorer')
        .setStyle(ButtonStyle.Secondary),
    );

    await kanal.send({ embeds: [embed], components: [row] });
  } catch {}
}

// ─── Håndter duplikat-knapper ────────────────────────────────────────────────

async function handleDuplikatKnapp(interaction: ButtonInteraction) {
  const { customId } = interaction;
  const isSlett = customId.startsWith('dup_slett_');
  const reportId = customId.replace('dup_slett_', '').replace('dup_ignorer_', '');

  const report = dupReports.get(reportId);
  if (!report) {
    await interaction.reply({ content: 'Rapport ikke funnet (kan være utdatert ved bot-restart).', ephemeral: true });
    return;
  }

  if (!isSlett) {
    dupReports.delete(reportId);
    await interaction.update({ content: `✅ Rapport ${reportId} ignorert.`, embeds: [], components: [] });
    logSystemEvent({ source: 'duplicate_detector', event_type: 'DUPLICATE_IGNORED', title: `Duplikat-rapport ignorert av ${interaction.user.tag}`, severity: 'info', metadata: { reportId, kanalNavn: report.kanalNavn } });
    return;
  }

  // Slett alle duplikater bortsett fra den nyeste
  const sorted = [...report.meldinger].sort((a, b) => b.ts - a.ts);
  const beholdId = sorted[0].messageId;
  const slettIds = sorted.slice(1).map(m => m.messageId);

  const kanal = client.channels.cache.get(report.kanalId);
  if (!(kanal instanceof TextChannel)) {
    await interaction.reply({ content: 'Kanal ikke funnet.', ephemeral: true });
    return;
  }

  let slettet = 0;
  for (const msgId of slettIds) {
    try {
      const msg = await kanal.messages.fetch(msgId);
      await msg.delete();
      slettet++;
    } catch {}
  }

  dupReports.delete(reportId);
  await interaction.update({ content: `🗑️ ${slettet} duplikat${slettet !== 1 ? 'er' : ''} slettet i #${report.kanalNavn}. Beholdt nyeste (${beholdId}).`, embeds: [], components: [] });

  logSystemEvent({
    source: 'duplicate_detector',
    event_type: 'DUPLICATE_DELETED',
    title: `${slettet} duplikater slettet i #${report.kanalNavn} av ${interaction.user.tag}`,
    severity: 'info',
    metadata: { reportId, kanalNavn: report.kanalNavn, slettet, beholdt: beholdId, utførtAv: interaction.user.tag },
  });
}

// ─── Håndter stream-kontekst knapper ─────────────────────────────────────────

async function handleStreamKnapp(interaction: ButtonInteraction) {
  const { customId } = interaction;

  if (customId === 'stream_ignorer') {
    return interaction.update({ components: [] });
  }

  if (customId.startsWith('stream_opprett_karakter_')) {
    const server = customId.replace('stream_opprett_karakter_', '').replace(/_/g, ' ');
    await interaction.update({ components: [] });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Streameren spiller ${server}. Foreslå 2-3 karakternavn og roller som passer for en norsk ${server}-server. Format: Navn – Rolle (1 linje per karakter). Norsk. Maks 50 ord.`,
      }],
      max_tokens: 100,
      temperature: 0.9,
    });

    const forslag = res.choices[0]?.message?.content ?? '';
    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('◆ Karakterforslag')
      .setDescription(`Her er noen karakterforslag for **${server}**:\n\n${forslag}\n\nVil du opprette en kanal for en av disse? Bruk \`/kanaler opprett\``)
      .setFooter({ text: 'Stream Control' });

    await interaction.followUp({ embeds: [embed], ephemeral: false });
  }

  if (customId.startsWith('stream_oppdater_discord_')) {
    const server = customId.replace('stream_oppdater_discord_', '').replace(/_/g, ' ');
    await interaction.update({ components: [] });

    const guild = interaction.guild;
    if (!guild) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    const openai = new OpenAI({ apiKey });
    const kanaler = Array.from(guild.channels.cache.values())
      .filter(c => c.type === 0)
      .map((c: any) => `#${c.name}`)
      .join(', ');

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Discord-server for streameren som nå spiller ${server}. Nåværende kanaler: ${kanaler}.
Foreslå på norsk:
1. Hvilke kanaler bør fjernes (utdaterte/irrelevante for ${server})?
2. Hvilke kanaler bør legges til for ${server}?
Maks 100 ord. Vær konkret.`,
      }],
      max_tokens: 150,
      temperature: 0.7,
    });

    const forslag = res.choices[0]?.message?.content ?? '';
    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle(`◆ Discord-oppdatering for ${server}`)
      .setDescription(forslag + '\n\nBruk **Discord**-fanen i dashboardet for å utføre endringene.')
      .setFooter({ text: 'Stream Control' });

    await interaction.followUp({ embeds: [embed], ephemeral: false });
  }
}

// ─── Auto-rydd inaktive kanaler ───────────────────────────────────────────────

// ─── Auto-post streamplan ────────────────────────────────────────────────────

async function autoPostStreamplan() {
  const now = new Date();
  if (now.getDay() !== 1) return; // Kun mandag
  const uke = ukeNummer();
  const cacheKey = `streamplan_uke_${uke}`;
  if ((global as any)[cacheKey]) return;
  logSystemEvent({ source: 'cron', event_type: 'CRON_EXECUTED', title: 'Cron startet: autoPostStreamplan', severity: 'info', metadata: { job_name: 'autoPostStreamplan', uke } });
  (global as any)[cacheKey] = true;

  try {
    // Load from DB (not file) — getStreamplan() migrates legacy entries automatically
    const plan = await getStreamplan();
    const osloDatoISO = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());

    // Include weekly entries + single-date entries that are still upcoming
    const aktive = plan.filter((e: StreamEntry) => {
      if (!e.aktiv) return false;
      if (e.type === 'single') return !!e.date && e.date >= osloDatoISO && e.status !== 'completed';
      return true;
    });

    if (aktive.length === 0) return;

    // Post via Vercel API (håndterer annonseringskanal og sletting av gammel plan)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
    if (appUrl) {
      const url = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      await fetch(`${url}/api/streamplan/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: aktive }),
      }).catch(() => {});
    }

    addLog('success', `Streamplan postet automatisk uke ${uke}`, 'OK');
    logSystemEvent({ source: 'cron', event_type: 'CRON_COMPLETED', title: `Cron ferdig: autoPostStreamplan — uke ${uke}`, severity: 'info', metadata: { job_name: 'autoPostStreamplan', uke } });
  } catch (error) {
    addLog('error', `Streamplan-post feil: ${(error as Error).message}`, 'ERROR');
    logSystemEvent({ source: 'cron', event_type: 'CRON_FAILED', title: `Cron feilet: autoPostStreamplan — ${(error as Error).message?.slice(0, 80)}`, severity: 'error', metadata: { job_name: 'autoPostStreamplan', error_message: (error as Error).message?.slice(0, 200) } });
  }
}

async function autoRyddKanaler() {
  const now = new Date();
  if (now.getDay() !== 1) return; // Kun mandag
  const uke = ukeNummer();
  if (uke === sisteRyddUke) return;
  sisteRyddUke = uke;

  logSystemEvent({ source: 'cron', event_type: 'CRON_EXECUTED', title: 'Cron startet: autoRyddKanaler', severity: 'info', metadata: { job_name: 'autoRyddKanaler', uke } });

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const adminKanal = await finnAdminKanal();
  if (!adminKanal) {
    logSystemEvent({
      source: 'cron',
      event_type: 'DISCORD_ADMIN_CHANNEL_MISSING',
      title: 'Kanal-analyse hoppet over – admin-kanal ikke konfigurert',
      severity: 'warning',
      metadata: { job_name: 'autoRyddKanaler', fix: 'Gå til Settings → Discord Kanaler → sett Admin/Bot-analyse kanal' },
    });
    return;
  }

  const INAKTIV_DAGER = 60;
  const kandidater: { id: string; navn: string; dager: number }[] = [];

  for (const [, ch] of guild.channels.cache) {
    if (ch.type !== 0) continue;
    const kanal = ch as TextChannel;
    const erBeskyttet = BESKYTTEDE_KANALER.some(n => kanal.name.toLowerCase().includes(n));
    if (erBeskyttet) continue;

    try {
      const msgs = await kanal.messages.fetch({ limit: 1 });
      const siste = msgs.first();
      const dager = siste
        ? Math.floor((Date.now() - siste.createdTimestamp) / 86_400_000)
        : 999;
      if (dager >= INAKTIV_DAGER) {
        kandidater.push({ id: kanal.id, navn: kanal.name, dager });
      }
    } catch {}
  }

  if (kandidater.length === 0) return;

  // Analyser med AI og varsle – ikke slett
  const apiKey = process.env.OPENAI_API_KEY;
  let analyse = '';
  if (apiKey) {
    const openai = new OpenAI({ apiKey });
    const liste = kandidater.map(k => `#${k.navn} (${k.dager === 999 ? 'aldri brukt' : `${k.dager} dager inaktiv`})`).join(', ');
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Disse Discord-kanalene er inaktive i ${BOT_BRAND} sitt community: ${liste}. Gi en kort norsk vurdering (maks 2 setninger) av hvilke som ikke trengs og bør fjernes. Vær konkret.` }],
      max_tokens: 150,
      temperature: 0.7,
    });
    analyse = res.choices[0]?.message?.content ?? '';
  }

  const embed = new EmbedBuilder()
    .setColor(0xff8800)
    .setTitle('◆ Ukentlig kanal-analyse')
    .setDescription(analyse || 'Følgende kanaler ser ut til å ikke være i bruk.')
    .addFields(
      kandidater.slice(0, 10).map(k => ({
        name: `#${k.navn}`,
        value: k.dager === 999 ? 'Aldri brukt' : `${k.dager} dager siden siste melding`,
        inline: true,
      }))
    )
    .setFooter({ text: 'Bruk /kanaler rydd for å slette • Stream Control' })
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const batch = kandidater.slice(0, 25);
  for (let i = 0; i < batch.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      batch.slice(i, i + 5).map(k =>
        new ButtonBuilder()
          .setCustomId(`slett_kanal_${k.id}`)
          .setLabel(`Slett #${k.navn}`)
          .setStyle(ButtonStyle.Danger)
      )
    );
    rows.push(row);
  }

  await adminKanal.send({ embeds: [embed], components: rows });
  addLog('info', `Kanal-analyse: ${kandidater.length} inaktive kanaler funnet`, 'OK');
  logSystemEvent({ source: 'cron', event_type: 'CRON_COMPLETED', title: `Cron ferdig: autoRyddKanaler — ${kandidater.length} kandidater`, severity: 'info', metadata: { job_name: 'autoRyddKanaler', kandidater: kandidater.length } });
}

// ─── Proaktive meldinger ─────────────────────────────────────────────────────

// ─── Pre-Live Hype ───────────────────────────────────────────────────────────

async function postPreLiveHype(tittel: string, spill: string) {
  const kanal = await finnChatKanal();
  if (!kanal) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `${BOT_BRAND} starter stream nå med ${spill}: "${tittel}". Lag en kort hype-melding på norsk (maks 2 setninger, energisk, community-fokusert). Ingen emojis i starten.` }],
      max_tokens: 80,
      temperature: 0.9,
    });
    const melding = res.choices[0]?.message?.content ?? '';
    if (melding) await discordSend(kanal, `🔴 **${BOT_BRAND} ER LIVE!** ${melding}`, { trigger: 'pre_live_hype' });
  } catch {}
}

// ─── Level-up handler ────────────────────────────────────────────────────────

async function handleLevelUp(
  userId: string,
  displayName: string,
  newLevel: number,
  guild: import('discord.js').Guild | null,
  guildMember: import('discord.js').GuildMember | null,
): Promise<void> {
  const [communityKanal, adminKanal, settings] = await Promise.all([
    finnCommunityKanal(),
    finnAdminKanal(),
    getCommunitySettings().catch(() => null),
  ]);

  // Gratulasjon i community-kanal (aldri fallback til public chat)
  if (communityKanal && settings?.levelUpMeldingerAktiv !== false) {
    await communityKanal.send(`🎉 **${displayName}** nådde **Level ${newLevel}**! PogChamp`).catch(() => {});
  }

  // Tildel rolle
  if (guild && guildMember) {
    const rewardRoles = settings?.rewardRoles ?? [];
    const { rolleNavn } = await tildeltRolleKonfigurert(guild, guildMember, newLevel, rewardRoles);
    if (rolleNavn && communityKanal) {
      await communityKanal.send(`🏅 **${displayName}** fikk rollen **@${rolleNavn}**! 👑`).catch(() => {});
    }
  }

  // Logg til admin-kanal
  if (adminKanal) {
    await adminKanal.send(`📊 Level-up: **${displayName}** → Level **${newLevel}**`).catch(() => {});
  }

  logBotEvent('level_up', { username: displayName, level: newLevel, userId });
}

// ─── Duplicate Detector ──────────────────────────────────────────────────────

let sisteDupSkanUke = -1;

async function kjørDuplikatSkan() {
  const now = new Date();
  if (now.getDay() !== 1) return; // Kun mandag
  const uke = ukeNummer();
  if (uke === sisteDupSkanUke) return;
  sisteDupSkanUke = uke;

  logSystemEvent({ source: 'cron', event_type: 'CRON_EXECUTED', title: 'Cron startet: kjørDuplikatSkan', severity: 'info', metadata: { job_name: 'kjørDuplikatSkan', uke } });

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const adminKanal = await finnAdminKanal();
  if (!adminKanal) {
    logSystemEvent({
      source: 'cron',
      event_type: 'DISCORD_ADMIN_CHANNEL_MISSING',
      title: 'Duplikat-skanning hoppet over – admin-kanal ikke konfigurert',
      severity: 'warning',
      metadata: { job_name: 'kjørDuplikatSkan', fix: 'Gå til Settings → Discord Kanaler → sett Admin/Bot-analyse kanal' },
    });
    return;
  }

  const reports = await scanForDuplicates(guild.channels.cache, client.user!.id, 24).catch(() => []);

  if (reports.length === 0) {
    logSystemEvent({ source: 'cron', event_type: 'CRON_COMPLETED', title: 'Duplikat-skanning ferdig: ingen duplikater funnet', severity: 'info', metadata: { job_name: 'kjørDuplikatSkan', uke } });
    return;
  }

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = await import('discord.js');

  for (const report of reports.slice(0, 5)) {
    const embed = new EmbedBuilder()
      .setColor(0xff4400)
      .setTitle(`◆ Duplikate bot-meldinger i #${report.kanalNavn}`)
      .setDescription(`**${report.meldinger.length} like meldinger** funnet siste 24t.\n\n${report.meldinger.map((m, i) => `${i + 1}. [${new Date(m.ts).toLocaleTimeString('no-NO')}] ${m.preview}`).join('\n')}`)
      .setFooter({ text: `Report ID: ${report.id} • Kun botens egne meldinger skannes` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`dup_slett_${report.id}`)
        .setLabel('Slett duplikater (behold nyeste)')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`dup_ignorer_${report.id}`)
        .setLabel('Ignorer')
        .setStyle(ButtonStyle.Secondary),
    );

    await adminKanal.send({ embeds: [embed], components: [row] }).catch(() => {});
  }

  logSystemEvent({ source: 'cron', event_type: 'CRON_COMPLETED', title: `Duplikat-skanning ferdig: ${reports.length} rapport(er)`, severity: 'info', metadata: { job_name: 'kjørDuplikatSkan', uke, rapporter: reports.length } });
}

// ─── Smart Velkomst tilbake ───────────────────────────────────────────────────

async function smartVelkomst(userId: string, username: string, displayName: string) {
  const kanal = await finnChatKanal();
  if (!kanal) return;

  const member = getMember(userId);
  if (!member) return;

  // Cooldown: ikke velkomst innen 24t
  if (member.lastWelcomed) {
    const siden = Date.now() - new Date(member.lastWelcomed).getTime();
    if (siden < 24 * 60 * 60 * 1000) return;
  }

  // Kun for aktive membres (minst 5 meldinger)
  if ((member.messages ?? 0) < 5) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  try {
    const openai = new OpenAI({ apiKey });
    const stats = `Meldinger: ${member.messages}, Subs: ${member.subs}, Streams sett: ${member.streamsWatched}, Level: ${member.level}`;
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Lag en kort, personlig velkomst-tilbake-melding på norsk for Discord-brukeren ${displayName}. Stats: ${stats}. Maks 1 setning, naturlig, ikke robotaktig.` }],
      max_tokens: 60,
      temperature: 0.9,
    });
    const melding = res.choices[0]?.message?.content ?? '';
    if (melding) {
      await kanal.send(melding);
      setLastWelcomed(userId);
    }
  } catch {}
}

let forrigeFollowers = 0;

async function sjekkGoals() {
  try {
    const fs = require('fs');
    const path = require('path');
    const goalFil = path.join(process.cwd(), 'data', 'goals.json');
    if (!fs.existsSync(goalFil)) return;

    const goals = JSON.parse(fs.readFileSync(goalFil, 'utf-8')) as any[];
    const aktive = goals.filter((g: any) => g.aktiv && g.mal > 0);
    if (aktive.length === 0) return;

    // Hent ekte tall
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return;
    const stats = await getChannelStats(broadcasterId);
    const nyeFollowers = stats.followerCount;

    // Post til Twitch chat hvis vesentlig endring
    if (forrigeFollowers > 0 && nyeFollowers > forrigeFollowers) {
      const økning = nyeFollowers - forrigeFollowers;
      const mål = aktive.find((g: any) => g.type === 'followers');
      if (mål && økning >= 1) {
        const pct = Math.min(100, Math.round((nyeFollowers / mål.mal) * 100));
        const twitchMsg = `🎯 Vi er nå ${nyeFollowers.toLocaleString()} følgere! ${pct}% av målet på ${mål.mal.toLocaleString()}. Tusen takk! 💚`;
        // Post til Twitch chat via twitchBot (eksponert gjennom global state ikke mulig direkte)
        // Post til Discord
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
        if (appUrl) {
          const url = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
          await fetch(`${url}/api/goals/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              goals,
              live: { followers: nyeFollowers, discordMembres: 0 },
            }),
          }).catch(() => {});
        }
        addLog('info', `Followers oppdatert: ${nyeFollowers} (+${økning})`, 'OK');
      }
    }

    forrigeFollowers = nyeFollowers;
  } catch (error) {
    addLog('error', `Goals-sjekk feil: ${(error as Error).message}`, 'ERROR');
  }
}

async function delSocialsSubtilt() {
  const [aktiv, pauseDiscord] = await Promise.all([getAktiv().catch(() => true), getPauseDiscord().catch(() => false)]);
  if (!aktiv || pauseDiscord) return;
  const kanal = await finnChatKanal();
  if (!kanal) return;

  const settings = getSettings();
  const s: Record<string, string | undefined> = { ...(settings.socials ?? {}) };
  const links = byggSocialsEmbed(s, settings.twitchUrl);
  if (links.length === 0) return;

  const apiKey = process.env.OPENAI_API_KEY;
  let intro = `🔗 Finn ${BOT_BRAND} på alle plattformer:`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Skriv én kort, naturlig norsk setning (maks 10 ord) som oppfordrer folk til å følge ${BOT_BRAND} på sosiale medier. Ikke nevn "følg" direkte. Vær kreativ.` }],
        max_tokens: 40,
        temperature: 0.95,
      });
      intro = res.choices[0]?.message?.content?.trim() ?? intro;
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setColor(0x00ff41)
    .setDescription(`${intro}\n\n${links.join('\n')}`)
    .setFooter({ text: BOT_BRAND });

  await discordSend(kanal, { embeds: [embed] }, { trigger: 'socials_promo' });
  addToMemory({ type: 'socials', innhold: 'delt sosiale lenker' });
}

// Roterer mellom: partner → stream → community → partner → ...
let proaktivRunde = 0;
let _discordPromoerDenneStream = 0;
let _discordSistePartnerPromo = 0;

async function hentBotContext(): Promise<{ jokes: string[]; topics: string[] }> {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { jokes: [], topics: [] };
  try {
    const wid = encodeURIComponent(process.env.WORKSPACE_ID || 'glenvex-default');
    const r = await fetch(
      `${sbUrl}/rest/v1/ai_agent_memory?workspace_id=eq.${wid}&memory_type=in.(joke,topic)&order=occurrence_count.desc&limit=10&select=memory_type,summary`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
    );
    const data = await r.json() as any[];
    return {
      jokes: data.filter((m: any) => m.memory_type === 'joke').map((m: any) => m.summary as string).slice(0, 3),
      topics: data.filter((m: any) => m.memory_type === 'topic').map((m: any) => m.summary as string).slice(0, 3),
    };
  } catch { return { jokes: [], topics: [] }; }
}

async function sendPartnerPromoMelding(kanal: TextChannel): Promise<void> {
  const partner = await getRandomActivePartner();
  if (!partner) return; // mangler URL eller ingen aktive partnere

  const apiKey = process.env.OPENAI_API_KEY;
  const kode = partner.rabattkode ? ` (kode: ${partner.rabattkode})` : '';
  let tekst = `🤝 **${partner.navn}** – ${partner.beskrivelse ?? ''}\n${partner.finalUrl}${kode}`;

  if (apiKey) {
    try {
      const ctx = await hentBotContext();
      const contextHints = [
        ctx.jokes.length > 0 ? `Community inside jokes: ${ctx.jokes.slice(0, 2).join(', ')}` : '',
        ctx.topics.length > 0 ? `Aktuelle topics: ${ctx.topics.slice(0, 2).join(', ')}` : '',
      ].filter(Boolean).join('. ');

      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Skriv en autentisk norsk Discord-promo (maks 2 setninger) for partner: ${partner.navn} – ${partner.beskrivelse ?? ''}.${partner.rabattkode ? ` Kode: ${partner.rabattkode}.` : ''} Lenke: ${partner.finalUrl}.${contextHints ? ` Community-kontekst: ${contextHints}.` : ''} Naturlig tone, ikke salesy.`,
        }],
        max_tokens: 120,
        temperature: 0.8,
      });
      const ai = res.choices[0]?.message?.content ?? '';
      if (ai) {
        const aiTekst = `🤝 ${ai}`;
        tekst = partner.finalUrl && !ai.includes(partner.finalUrl)
          ? `${aiTekst}\n${partner.finalUrl}${kode}`
          : aiTekst;
      }
    } catch {}
  }

  await discordSend(kanal, tekst, { trigger: 'partner_promo', partner: partner.navn });

  logPartnerPromoResult({
    partnerName: partner.navn,
    platform: 'discord',
    channel: kanal.name,
    affiliateUrlUsed: partner.finalUrl,
    hadAffiliateUrl: partner.affiliateUrl !== null,
    missingAffiliate: partner.missedAffiliate,
    copyText: tekst,
  }).catch(() => {});

  trackPartnerExposure({
    partnerId: partner.id,
    partnerName: partner.navn,
    platform: 'discord',
    channelId: kanal.id,
    source: 'discord_rotation',
  }).catch(() => {});

  addToMemory({ type: 'proaktiv', innhold: `partner: ${partner.navn}` });
}

async function sendStreamInfoMelding(kanal: TextChannel): Promise<void> {
  const plan = await getStreamplan();
  const osloDatoISO = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
  const { day: idag } = getOsloTime();

  // Single-date entries only if date >= today; weekly entries always eligible
  const aktive = plan.filter((e: StreamEntry) => {
    if (!e.aktiv) return false;
    if (e.type === 'single') return !!e.date && e.date >= osloDatoISO && e.status !== 'completed';
    return true;
  });
  if (aktive.length === 0) return;

  // Find the next upcoming entry (soonest weekday or single date)
  const scoredEntries = aktive.map((e: StreamEntry) => {
    if (e.type === 'single') {
      return { entry: e, daysAhead: (new Date(e.date!).getTime() - new Date(osloDatoISO).getTime()) / 86_400_000 };
    }
    const dagIdx = e.weekday ?? DAGNAVN_BOT.indexOf(e.dag ?? '');
    const daysAhead = ((dagIdx - idag + 7) % 7) || 7;
    return { entry: e, daysAhead };
  }).sort((a: any, b: any) => a.daysAhead - b.daysAhead);

  const neste: StreamEntry = scoredEntries[0].entry;
  const dagLabel = neste.type === 'single'
    ? `${neste.date} kl. ${neste.tid}`
    : `${neste.dag ?? DAGNAVN_BOT[neste.weekday ?? 0]} kl. ${neste.tid} (ukentlig)`;

  const apiKey = process.env.OPENAI_API_KEY;
  const twitchUrl = await getTwitchUrl().catch(() => `https://twitch.tv/${process.env.TWITCH_USERNAME ?? 'glenvex'}`);
  let tekst = `📅 Neste stream: **${dagLabel}** – **${neste.spill}**${neste.tittel ? ` – *${neste.tittel}*` : ''}\nFølg med på ${twitchUrl} 🔴`;
  if (apiKey) {
    const openai = new OpenAI({ apiKey });
    const ukentligInfo = neste.type === 'weekly' ? ' (gjentas ukentlig)' : '';
    const res2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Skriv en kort og energisk norsk Discord-melding (maks 2 setninger) om at ${BOT_BRAND} streamer ${neste.spill} ${dagLabel}${ukentligInfo}${neste.tittel ? ` med tittelen "${neste.tittel}"` : ''}. Ikke start med emoji.` }],
      max_tokens: 80,
      temperature: 0.9,
    });
    const ai = res2.choices[0]?.message?.content ?? '';
    if (ai) tekst = `📅 ${ai}\n${twitchUrl}`;
  }
  await discordSend(kanal, tekst, { trigger: 'stream_info', spill: neste.spill });
  addToMemory({ type: 'proaktiv', innhold: `stream-info: ${neste.spill}` });
}

async function sendProaktivMelding() {
  const [aktiv, pauseDiscord, pauseProaktiv] = await Promise.all([
    getAktiv().catch(() => true),
    getPauseDiscord().catch(() => false),
    getPauseProaktiv().catch(() => false),
  ]);
  if (!aktiv || pauseDiscord || pauseProaktiv) return;

  const runde = proaktivRunde % 3;
  proaktivRunde++;

  try {
    if (runde === 0) {
      // Partner-promo → sjekk via promotionEngine først
      const partnerKanal = await finnPartnerKanal();
      if (!partnerKanal) return;

      const pbSettings = await loadPartnerBotSettings().catch(() => null);
      const minutesSinceLast = (Date.now() - _discordSistePartnerPromo) / 60_000;

      if (pbSettings?.enabled && pbSettings.discordEnabled) {
        const decision = await decidePromotion({
          workspaceId: process.env.WORKSPACE_ID ?? 'glenvex-default',
          game: '',
          viewerCount: 0,
          historicalAvgViewers: 0,
          chatMessagesLastMinute: 0,
          recentChatLines: [],
          minutesSinceLastPost: minutesSinceLast,
          postsThisStream: _discordPromoerDenneStream,
          settings: pbSettings,
        }).catch(() => null);

        if (decision && decision.shouldPromote && decision.messageDiscord) {
          // Engine-generert melding — send direkte
          await discordSend(partnerKanal, decision.messageDiscord, { trigger: 'partner_promotion_engine', partner: decision.partnerName });
          _discordSistePartnerPromo = Date.now();
          _discordPromoerDenneStream++;
          if (decision.partnerName) {
            await trackPartnerExposure({
              partnerId: decision.partnerId ?? undefined,
              partnerName: decision.partnerName,
              platform: 'discord',
              channelId: partnerKanal.id,
              source: `engine_${decision.triggerType}`,
            }).catch(() => {});
          }
          return;
        }

        if (decision && decision.proposalId) {
          // requireApproval=true → proposal stored, skip send this round
          return;
        }
      }

      // Fallback: bruk eksisterende sendPartnerPromoMelding hvis engine er deaktivert
      await sendPartnerPromoMelding(partnerKanal);
    } else if (runde === 1) {
      // Stream-info → chat (greit som det er)
      const chatKanal = await finnChatKanal();
      if (!chatKanal) return;
      await sendStreamInfoMelding(chatKanal);
    } else {
      // Community-melding → chat
      const chatKanal = await finnChatKanal();
      if (!chatKanal) return;
      const melding = getProaktivMelding();
      await discordSend(chatKanal, melding, { trigger: 'proaktiv_community' });
      addToMemory({ type: 'proaktiv', innhold: melding });
    }
  } catch {}
}

// ─── Ukentlig statistikk ─────────────────────────────────────────────────────

async function sjekkUkentligStats() {
  const now = new Date();
  if (now.getDay() !== 0) return;
  const uke = ukeNummer();
  if (uke === sisteStatsukeNr) return;
  sisteStatsukeNr = uke;

  logSystemEvent({ source: 'cron', event_type: 'CRON_EXECUTED', title: 'Cron startet: sjekkUkentligStats', severity: 'info', metadata: { job_name: 'sjekkUkentligStats', uke } });

  const kanal = await finnChatKanal();
  if (!kanal) return;

  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return;

    const stats = await getChannelStats(broadcasterId);
    const stream = await getStreamInfo().catch(() => null);

    const topClipsTekst = stats.topClips.length > 0
      ? stats.topClips.slice(0, 3).map((c, i) => `${i + 1}. [${c.title}](${c.url}) — ${c.viewCount} visninger`).join('\n')
      : 'Ingen clips denne uken';

    const apiKey = process.env.OPENAI_API_KEY;
    let kommentar = '';
    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Du er community-boten for ${BOT_BRAND}. Skriv én kort, energisk norsk setning (maks 15 ord) som oppsummerer uken. Følgere: ${stats.followerCount}. Clips: ${stats.clipCount}.` }],
        max_tokens: 60,
        temperature: 0.9,
      });
      kommentar = res.choices[0]?.message?.content ?? '';
    }

    const raids = topRaids(3);
    const giftSubs = topGiftSubs(3);

    const raidTekst = raids.length > 0
      ? raids.map((r, i) => `${i + 1}. **${r.username}** – ${r.viewers} seere`).join('\n')
      : 'Ingen raids denne uken';

    const giftSubTekst = giftSubs.length > 0
      ? giftSubs.map((g, i) => `${i + 1}. **${g.username}** – ${g.count} subs`).join('\n')
      : 'Ingen gift subs denne uken';

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle(`📊 Ukentlig statistikk – ${BOT_BRAND}`)
      .setDescription(kommentar || 'Enda en uke i boken!')
      .addFields(
        { name: '👥 Følgere', value: stats.followerCount.toLocaleString(), inline: true },
        { name: '🎬 Clips', value: stats.clipCount.toString(), inline: true },
        { name: '🔴 Status', value: stream?.isLive ? 'LIVE NÅ' : 'Offline', inline: true },
        { name: '🚨 Topp 3 raids', value: raidTekst, inline: false },
        { name: '🎁 Topp gift-givers', value: giftSubTekst, inline: false },
        { name: '🏆 Topp clips', value: topClipsTekst, inline: false },
      )
      .setFooter({ text: `Uke ${uke} • ${BOT_BRAND} Stream Control` })
      .setTimestamp();

    await discordSend(kanal, { embeds: [embed] }, { trigger: 'ukentlig_stats', uke });
    addLog('success', `Ukentlig stats postet (uke ${uke})`, 'OK');
    logSystemEvent({ source: 'cron', event_type: 'CRON_COMPLETED', title: `Cron ferdig: sjekkUkentligStats — uke ${uke}`, severity: 'info', metadata: { job_name: 'sjekkUkentligStats', uke } });
  } catch (error) {
    addLog('error', `Stats feil: ${(error as Error).message}`, 'ERROR');
    logSystemEvent({ source: 'cron', event_type: 'CRON_FAILED', title: `Cron feilet: sjekkUkentligStats — ${(error as Error).message?.slice(0, 80)}`, severity: 'error', metadata: { job_name: 'sjekkUkentligStats', error_message: (error as Error).message?.slice(0, 200) } });
  }
}

// ─── Clip-deling ─────────────────────────────────────────────────────────────

async function postTopClip() {
  const kanal = await finnClipsKanal();
  if (!kanal) return;
  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return;
    const clips = await getTopClips(broadcasterId, 10);
    const nyClip = clips.find(c => !postedeClips.has(c.id));
    if (!nyClip) return;
    postedeClips.add(nyClip.id);

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle(`🎬 ${nyClip.title}`)
      .setDescription(`👀 **${nyClip.viewCount}** visninger • ⏱️ ${Math.round(nyClip.duration)}s\n\n[Se clipsen her](${nyClip.url})`)
      .setImage(nyClip.thumbnailUrl)
      .setFooter({ text: 'Stream Control • Auto Clip' })
      .setTimestamp();

    await discordSend(kanal, { content: '🔥 Har dere sett denne clipsen?', embeds: [embed] }, { trigger: 'clip_post', clip: nyClip.title });
    addLog('success', `Clip postet: ${nyClip.title}`, 'OK');
  } catch (error) {
    addLog('error', `Clip-post feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Velkomstmelding ─────────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  logBotAgentEvent({ source: 'discord', event_type: 'member_join', username: member.user.username, importance_score: 50, metadata: { userId: member.user.id } });
  upsertBotMemory({ agent_type: 'discord', memory_type: 'member', key: member.user.id, summary: `${member.displayName} ble med i ${BOT_BRAND} Discord`, confidence_score: 0.6, metadata: { username: member.user.username } }).catch(() => {});
  upsertMember(member.user.id, member.user.username, member.displayName);
  if (member.guild) {
    const { tildeltSpesialRolle } = await import('./lib/roleManager');
    tildeltSpesialRolle(member.guild, member, 'new_member').catch(() => {});
  }

  const kanal = await finnChatKanal();
  if (!kanal) return;

  const apiKey = process.env.OPENAI_API_KEY;
  const twitchUrlVelkomst = await getTwitchUrl().catch(() => `https://twitch.tv/${process.env.TWITCH_USERNAME ?? 'glenvex'}`);
  let velkomst = `Hei **${member.displayName}**, velkommen til ${BOT_BRAND} sitt community! Sjekk ${twitchUrlVelkomst} og slå på varslinger.`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Du er community-boten for ${BOT_BRAND}. Skriv en kort, varm og energisk velkomstmelding på norsk. Nevn ${twitchUrlVelkomst}. Maks 2 setninger.` },
          { role: 'user', content: `Nytt medlem: ${member.displayName}` },
        ],
        max_tokens: 100,
        temperature: 0.9,
      });
      velkomst = res.choices[0]?.message?.content ?? velkomst;
    } catch {}
  }

  await discordSend(kanal, velkomst, { trigger: 'member_welcome', member: member.displayName }).catch(() => {});
});

// ─── Tråd-deltakelse ──────────────────────────────────────────────────────────

client.on('threadCreate', async (thread: ThreadChannel) => {
  try {
    await thread.join();
    const apiKey = process.env.OPENAI_API_KEY;
    let melding = `Ny tråd – jeg er med! Hva diskuterer vi? 👀`;

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Skriv en kort, engasjerende norsk hilsen (1 setning) for en ny Discord-tråd ved navn: "${thread.name}". Gaming-vibe, ${BOT_BRAND} community.` }],
        max_tokens: 60,
        temperature: 0.9,
      });
      melding = res.choices[0]?.message?.content ?? melding;
    }

    await thread.send(melding);
  } catch {}
});

// ─── Schedulers ──────────────────────────────────────────────────────────────

const POLL_INTERVAL        = 2  * 60 * 1000;
const PROAKTIV_INTERVAL    = 8  * 60 * 60 * 1000;
const CLIP_INTERVAL        = 12 * 60 * 60 * 1000;
const STATS_SJEKK_INTERVAL = 6  * 60 * 60 * 1000;
const RYDD_SJEKK_INTERVAL  = 6  * 60 * 60 * 1000;
const SOCIALS_INTERVAL     = 8  * 60 * 60 * 1000; // Hver 8. time
const GOALS_INTERVAL       = 6  * 60 * 60 * 1000; // Hver 6. time

async function resetAnalyzerendeVods(grunn: string) {
  // Reset ALLE ANALYZING-VODs – Railway-restart dreper alle prosesser, ingen er aktive
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return;
    const res = await fetch(`${sbUrl}/rest/v1/content_vods?status=eq.ANALYZING&select=id,title`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    });
    if (!res.ok) return;
    const stucke = await res.json() as any[];
    for (const vod of stucke) {
      await fetch(`${sbUrl}/rest/v1/content_vods?id=eq.${vod.id}`, {
        method: 'PATCH',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'PENDING', error_message: grunn, progress_percent: 0, updated_at: new Date().toISOString() }),
      });
      addLog('warning', `Reset ANALYZING VOD til PENDING: ${vod.title ?? vod.id}`, 'RECOVERY');
    }
    if (stucke.length > 0) console.log(`[Recovery] Reset ${stucke.length} ANALYZING VOD(er) til PENDING (${grunn})`);
  } catch {}
}

async function sjekkStuckeVodsPeriodisk() {
  // Periodisk sjekk: ANALYZING-VODs som ikke er oppdatert på 2+ timer er garantert stuck
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return;
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${sbUrl}/rest/v1/content_vods?status=eq.ANALYZING&updated_at=lt.${cutoff}&select=id,title`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    });
    if (!res.ok) return;
    const stucke = await res.json() as any[];
    for (const vod of stucke) {
      await fetch(`${sbUrl}/rest/v1/content_vods?id=eq.${vod.id}`, {
        method: 'PATCH',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'PENDING', error_message: 'Stuck etter 2t – resatt automatisk', progress_percent: 0, updated_at: new Date().toISOString() }),
      });
      addLog('warning', `Periodisk reset: stuck VOD ${vod.title ?? vod.id}`, 'RECOVERY');
    }
  } catch (err: any) {
    logSystemEvent({ source: 'cron', event_type: 'CRON_FAILED', title: `Cron feilet: sjekkStuckeVods — ${err?.message?.slice(0, 80) ?? ''}`, severity: 'error', metadata: { job_name: 'sjekkStuckeVods', error_message: err?.message?.slice(0, 200) } });
  }
}

const DAGNAVN_BOT = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

// Oslo-timezone-sikker tidsberegning (Railway kjører UTC)
function getOsloTime(): { day: number; minutes: number; dagNavn: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Oslo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Mon';
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0';
  const minStr  = parts.find(p => p.type === 'minute')?.value ?? '0';
  // Intl hour12:false kan gi '24' ved midnatt på noen systemer
  const hour = parseInt(hourStr) % 24;
  const min  = parseInt(minStr);
  const day  = weekdayMap[weekday] ?? new Date().getDay();
  return { day, minutes: hour * 60 + min, dagNavn: DAGNAVN_BOT[day] ?? weekday };
}

async function sjekkPreHype() {
  try {
    const syklus = await getStreamSyklus();
    if (syklus.pre_hype_sendt_at) {
      logSystemEvent({ source: 'scheduler', event_type: 'PREHYPE_ALREADY_SENT', title: 'Pre-hype allerede sendt denne syklusen', severity: 'info', metadata: { sendt_at: syklus.pre_hype_sendt_at } });
      return;
    }

    const plan = await getStreamplan();
    const aktive = plan.filter((e: StreamEntry) => e.aktiv && e.pre_hype_enabled !== false && e.status !== 'completed');
    if (aktive.length === 0) return;

    // Oslo time: Railway runs UTC
    const { day: idag, minutes: minutter, dagNavn } = getOsloTime();
    // Oslo ISO date for single-stream comparison
    const osloDatoISO = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date()); // "YYYY-MM-DD"

    let planlagtStream: StreamEntry | null = null;
    let diffTilStream = 9999;

    for (const entry of aktive) {
      const preHypeMin = entry.pre_hype_minutes_before ?? 60;

      if (entry.type === 'single') {
        // Never promote past single-date streams
        if (!entry.date || entry.date < osloDatoISO) {
          if (entry.date && entry.date < osloDatoISO && entry.status !== 'completed') {
            await updateStreamEntryStatus(entry.id, 'completed');
          }
          continue;
        }
        if (entry.date !== osloDatoISO) continue;
      } else {
        // weekly: match by dag name (legacy) or weekday index
        const dagIdx = entry.weekday ?? DAGNAVN_BOT.indexOf(entry.dag ?? '');
        if (dagIdx !== idag) continue;
      }

      const [timer, min] = (entry.tid ?? '20:00').split(':').map(Number);
      const streamMin = timer * 60 + min;
      const diff = streamMin - minutter;
      if (diff > 0 && diff <= preHypeMin && diff < diffTilStream) {
        diffTilStream = diff;
        planlagtStream = entry;
      }
    }

    if (!planlagtStream) return;

    logSystemEvent({
      source: 'scheduler',
      event_type: 'PREHYPE_SCHEDULED',
      title: `Pre-hype: stream om ${diffTilStream} min (${planlagtStream.spill})`,
      severity: 'info',
      metadata: {
        spill: planlagtStream.spill,
        type: planlagtStream.type,
        date: planlagtStream.date,
        dag: planlagtStream.dag,
        tid: planlagtStream.tid,
        diffMinutter: diffTilStream,
        osloDag: dagNavn,
        osloMinutter: minutter,
      },
    });

    const kanal = await finnPreHypeKanal();
    if (!kanal) {
      logSystemEvent({ source: 'scheduler', event_type: 'PRE_HYPE_SKIPPED_MISSING_CHANNEL', title: 'Pre-hype hoppet over – pre-hype kanal ikke konfigurert', severity: 'warning', metadata: { spill: planlagtStream.spill, fix: 'Gå til Settings → Discord Kanaler → sett Pre-Hype kanal' } });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const ukelabel = planlagtStream.type === 'weekly' ? ' (ukentlig)' : '';
    let melding = `🔥 **${BOT_BRAND}** streamer om ${diffTilStream} minutt${diffTilStream > 1 ? 'er' : ''}! ${planlagtStream.spill} starter kl. ${planlagtStream.tid}${ukelabel}`;
    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const typeKontekst = planlagtStream.type === 'single'
          ? `Dette er en engangsstream den ${planlagtStream.date}.`
          : 'Dette er en ukentlig stream.';
        const res2 = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: `${BOT_BRAND} streamer ${planlagtStream.spill} om ${diffTilStream} minutter. ${typeKontekst} Lag en kort, energisk norsk hype-melding (maks 2 setninger, community-fokusert). Ingen emojis i starten.` }],
          max_tokens: 80,
          temperature: 0.9,
        });
        const ai = res2.choices[0]?.message?.content ?? '';
        if (ai) melding = `🔥 ${ai}`;
      } catch {}
    }

    const sendtOk = await discordSend(kanal, melding, { trigger: 'pre_hype', spill: planlagtStream.spill, minutter: diffTilStream }).then(() => true).catch(() => false);
    await updateStreamSyklus({ pre_hype_sendt_at: new Date().toISOString() });

    // Mark single-stream as completed so it's never re-promoted after today
    if (planlagtStream.type === 'single') {
      await updateStreamEntryStatus(planlagtStream.id, 'completed');
    }

    logBotEvent('pre_hype', { spill: planlagtStream.spill, tittel: planlagtStream.tittel ?? '', minutter_til: diffTilStream, type: planlagtStream.type });

    logSystemEvent({
      source: 'scheduler',
      event_type: 'PREHYPE_SENT',
      title: `Pre-hype sendt: ${planlagtStream.spill} om ${diffTilStream} min`,
      severity: sendtOk ? 'info' : 'warning',
      metadata: { spill: planlagtStream.spill, type: planlagtStream.type, kanal: kanal.id, sendtOk, diffMinutter: diffTilStream },
    });

    addLog(sendtOk ? 'success' : 'warning', `Pre-hype ${sendtOk ? 'sendt' : 'feilet'}: ${planlagtStream.spill} om ${diffTilStream}min`, sendtOk ? 'OK' : 'WARN');
  } catch (err: any) {
    console.error('[PreHype] Feil:', err.message);
    logSystemEvent({ source: 'scheduler', event_type: 'PREHYPE_ERROR', title: `Pre-hype feil: ${err.message.slice(0, 100)}`, severity: 'error' });
  }
}

const BOT_ADMIN_USERNAME = process.env.BOT_ADMIN_USERNAME ?? 'gkarlsen';
const STATUS_KANAL_ID = process.env.STATUS_CHANNEL_ID ?? '1511722714623381645';

async function tildelTwitchSubRolle(twitchUsername: string): Promise<void> {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  const ROLLE_NAVN = '⭐ Twitch Sub';
  let rolle = guild.roles.cache.find(r => r.name === ROLLE_NAVN);
  if (!rolle) {
    rolle = await guild.roles.create({ name: ROLLE_NAVN, color: 0x9146FF, reason: 'Auto-opprettet for Twitch subs' });
  }
  const lower = twitchUsername.toLowerCase();
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const match = [...members.values()].find(m =>
    m.user.username.toLowerCase() === lower ||
    (m.nickname ?? '').toLowerCase() === lower
  );
  if (match && !match.roles.cache.has(rolle.id)) {
    await match.roles.add(rolle, 'Twitch sub verifisert').catch(() => {});
  }
}

async function sikkerAdminTilGkarlsen(): Promise<void> {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const gkarlsen = [...members.values()].find(m => m.user.username.toLowerCase() === BOT_ADMIN_USERNAME);
  if (!gkarlsen) return;
  let adminRolle = guild.roles.cache.find(r => r.permissions.has('Administrator'));
  if (!adminRolle) {
    adminRolle = await guild.roles.create({ name: '👑 Admin', permissions: ['Administrator'], reason: `Admin-rolle for ${BOT_ADMIN_USERNAME}` });
  }
  if (!gkarlsen.roles.cache.has(adminRolle.id)) {
    await gkarlsen.roles.add(adminRolle, `${BOT_ADMIN_USERNAME} er serveradministrator`).catch(() => {});
  }
}

// ─── Workspace ID-oppløsning ved oppstart ────────────────────────────────────
// Prøver å finne det faktiske workspace-IDen fra Supabase slik at Railway-loggen
// viser nøyaktig hva man må sette som WORKSPACE_ID i Railway env vars.
async function logWorkspaceIdDiagnose(): Promise<void> {
  const currentId = process.env.WORKSPACE_ID ?? 'glenvex-default';
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const twitchUser = process.env.TWITCH_USERNAME ?? '';

  console.log(`\n  🔑 WORKSPACE_ID (bot): "${currentId}"`);

  if (!sbUrl || !sbKey) {
    console.log('  ⚠️  SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler — kan ikke verifisere workspace');
    return;
  }

  try {
    // Finn workspace fra Supabase via Twitch-brukernavn
    const qs = new URLSearchParams({ select: 'id,brand_name,twitch_channel_name' });
    if (twitchUser) qs.set('twitch_channel_name', `eq.${twitchUser}`);
    const res = await fetch(`${sbUrl}/rest/v1/workspaces?${qs}`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const rows = await res.json() as any[];
      if (rows.length > 0) {
        const ws = rows[0];
        if (ws.id !== currentId) {
          console.log(`  ❌ WORKSPACE_ID MISMATCH!`);
          console.log(`     Bot bruker:      "${currentId}"`);
          console.log(`     Supabase har:    "${ws.id}" (${ws.brand_name ?? ws.twitch_channel_name})`);
          console.log(`     FIX: Sett WORKSPACE_ID="${ws.id}" i Railway environment variables`);
          console.log(`     Åpne: /api/debug/workspace for full diagnose\n`);
          // Emit med korrekt workspace_id slik at Dashboard kan se varselet,
          // ikke bare Railway-konsollen.
          logSystemEvent({
            workspaceId: ws.id,
            source: 'bot_startup',
            event_type: 'WORKSPACE_ID_MISMATCH',
            title: `WORKSPACE_ID mismatch: bot bruker "${currentId}", Supabase har "${ws.id}"`,
            severity: 'error',
            metadata: {
              botWorkspaceId: currentId,
              correctWorkspaceId: ws.id,
              brandName: ws.brand_name ?? ws.twitch_channel_name,
              fix: `Sett WORKSPACE_ID="${ws.id}" i Railway environment variables`,
            },
          });
        } else {
          console.log(`  ✅ WORKSPACE_ID er korrekt: "${ws.id}" (${ws.brand_name ?? ws.twitch_channel_name})\n`);
        }
      } else {
        console.log(`  ℹ️  Ingen workspace funnet for twitch_channel_name="${twitchUser}" — sjekk /api/debug/workspace\n`);
      }
    }
  } catch (err: any) {
    console.log(`  ⚠️  Workspace-diagnose feilet: ${err?.message?.slice(0, 80)}\n`);
  }
}

// ─── Heartbeats — skrives hvert 5. min for at System Coverage viser riktig status ──
function writeHeartbeats(): void {
  const uptime = Math.round(process.uptime());
  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'HEARTBEAT',
    title: 'Twitch Bot aktiv',
    severity: 'info',
    metadata: { uptime, pid: process.pid },
  });
  logSystemEvent({
    source: 'discord_bot',
    event_type: 'HEARTBEAT',
    title: 'Discord Bot aktiv',
    severity: 'info',
    metadata: { guilds: client.guilds.cache.size, uptime, pid: process.pid },
  });
  logSystemEvent({
    source: 'learning_aggregator',
    event_type: 'HEARTBEAT',
    title: 'Learning Aggregator aktiv',
    severity: 'info',
    metadata: { uptime, pid: process.pid },
  });
  logSystemEvent({
    source: 'scheduler',
    event_type: 'HEARTBEAT',
    title: 'Scheduler aktiv',
    severity: 'info',
    metadata: { uptime, pid: process.pid },
  });
  logSystemEvent({
    source: 'content_factory',
    event_type: 'HEARTBEAT',
    title: 'Content Factory aktiv',
    severity: 'info',
    metadata: { uptime, pid: process.pid },
  });
  logSystemEvent({
    source: 'recovery_engine',
    event_type: 'HEARTBEAT',
    title: 'Recovery Engine aktiv',
    severity: 'info',
    metadata: { uptime, pid: process.pid },
  });
}

client.once('clientReady', () => {
  startTwitchBot();
  startClipWorker().catch(console.error);
  startThumbnailWorker().catch(console.error);
  startDataApi(Number(process.env.PORT) || 4242);
  startLearningAggregator();
  startRecoveryEngine();
  startSystemEventsFlusher();
  initCreatorBrain().catch(() => {});
  startWorkspaceManager(client);
  // Discord historikk bootstrap: kjøres én gang per kanal, 5 min etter oppstart
  setTimeout(() => startDiscordHistoryBootstrap(client).catch(() => {}), 5 * 60_000);
  // Workspace-diagnose: logg til Railway-konsollen slik at man ser om WORKSPACE_ID er feil
  logWorkspaceIdDiagnose().catch(() => {});
  logSystemEvent({ source: 'discord_bot', event_type: 'BOT_STARTED', title: `${BOT_BRAND} Bot startet`, severity: 'info' });
  resetAnalyzerendeVods('Railway restartet – klikk Retry for å kjøre på nytt').catch(() => {});
  lasterMedlemmerFraSupabase().catch(() => {});

  // VOD startup recovery: if CONTENT_FACTORY_ENABLED and stream is offline at startup,
  // call detect-latest after 16 min to process any VOD missed due to bot restart.
  // Covers the case where bot restarts after stream ends and vodWatcher module-level
  // state (forrigeStream/offlineSiden) is reset to defaults.
  if (process.env.CONTENT_FACTORY_ENABLED === 'true') {
    setTimeout(async () => {
      try {
        const streamNå = await getStreamInfo().catch(() => null);
        if (streamNå?.isLive) {
          logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_WATCHER_RECOVERY_SKIPPED', title: 'VOD startup recovery: stream er live – hopper over', severity: 'info', metadata: {} });
          return;
        }
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
        if (!appUrl) {
          logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_WATCHER_RECOVERY_SKIPPED', title: 'VOD startup recovery: NEXT_PUBLIC_APP_URL mangler', severity: 'warning', metadata: {} });
          return;
        }
        const url = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
        logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_WATCHER_RECOVERY_TRIGGERED', title: 'VOD startup recovery: sjekker Twitch for ubehandlet VOD etter bot-restart', severity: 'info', metadata: { reason: 'bot_restart_module_state_reset' } });
        const res = await fetch(`${url}/api/vod/detect-latest`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
        const result = await res.json() as any;
        if (result?.ok) {
          logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_WATCHER_RECOVERY_TRIGGERED', title: `VOD startup recovery: pipeline startet for "${result.vod?.title ?? 'ukjent'}"`, severity: 'info', metadata: { vodId: result.vodId, title: result.vod?.title } });
          addLog('success', `VOD startup recovery: pipeline startet for "${result.vod?.title ?? result.vodId}"`, 'RECOVERY');
        } else if (result?.alleredeBehandlet) {
          logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_WATCHER_RECOVERY_SKIPPED', title: 'VOD startup recovery: alle siste VODer er allerede behandlet', severity: 'info', metadata: {} });
        }
      } catch {}
    }, 16 * 60_000);
  }
  console.log(`\n✓ ${BOT_BRAND} Bot pålogget som: ${client.user?.tag}`);
  console.log(`  Guilds: ${client.guilds.cache.size}`);
  console.log(`  Kommandoer: ${commands.size}`);
  console.log('\n  System aktivert. Kaoset starter nå.\n');
  addLog('success', `Discord bot startet: ${client.user?.tag}`, 'OK');

  setOnSubCallback(tildelTwitchSubRolle);
  sikkerAdminTilGkarlsen().catch(() => {});

  const statusKanal = client.channels.cache.get(STATUS_KANAL_ID) as TextChannel | undefined;
  if (statusKanal) {
    const meldinger = [
      'Jeg ble oppdatert, jeg føler meg mye smartere 🧠',
      'Oppdatering lastet inn – ny versjon, samme ego 😎',
      'Er tilbake, og bedre enn noen gang. Jeg ble oppdatert 🚀',
      'Oppdatert og klar. Prøv meg 👀',
      'Ny versjon, hvem dis? Jeg ble oppdatert nettopp ⚡',
    ];
    const tekst = meldinger[Math.floor(Math.random() * meldinger.length)];
    statusKanal.send(tekst).catch(() => {});
  }

  // I multi_tenant-mode kjører WorkspaceManager live-sjekk for andre workspaces.
  // Default-workspace (WORKSPACE_ID) fortsetter å bruke checkLive() direkte.
  setTimeout(() => { checkLive(); setInterval(checkLive, POLL_INTERVAL); }, 5_000);
  // Heartbeat: skriv til system_events hvert 5. min (sikrer at Coverage aldri viser 0)
  setTimeout(() => { writeHeartbeats(); setInterval(writeHeartbeats, 5 * 60_000); }, 60_000);
  setInterval(sjekkPreHype, 10 * 60 * 1000); // Sjekk pre-hype hvert 10. min
  setTimeout(() => { withCron('send-proaktiv', sendProaktivMelding); setInterval(() => withCron('send-proaktiv', sendProaktivMelding), PROAKTIV_INTERVAL); }, 30 * 60 * 1000);
  setTimeout(() => { withCron('post-top-clip', postTopClip); setInterval(() => withCron('post-top-clip', postTopClip), CLIP_INTERVAL); }, 60 * 60 * 1000);
  setTimeout(() => { withCron('del-socials', delSocialsSubtilt); setInterval(() => withCron('del-socials', delSocialsSubtilt), SOCIALS_INTERVAL); }, 3 * 60 * 60 * 1000);
  setTimeout(() => { withCron('sjekk-goals', sjekkGoals); setInterval(() => withCron('sjekk-goals', sjekkGoals), GOALS_INTERVAL); }, 2 * 60 * 60 * 1000);
  setInterval(sjekkUkentligStats, STATS_SJEKK_INTERVAL);
  setInterval(autoRyddKanaler, RYDD_SJEKK_INTERVAL);
  setInterval(kjørDuplikatSkan, RYDD_SJEKK_INTERVAL);
  setInterval(() => sjekkStuckeVodsPeriodisk().catch(() => {}), 30 * 60 * 1000); // Stuck-sjekk hvert 30. min
  setInterval(autoPostStreamplan, STATS_SJEKK_INTERVAL);
  // Community Manager Phase C: MVP daily (check every 4h, posts only after noon),
  // hype every 8h, idle check every 30 min
  setTimeout(() => { withCron('community-mvp', sjekkOgSendMVP); setInterval(() => withCron('community-mvp', sjekkOgSendMVP), 4 * 60 * 60 * 1000); }, 60 * 60 * 1000);
  setTimeout(() => { withCron('community-hype', sjekkOgSendHype); setInterval(() => withCron('community-hype', sjekkOgSendHype), 8 * 60 * 60 * 1000); }, 2 * 60 * 60 * 1000);
  setInterval(() => sjekkIdlePrompt().catch(() => {}), 30 * 60 * 1000);
});

// ─── Meldingslytter ───────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;

  // XP for alle meldinger i guild
  if (message.guild) {
    upsertMember(message.author.id, message.author.username, message.author.displayName ?? message.author.username);
    incrementChatMessages();
    // Discord activity tracking for learning (ikke logg hver melding – bare hvert 10. svar fra aktive)
    const member = getMember(message.author.id);
    if (member && (member.messages ?? 0) % 10 === 0 && (member.messages ?? 0) > 0) {
      logBotAgentEvent({ source: 'discord', event_type: 'active_member', username: message.author.username, importance_score: Math.min(70, (member.messages ?? 0) / 10), metadata: { messages: member.messages, level: member.level } });
      if ((member.messages ?? 0) >= 50) {
        upsertBotMemory({ agent_type: 'discord', memory_type: 'member', key: message.author.id, summary: `${member.displayName ?? message.author.username} – aktiv Discord-member (${member.messages} meldinger, Level ${member.level})`, confidence_score: 0.75, metadata: { username: message.author.username, messages: member.messages, level: member.level } }).catch(() => {});
      }
    }
    const displayName = message.author.displayName ?? message.author.username;
    const xpResult = addMessageXP(message.author.id, message.author.username, displayName, message.content);
    // Track stream attendance (once per stream day when bot knows stream is live)
    if (getActiveSession()) {
      addStreamAttendance(message.author.id, message.author.username, displayName);
    }
    if (xpResult?.leveledUp) {
      handleLevelUp(message.author.id, displayName, xpResult.newLevel, message.guild, message.member).catch(() => {});
    }
    // Smart velkomst (sjelden, for aktive membres)
    if (Math.random() < 0.05) {
      smartVelkomst(message.author.id, message.author.username, message.author.displayName ?? message.author.username).catch(() => {});
    }
  }

  const erTagget = message.mentions.has(client.user);
  const erIChatKanal = process.env.DISCORD_CHAT_CHANNEL_ID
    ? message.channelId === process.env.DISCORD_CHAT_CHANNEL_ID
    : false;
  const erITrad = message.channel instanceof ThreadChannel;

  if (!erTagget && !erIChatKanal && !erITrad) return;

  // ── Logg Discord-meldinger for cross-platform context ─────────────────────
  // Ingen DM-er (krever guild), ingen bots – allerede filtrert ovenfor
  if (message.guild && !message.author.bot) {
    const ordTelling = message.content.split(/\s+/).filter(w => w.length > 0).length;
    if (ordTelling >= 3 && message.content.length <= 600) {
      logChatMessage({
        source:       'discord',
        username:     message.author.username,
        message_text: message.content.slice(0, 500),
        channel_id:   message.channelId,
        importance_score: 20,
        metadata: { guildId: message.guild.id },
      });
    }
  }

  const tekst = message.content.replace(/<@!?[\d]+>/g, '').trim();
  if (!tekst) return;

  // ── Cross-platform tekst-kommandoer ───────────────────────────────────────
  const tekLower = tekst.toLowerCase();

  if (tekLower === '!twitchsiste' || tekLower === '!twitchtema') {
    if (isCommandCooldown(message.channelId, tekLower)) return;
    setCommandCooldown(message.channelId, tekLower);
    await message.channel.sendTyping();
    const oppsummering = await summarizeRecentActivity('twitch', 60);
    await message.reply(`📺 **Twitch-oppsummering:** ${oppsummering}`).catch(() => {});
    logBotAgentEvent({ source: 'discord', event_type: 'cross_platform_context_used', metadata: { command: tekLower, type: 'DISCORD_BOT_USED_TWITCH_CONTEXT' } });
    return;
  }

  if (tekLower === '!communitymemory') {
    if (isCommandCooldown(message.channelId, tekLower)) return;
    setCommandCooldown(message.channelId, tekLower);
    await message.channel.sendTyping();
    const memory = await hentCommunityMemorySummary();
    await message.reply(memory).catch(() => {});
    return;
  }

  if (isOnCooldown(message.author.id)) return;

  setCooldown(message.author.id);

  const [aktiv, pauseDiscord] = await Promise.all([getAktiv().catch(() => true), getPauseDiscord().catch(() => false)]);
  if (!aktiv || pauseDiscord) return;

  try {
    await message.channel.sendTyping();
    const svar: ChatReply = await generateChatReply(message.channelId, message.author.username, tekst);

    if (svar.bildeUrl) {
      const embed = new EmbedBuilder()
        .setColor(0x00ff41)
        .setImage(svar.bildeUrl)
        .setFooter({ text: `${BOT_BRAND} Bot • AI-generert bilde` });

      await message.reply({ content: svar.tekst ?? undefined, embeds: [embed] });
      logSystemEvent({
        source: 'discord_bot',
        event_type: 'DISCORD_AI_RESPONSE',
        title: `AI svarte med bilde i #${(message.channel as any).name ?? message.channelId}`,
        severity: 'info',
        metadata: { channel: message.channelId, username: message.author.username, hasBilde: true },
      });
    } else if (svar.tekst) {
      await message.reply(svar.tekst);
      logSystemEvent({
        source: 'discord_bot',
        event_type: 'DISCORD_AI_RESPONSE',
        title: svar.tekst.slice(0, 80),
        severity: 'info',
        metadata: { channel: message.channelId, username: message.author.username, length: svar.tekst.length },
      });
    }
  } catch (error) {
    addLog('error', `AI chat feil: ${(error as Error).message}`, 'ERROR');
  }
});

// ─── Interaksjoner ────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('slett_kanal_')) {
      await handleSlettKanalKnapp(interaction).catch(console.error);
      return;
    }
    if (interaction.customId.startsWith('stream_')) {
      await handleStreamKnapp(interaction).catch(console.error);
      return;
    }
    if (interaction.customId.startsWith('dup_slett_') || interaction.customId.startsWith('dup_ignorer_')) {
      await handleDuplikatKnapp(interaction).catch(console.error);
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
    addLog('info', `/${interaction.commandName} brukt av ${interaction.user.tag}`, 'OK');
  } catch (error) {
    console.error(`Feil i /${interaction.commandName}:`, error);
    addLog('error', `Feil i /${interaction.commandName}: ${(error as Error).message}`, 'ERROR');
    const msg = { content: '⚠️ En feil oppstod ved kjøring av kommandoen.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.on('error', (error) => {
  console.error('Discord client feil:', error);
  addLog('error', `Discord client feil: ${error.message}`, 'ERROR');
});

// ── Community Intelligence: Reaction tracking ─────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  try {
    const member = await reaction.message.guild?.members.fetch(user.id).catch(() => null);
    if (!member) return;
    addReaction(user.id, user.username ?? user.id, member.displayName);
  } catch {}
});

// ── Community Intelligence: Voice activity tracking ───────────────────────────
const voiceJoinTimes = new Map<string, number>();

client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.member?.id ?? oldState.member?.id;
  const username = newState.member?.user.username ?? oldState.member?.user.username ?? '';
  const displayName = newState.member?.displayName ?? username;
  if (!userId || newState.member?.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    voiceJoinTimes.set(userId, Date.now());
  } else if (oldState.channelId && !newState.channelId) {
    const joinTime = voiceJoinTimes.get(userId);
    if (joinTime) {
      const minutes = Math.floor((Date.now() - joinTime) / 60_000);
      voiceJoinTimes.delete(userId);
      if (minutes > 0) addVoiceMinutes(userId, username, displayName, minutes);
    }
  }
});

client.login(token);
