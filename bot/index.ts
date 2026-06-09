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
import { logBotEvent, updateStreamSyklus, resetStreamSyklus, getStreamSyklus, getStreamplan } from './lib/botEvents';
import { startSession, endSession, updateSession, incrementChatMessages, addRaidToSession, addSubToSession, getActiveSession } from './lib/streamHistory';
import { tildeltRolle } from './lib/roleManager';
import { startDataApi } from './lib/dataApi';
import { addToMemory, getBotSettings, getPersonalityPrompt } from '@/lib/botMemory';
import { addContent } from '@/lib/contentLibrary';
import { logBotAgentEvent, upsertBotMemory, logChatMessage } from './lib/agentLogger';
import { startLearningAggregator } from './lib/learningAggregator';
import { getRandomActivePartner, logPartnerPromoResult } from './lib/partnerHelper';
import { getBotTone, getPauseProaktiv, getAktiv, getPauseDiscord, getPauseLiveVarsler, getTwitchUrl } from './lib/botKanalPreferanser';
import { getRecentCrossPlatformContext, summarizeRecentActivity, hentCommunityMemorySummary, isCommandCooldown, setCommandCooldown } from './lib/crossPlatformContext';
import { startRecoveryEngine } from './lib/recoveryEngine';
import { startSystemEventsFlusher, logSystemEvent } from './lib/systemEvents';
import { startWorkspaceManager } from './lib/workspaceManager';
import { startDiscordHistoryBootstrap } from './lib/discordHistoryBootstrap';
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

const token = process.env.DISCORD_BOT_TOKEN;
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

function finnChatKanal(): TextChannel | null {
  const chatId = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (chatId) {
    const ch = client.channels.cache.get(chatId);
    if (ch instanceof TextChannel) return ch;
  }
  const fallback = client.channels.cache.find(
    ch => ch instanceof TextChannel &&
    (ch.name.includes('chat') || ch.name.includes('general') || ch.name.includes('gaming'))
  );
  return (fallback as TextChannel) ?? null;
}

function ukeNummer(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

// ─── Live-sjekk med stream-analyse ───────────────────────────────────────────

async function checkLive() {
  try {
    const settings = getSettings();
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

      let liveEmbedOk = false;
      try {
        await postLiveEmbed(stream, settings);
        liveEmbedOk = true;
        logSystemEvent({
          source: 'discord_bot',
          event_type: 'DISCORD_LIVE_ANNOUNCEMENT_SENT',
          title: `Discord live-varsel postet: ${stream.title?.slice(0, 60) ?? ''}`,
          severity: 'info',
          metadata: { streamId: stream.id, channelId: settings.discordLiveChannelId },
        });
      } catch (liveErr: any) {
        logSystemEvent({
          source: 'discord_bot',
          event_type: 'DISCORD_LIVE_ANNOUNCEMENT_FAILED',
          title: `Discord live-varsel feilet: ${liveErr.message?.slice(0, 100)}`,
          severity: 'error',
          metadata: { streamId: stream.id, error: liveErr.message },
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
        tekst: `🔴 GLENVEX ER LIVE – ${stream.game}: ${stream.title}`,
        kanalId: settings.discordLiveChannelId,
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
      endSession(0);
      logBotEvent('stream_offline', {});
      logBotAgentEvent({ source: 'twitch', event_type: 'stream_offline', importance_score: 80 });
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'STREAM_OFFLINE_DETECTED',
        title: 'Stream gikk offline – VOD-watcher starter om 15 min',
        severity: 'info',
        metadata: { resetSyklusOm: '2t' },
      });
      // Reset syklus 2 timer etter stream slutt (gir tid til VOD-prosessering å fullføres)
      setTimeout(() => resetStreamSyklus().catch(() => {}), 2 * 60 * 60 * 1000);
    }
  } catch (error) {
    addLog('error', `Live-sjekk feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Stream-kontekst analyse ─────────────────────────────────────────────────

async function analyserStreamKontekst(tittel: string, spill: string) {
  const kanal = finnChatKanal();
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
        content: `GLENVEX er nå live med tittel: "${tittel}" og spill: "${spill}".
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
      .setFooter({ text: 'GLENVEX Stream Control • Smart Live-deteksjon' });

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
        content: `GLENVEX streamer ${server}. Foreslå 2-3 karakternavn og roller som passer for en norsk ${server}-server. Format: Navn – Rolle (1 linje per karakter). Norsk. Maks 50 ord.`,
      }],
      max_tokens: 100,
      temperature: 0.9,
    });

    const forslag = res.choices[0]?.message?.content ?? '';
    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('◆ Karakterforslag')
      .setDescription(`Her er noen karakterforslag for **${server}**:\n\n${forslag}\n\nVil du opprette en kanal for en av disse? Bruk \`/kanaler opprett\``)
      .setFooter({ text: 'GLENVEX Stream Control' });

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
        content: `Discord-server for GLENVEX streamer nå ${server}. Nåværende kanaler: ${kanaler}.
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
      .setFooter({ text: 'GLENVEX Stream Control' });

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
  (global as any)[cacheKey] = true;

  try {
    const fs = require('fs');
    const path = require('path');
    const planFil = path.join(process.cwd(), 'data', 'schedule.json');

    let plan: any[] = [];
    if (fs.existsSync(planFil)) {
      plan = JSON.parse(fs.readFileSync(planFil, 'utf-8'));
    }

    let aktive = plan.filter((d: any) => d.aktiv);

    // Ingen plan satt – generer fra stream-historikk
    if (aktive.length === 0) {
      const historikkFil = path.join(process.cwd(), 'data', 'stream-history.json');
      if (fs.existsSync(historikkFil)) {
        const historikk = JSON.parse(fs.readFileSync(historikkFil, 'utf-8')) as any[];
        if (historikk.length > 0 && process.env.OPENAI_API_KEY) {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: `Basert på disse tidligere stream-øktene for GLENVEX, foreslå en ukentlig streamplan for denne uken som JSON-array:
[{"dag": "Mandag", "tid": "20:00", "spill": "Future RP", "tittel": "", "aktiv": true}]

Historikk: ${historikk.slice(0, 5).map(h => `${h.game} (${new Date(h.startedAt).toLocaleDateString('no-NO', { weekday: 'long' })} kl. ${new Date(h.startedAt).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })})`).join(', ')}

Returner kun JSON-array.`,
            }],
            max_tokens: 300,
            temperature: 0.7,
            response_format: { type: 'json_object' },
          });

          try {
            const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
            aktive = (parsed.plan ?? parsed.streamplan ?? []).filter((d: any) => d.aktiv);
            if (aktive.length > 0) {
              fs.writeFileSync(planFil, JSON.stringify(aktive.map((d: any) => ({ ...d, aktiv: true })), null, 2));
              addLog('info', `Streamplan auto-generert fra historikk (uke ${uke})`, 'OK');
            }
          } catch {}
        }
      }
    }

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
  } catch (error) {
    addLog('error', `Streamplan-post feil: ${(error as Error).message}`, 'ERROR');
  }
}

async function autoRyddKanaler() {
  const now = new Date();
  if (now.getDay() !== 1) return; // Kun mandag
  const uke = ukeNummer();
  if (uke === sisteRyddUke) return;
  sisteRyddUke = uke;

  const guild = client.guilds.cache.first();
  const chatKanal = finnChatKanal();
  if (!guild || !chatKanal) return;

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
      messages: [{ role: 'user', content: `Disse Discord-kanalene er inaktive i GLENVEX sitt community: ${liste}. Gi en kort norsk vurdering (maks 2 setninger) av hvilke som ikke trengs og bør fjernes. Vær konkret.` }],
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
    .setFooter({ text: 'Bruk /kanaler rydd for å slette • GLENVEX Stream Control' })
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

  await chatKanal.send({ embeds: [embed], components: rows });
  addLog('info', `Kanal-analyse: ${kandidater.length} inaktive kanaler funnet`, 'OK');
}

// ─── Proaktive meldinger ─────────────────────────────────────────────────────

// ─── Pre-Live Hype ───────────────────────────────────────────────────────────

async function postPreLiveHype(tittel: string, spill: string) {
  const kanal = finnChatKanal();
  if (!kanal) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `GLENVEX starter stream nå med ${spill}: "${tittel}". Lag en kort hype-melding på norsk (maks 2 setninger, energisk, community-fokusert). Ingen emojis i starten.` }],
      max_tokens: 80,
      temperature: 0.9,
    });
    const melding = res.choices[0]?.message?.content ?? '';
    if (melding) await discordSend(kanal, `🔴 **GLENVEX ER LIVE!** ${melding}`, { trigger: 'pre_live_hype' });
  } catch {}
}

// ─── Smart Velkomst tilbake ───────────────────────────────────────────────────

async function smartVelkomst(userId: string, username: string, displayName: string) {
  const kanal = finnChatKanal();
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
  const kanal = finnChatKanal();
  if (!kanal) return;

  const settings = getSettings();
  const s: Record<string, string | undefined> = { ...(settings.socials ?? {}) };
  const links = byggSocialsEmbed(s, settings.twitchUrl);
  if (links.length === 0) return;

  const apiKey = process.env.OPENAI_API_KEY;
  let intro = '🔗 Finn GLENVEX på alle plattformer:';

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Skriv én kort, naturlig norsk setning (maks 10 ord) som oppfordrer folk til å følge GLENVEX på sosiale medier. Ikke nevn "følg" direkte. Vær kreativ.' }],
        max_tokens: 40,
        temperature: 0.95,
      });
      intro = res.choices[0]?.message?.content?.trim() ?? intro;
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setColor(0x00ff41)
    .setDescription(`${intro}\n\n${links.join('\n')}`)
    .setFooter({ text: 'GLENVEX' });

  await discordSend(kanal, { embeds: [embed] }, { trigger: 'socials_promo' });
  addToMemory({ type: 'socials', innhold: 'delt sosiale lenker' });
}

// Roterer mellom: partner → stream → community → partner → ...
let proaktivRunde = 0;

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
          content: `Skriv en autentisk norsk Discord-promo (maks 2 setninger) for GLENVEXs partner: ${partner.navn} – ${partner.beskrivelse ?? ''}.${partner.rabattkode ? ` Kode: ${partner.rabattkode}.` : ''} Lenke: ${partner.finalUrl}.${contextHints ? ` Community-kontekst: ${contextHints}.` : ''} Naturlig tone, ikke salesy.`,
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
  const msg: any = null; // message id not needed after discordSend

  logPartnerPromoResult({
    partnerName: partner.navn,
    platform: 'discord',
    channel: kanal.name,
    affiliateUrlUsed: partner.finalUrl,
    hadAffiliateUrl: partner.affiliateUrl !== null,
    missingAffiliate: partner.missedAffiliate,
    copyText: tekst,
    discordMessageId: msg?.id,
  }).catch(() => {});

  addToMemory({ type: 'proaktiv', innhold: `partner: ${partner.navn}` });
}

async function sendStreamInfoMelding(kanal: TextChannel): Promise<void> {
  const plan = await getStreamplan();
  const aktive = plan.filter((d: any) => d.aktiv);
  if (aktive.length === 0) return;
  const DAGER = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const idag = new Date().getDay();
  const neste = aktive.find((d: any) => DAGER.indexOf(d.dag) >= idag) ?? aktive[0];
  const apiKey = process.env.OPENAI_API_KEY;
  const twitchUrl = await getTwitchUrl().catch(() => `https://twitch.tv/${process.env.TWITCH_USERNAME ?? 'glenvex'}`);
  let tekst = `📅 Neste stream: **${neste.dag}** kl. ${neste.tid} – **${neste.spill}**${neste.tittel ? ` – *${neste.tittel}*` : ''}\nFølg med på ${twitchUrl} 🔴`;
  if (apiKey) {
    const openai = new OpenAI({ apiKey });
    const res2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Skriv en kort og energisk norsk Discord-melding (maks 2 setninger) om at GLENVEX streamer ${neste.spill} ${neste.dag} kl. ${neste.tid}${neste.tittel ? ` med tittelen "${neste.tittel}"` : ''}. Ikke start med emoji.` }],
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
  const kanal = finnChatKanal();
  if (!kanal) return;

  const runde = proaktivRunde % 3;
  proaktivRunde++;

  try {
    if (runde === 0) {
      await sendPartnerPromoMelding(kanal);
    } else if (runde === 1) {
      await sendStreamInfoMelding(kanal);
    } else {
      const melding = getProaktivMelding();
      await discordSend(kanal, melding, { trigger: 'proaktiv_community' });
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

  const kanal = finnChatKanal();
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
        messages: [{ role: 'user', content: `Du er GLENVEX BOT. Skriv én kort, energisk norsk setning (maks 15 ord) som oppsummerer uken. Følgere: ${stats.followerCount}. Clips: ${stats.clipCount}.` }],
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
      .setTitle('📊 Ukentlig statistikk – GLENVEX')
      .setDescription(kommentar || 'Enda en uke i boken!')
      .addFields(
        { name: '👥 Følgere', value: stats.followerCount.toLocaleString(), inline: true },
        { name: '🎬 Clips', value: stats.clipCount.toString(), inline: true },
        { name: '🔴 Status', value: stream?.isLive ? 'LIVE NÅ' : 'Offline', inline: true },
        { name: '🚨 Topp 3 raids', value: raidTekst, inline: false },
        { name: '🎁 Topp gift-givers', value: giftSubTekst, inline: false },
        { name: '🏆 Topp clips', value: topClipsTekst, inline: false },
      )
      .setFooter({ text: `Uke ${uke} • GLENVEX Stream Control` })
      .setTimestamp();

    await discordSend(kanal, { embeds: [embed] }, { trigger: 'ukentlig_stats', uke });
    addLog('success', `Ukentlig stats postet (uke ${uke})`, 'OK');
  } catch (error) {
    addLog('error', `Stats feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Clip-deling ─────────────────────────────────────────────────────────────

async function postTopClip() {
  const kanal = finnChatKanal();
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
      .setFooter({ text: 'GLENVEX Stream Control • Auto Clip' })
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
  upsertBotMemory({ agent_type: 'discord', memory_type: 'member', key: member.user.id, summary: `${member.displayName} ble med i GLENVEX Discord`, confidence_score: 0.6, metadata: { username: member.user.username } }).catch(() => {});
  upsertMember(member.user.id, member.user.username, member.displayName);
  if (member.guild) {
    const { tildeltSpesialRolle } = await import('./lib/roleManager');
    tildeltSpesialRolle(member.guild, member, 'new_member').catch(() => {});
  }

  const kanal = finnChatKanal();
  if (!kanal) return;

  const apiKey = process.env.OPENAI_API_KEY;
  const twitchUrlVelkomst = await getTwitchUrl().catch(() => `https://twitch.tv/${process.env.TWITCH_USERNAME ?? 'glenvex'}`);
  let velkomst = `Hei **${member.displayName}**, velkommen til GLENVEX sitt community! Sjekk ${twitchUrlVelkomst} og slå på varslinger.`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Du er GLENVEX BOT. Skriv en kort, varm og energisk velkomstmelding på norsk. Nevn ${twitchUrlVelkomst}. Maks 2 setninger.` },
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
        messages: [{ role: 'user', content: `Skriv en kort, engasjerende norsk hilsen (1 setning) for en ny Discord-tråd ved navn: "${thread.name}". Gaming-vibe, GLENVEX community.` }],
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
  } catch {}
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
    if (syklus.pre_hype_sendt_at) return; // allerede sendt

    const plan = await getStreamplan();
    const aktive = plan.filter((d: any) => d.aktiv);
    if (aktive.length === 0) {
      return;
    }

    // Bruk Europe/Oslo-tid (Railway kjører UTC – uten dette er planleggeren 1-2 timer feil)
    const { day: idag, minutes: minutter, dagNavn } = getOsloTime();

    let planlagtStream: any = null;
    let diffTilStream = 9999;

    for (const dag of aktive) {
      const dagIdx = DAGNAVN_BOT.indexOf(dag.dag);
      if (dagIdx !== idag) continue;
      const [timer, min] = (dag.tid ?? '20:00').split(':').map(Number);
      const streamMin = timer * 60 + min;
      const diff = streamMin - minutter;
      if (diff > 0 && diff <= 60 && diff < diffTilStream) {
        diffTilStream = diff;
        planlagtStream = dag;
      }
    }

    if (!planlagtStream) return;

    logSystemEvent({
      source: 'scheduler',
      event_type: 'PREHYPE_SCHEDULED',
      title: `Pre-hype: stream om ${diffTilStream} min (${planlagtStream.spill})`,
      description: `Oslo-tid dag=${dagNavn} minutter=${minutter}. Stream kl. ${planlagtStream.tid}.`,
      severity: 'info',
      metadata: { spill: planlagtStream.spill, dag: planlagtStream.dag, tid: planlagtStream.tid, diffMinutter: diffTilStream, osloDag: dagNavn, osloMinutter: minutter },
    });

    const kanal = finnChatKanal();
    if (!kanal) {
      logSystemEvent({ source: 'scheduler', event_type: 'PREHYPE_SCHEDULED', title: 'Pre-hype: Discord-kanal ikke funnet', severity: 'warning', metadata: { spill: planlagtStream.spill } });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    let melding = `🔥 **GLENVEX** streamer om ${diffTilStream} minutt${diffTilStream > 1 ? 'er' : ''}! ${planlagtStream.spill} starter kl. ${planlagtStream.tid}`;
    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const res2 = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: `GLENVEX streamer ${planlagtStream.spill} om ${diffTilStream} minutter. Lag en kort, energisk norsk hype-melding (maks 2 setninger, community-fokusert). Ingen emojis i starten.` }],
          max_tokens: 80,
          temperature: 0.9,
        });
        const ai = res2.choices[0]?.message?.content ?? '';
        if (ai) melding = `🔥 ${ai}`;
      } catch {}
    }

    const sendtOk = await discordSend(kanal, melding, { trigger: 'pre_hype', spill: planlagtStream.spill, minutter: diffTilStream }).then(() => true).catch(() => false);
    await updateStreamSyklus({ pre_hype_sendt_at: new Date().toISOString() });
    logBotEvent('pre_hype', { spill: planlagtStream.spill, tittel: planlagtStream.tittel ?? '', minutter_til: diffTilStream });

    logSystemEvent({
      source: 'scheduler',
      event_type: 'PREHYPE_SENT',
      title: `Pre-hype sendt: ${planlagtStream.spill} om ${diffTilStream} min`,
      severity: sendtOk ? 'info' : 'warning',
      metadata: { spill: planlagtStream.spill, kanal: kanal.id, sendtOk, diffMinutter: diffTilStream },
    });

    addLog(sendtOk ? 'success' : 'warning', `Pre-hype ${sendtOk ? 'sendt' : 'feilet'}: ${planlagtStream.spill} om ${diffTilStream}min`, sendtOk ? 'OK' : 'WARN');
  } catch (err: any) {
    console.error('[PreHype] Feil:', err.message);
    logSystemEvent({ source: 'scheduler', event_type: 'PREHYPE_SCHEDULED', title: `Pre-hype feil: ${err.message.slice(0, 100)}`, severity: 'error' });
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

client.once('clientReady', () => {
  startTwitchBot();
  startClipWorker().catch(console.error);
  startThumbnailWorker().catch(console.error);
  startDataApi(Number(process.env.PORT) || 4242);
  startLearningAggregator();
  startRecoveryEngine();
  startSystemEventsFlusher();
  startWorkspaceManager();
  // Discord historikk bootstrap: kjøres én gang per kanal, 5 min etter oppstart
  setTimeout(() => startDiscordHistoryBootstrap(client).catch(() => {}), 5 * 60_000);
  logSystemEvent({ source: 'discord_bot', event_type: 'BOT_STARTED', title: 'GLENVEX Bot startet', severity: 'info' });
  resetAnalyzerendeVods('Railway restartet – klikk Retry for å kjøre på nytt').catch(() => {});
  lasterMedlemmerFraSupabase().catch(() => {});
  console.log(`\n✓ GLENVEX Bot pålogget som: ${client.user?.tag}`);
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

  setTimeout(() => { checkLive(); setInterval(checkLive, POLL_INTERVAL); }, 5_000);
  setInterval(sjekkPreHype, 10 * 60 * 1000); // Sjekk pre-hype hvert 10. min
  setTimeout(() => { sendProaktivMelding(); setInterval(sendProaktivMelding, PROAKTIV_INTERVAL); }, 30 * 60 * 1000);
  setTimeout(() => { postTopClip(); setInterval(postTopClip, CLIP_INTERVAL); }, 60 * 60 * 1000);
  setTimeout(() => { delSocialsSubtilt(); setInterval(delSocialsSubtilt, SOCIALS_INTERVAL); }, 3 * 60 * 60 * 1000);
  setTimeout(() => { sjekkGoals(); setInterval(sjekkGoals, GOALS_INTERVAL); }, 2 * 60 * 60 * 1000);
  setInterval(sjekkUkentligStats, STATS_SJEKK_INTERVAL);
  setInterval(autoRyddKanaler, RYDD_SJEKK_INTERVAL);
  setInterval(() => sjekkStuckeVodsPeriodisk().catch(() => {}), 30 * 60 * 1000); // Stuck-sjekk hvert 30. min
  setInterval(autoPostStreamplan, STATS_SJEKK_INTERVAL);
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
    const xpResult = addMessageXP(message.author.id, message.author.username, message.author.displayName ?? message.author.username);
    // Track stream attendance (once per stream day when bot knows stream is live)
    if (getActiveSession()) {
      addStreamAttendance(message.author.id, message.author.username, message.author.displayName ?? message.author.username);
    }
    if (xpResult?.leveledUp) {
      message.channel.send(`🎉 **${message.author.displayName ?? message.author.username}** nådde **Level ${xpResult.newLevel}**! PogChamp`).catch(() => {});
      logBotEvent('level_up', { username: message.author.displayName ?? message.author.username, level: xpResult.newLevel });

      // Tildel rolle basert på nytt level
      if (message.guild && message.member) {
        tildeltRolle(message.guild, message.member, xpResult.newLevel).then(rolleNavn => {
          if (rolleNavn) {
            message.channel.send(`🏅 **${message.author.displayName ?? message.author.username}** fikk rollen **@${rolleNavn}**! 👑`).catch(() => {});
          }
        }).catch(() => {});
      }
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
        .setFooter({ text: 'GLENVEX Bot • AI-generert bilde' });

      await message.reply({ content: svar.tekst ?? undefined, embeds: [embed] });
    } else if (svar.tekst) {
      await message.reply(svar.tekst);
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
