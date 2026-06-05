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
import { startTwitchBot } from './lib/twitchBot';
import { startClipWorker } from './lib/clipWorker';
import { byggSocialsEmbed } from './commands/socials';
import { topRaids, topGiftSubs } from './lib/eventTracker';
import { tweetLiveNå } from './lib/twitter';
import { innsendCommand } from './commands/innsend';
import { addMessageXP, upsertMember, setLastWelcomed, getMember, getAllMembers, lasterMedlemmerFraSupabase } from './lib/memberTracker';
import { logBotEvent, updateStreamSyklus, resetStreamSyklus, getStreamSyklus, getStreamplan } from './lib/botEvents';
import { startSession, endSession, updateSession, incrementChatMessages, addRaidToSession, addSubToSession, getActiveSession } from './lib/streamHistory';
import { tildeltRolle } from './lib/roleManager';
import { startDataApi } from './lib/dataApi';
import { addToMemory, getBotSettings, getPersonalityPrompt } from '@/lib/botMemory';
import { addContent } from '@/lib/contentLibrary';
import OpenAI from 'openai';

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
      const botSettings = getBotSettings();
      if (botSettings.pauseLiveVarsler) return;

      await postLiveEmbed(stream, settings);
      saveSettings({ lastNotifiedStreamId: stream.id });
      addLog('success', `Auto live-varsel postet: ${stream.title}`, 'OK');
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
    if (melding) await kanal.send(`🔴 **GLENVEX ER LIVE!** ${melding}`);
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
  const botSettings = getBotSettings();
  if (!botSettings.aktiv || botSettings.pauseDiscord) return;
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

  await kanal.send({ embeds: [embed] }).catch(() => {});
  addToMemory({ type: 'socials', innhold: 'delt sosiale lenker' });
}

async function sendProaktivMelding() {
  const botSettings = getBotSettings();
  if (!botSettings.aktiv || botSettings.pauseDiscord) return;
  const kanal = finnChatKanal();
  if (!kanal) return;
  const melding = getProaktivMelding();
  try {
    await kanal.send(melding);
    addToMemory({ type: 'proaktiv', innhold: melding });
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

    await kanal.send({ embeds: [embed] });
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

    await kanal.send({ content: '🔥 Har dere sett denne clipsen?', embeds: [embed] });
    addLog('success', `Clip postet: ${nyClip.title}`, 'OK');
  } catch (error) {
    addLog('error', `Clip-post feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Velkomstmelding ─────────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  const kanal = finnChatKanal();
  if (!kanal) return;

  const apiKey = process.env.OPENAI_API_KEY;
  let velkomst = `Hei **${member.displayName}**, velkommen til GLENVEX sitt community! Sjekk twitch.tv/glenvex og slå på varslinger.`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Du er GLENVEX BOT. Skriv en kort, varm og energisk velkomstmelding på norsk. Nevn twitch.tv/glenvex. Maks 2 setninger.' },
          { role: 'user', content: `Nytt medlem: ${member.displayName}` },
        ],
        max_tokens: 100,
        temperature: 0.9,
      });
      velkomst = res.choices[0]?.message?.content ?? velkomst;
    } catch {}
  }

  try { await kanal.send(velkomst); } catch {}
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
const PROAKTIV_INTERVAL    = 4  * 60 * 60 * 1000;
const CLIP_INTERVAL        = 12 * 60 * 60 * 1000;
const STATS_SJEKK_INTERVAL = 6  * 60 * 60 * 1000;
const RYDD_SJEKK_INTERVAL  = 6  * 60 * 60 * 1000;
const SOCIALS_INTERVAL     = 8  * 60 * 60 * 1000; // Hver 8. time
const GOALS_INTERVAL       = 6  * 60 * 60 * 1000; // Hver 6. time

async function gjenopprettStuckeVods() {
  // Reset ANALYZING-VODs som er eldre enn 30 min til PENDING etter Railway-restart
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return;
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const res = await fetch(`${sbUrl}/rest/v1/content_vods?status=eq.ANALYZING&updated_at=lt.${cutoff}&select=id,title`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    });
    if (!res.ok) return;
    const stucke = await res.json() as any[];
    for (const vod of stucke) {
      await fetch(`${sbUrl}/rest/v1/content_vods?id=eq.${vod.id}`, {
        method: 'PATCH',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'PENDING', error_message: 'Railway restartet – klikk Retry for å kjøre på nytt', progress_percent: 0 }),
      });
      addLog('warning', `Satte stuck VOD til PENDING etter restart: ${vod.title ?? vod.id}`, 'RECOVERY');
    }
    if (stucke.length > 0) console.log(`[Recovery] Satte ${stucke.length} stuck VOD(er) til PENDING`);
  } catch {}
}

const DAGNAVN_BOT = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

async function sjekkPreHype() {
  try {
    const syklus = await getStreamSyklus();
    if (syklus.pre_hype_sendt_at) return; // allerede sendt
    const plan = await getStreamplan();
    const aktive = plan.filter((d: any) => d.aktiv);
    if (aktive.length === 0) return;

    const now = new Date();
    const idag = now.getDay();
    const minutter = now.getHours() * 60 + now.getMinutes();

    for (const dag of aktive) {
      const dagIdx = DAGNAVN_BOT.indexOf(dag.dag);
      if (dagIdx !== idag) continue;
      const [timer, min] = (dag.tid ?? '20:00').split(':').map(Number);
      const streamMin = timer * 60 + min;
      const diff = streamMin - minutter;
      if (diff > 0 && diff <= 60) {
        // Stream innen 60 min – send pre-hype
        const kanal = finnChatKanal();
        if (!kanal) return;
        const apiKey = process.env.OPENAI_API_KEY;
        let melding = `🔥 **GLENVEX** streamer om ${diff} minutt${diff > 1 ? 'er' : ''}! ${dag.spill} starter kl. ${dag.tid}`;
        if (apiKey) {
          try {
            const openai = new OpenAI({ apiKey });
            const res2 = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: `GLENVEX streamer ${dag.spill} om ${diff} minutter. Lag en kort, energisk norsk hype-melding (maks 2 setninger, community-fokusert). Ingen emojis i starten.` }],
              max_tokens: 80,
              temperature: 0.9,
            });
            const ai = res2.choices[0]?.message?.content ?? '';
            if (ai) melding = `🔥 ${ai}`;
          } catch {}
        }
        await kanal.send(melding).catch(() => {});
        await updateStreamSyklus({ pre_hype_sendt_at: new Date().toISOString() });
        logBotEvent('pre_hype', { spill: dag.spill, tittel: dag.tittel ?? '', minutter_til: diff });
        addLog('success', `Pre-hype sendt: ${dag.spill} om ${diff}min`, 'OK');
        break;
      }
    }
  } catch (err: any) {
    console.error('[PreHype] Feil:', err.message);
  }
}

client.once('clientReady', () => {
  startTwitchBot();
  startClipWorker().catch(console.error);
  startDataApi(Number(process.env.PORT) || 4242);
  gjenopprettStuckeVods().catch(() => {});
  lasterMedlemmerFraSupabase().catch(() => {}); // Gjenopprett membres fra Supabase ved Railway-restart
  console.log(`\n✓ GLENVEX Bot pålogget som: ${client.user?.tag}`);
  console.log(`  Guilds: ${client.guilds.cache.size}`);
  console.log(`  Kommandoer: ${commands.size}`);
  console.log('\n  System aktivert. Kaoset starter nå.\n');
  addLog('success', `Discord bot startet: ${client.user?.tag}`, 'OK');

  setTimeout(() => { checkLive(); setInterval(checkLive, POLL_INTERVAL); }, 5_000);
  setInterval(sjekkPreHype, 10 * 60 * 1000); // Sjekk pre-hype hvert 10. min
  setTimeout(() => { sendProaktivMelding(); setInterval(sendProaktivMelding, PROAKTIV_INTERVAL); }, 30 * 60 * 1000);
  setTimeout(() => { postTopClip(); setInterval(postTopClip, CLIP_INTERVAL); }, 60 * 60 * 1000);
  setTimeout(() => { delSocialsSubtilt(); setInterval(delSocialsSubtilt, SOCIALS_INTERVAL); }, 3 * 60 * 60 * 1000);
  setTimeout(() => { sjekkGoals(); setInterval(sjekkGoals, GOALS_INTERVAL); }, 2 * 60 * 60 * 1000);
  setInterval(sjekkUkentligStats, STATS_SJEKK_INTERVAL);
  setInterval(autoRyddKanaler, RYDD_SJEKK_INTERVAL);
  setInterval(autoPostStreamplan, STATS_SJEKK_INTERVAL);
});

// ─── Meldingslytter ───────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;

  // XP for alle meldinger i guild
  if (message.guild) {
    upsertMember(message.author.id, message.author.username, message.author.displayName ?? message.author.username);
    incrementChatMessages();
    const xpResult = addMessageXP(message.author.id, message.author.username, message.author.displayName ?? message.author.username);
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
  if (isOnCooldown(message.author.id)) return;

  const tekst = message.content.replace(/<@!?[\d]+>/g, '').trim();
  if (!tekst) return;

  setCooldown(message.author.id);

  const botSettings = getBotSettings();
  if (!botSettings.aktiv || botSettings.pauseDiscord) return;

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

client.login(token);
