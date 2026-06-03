import { Client, GatewayIntentBits, Collection, Interaction, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
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
import { generateChatReply, getProaktivMelding, isOnCooldown, setCooldown } from './lib/aiPersonality';
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
  ],
});

const commands = new Collection<string, { data: any; execute: (interaction: any) => Promise<any> }>();
for (const cmd of [liveCommand, twitchCommand, promoCommand, setupCommand, statusCommand, socialsCommand, clipCommand, kanalerCommand]) {
  commands.set(cmd.data.name, cmd);
}

// Holder styr på hvilke clips som er postet og hvilken uke stats er postet
const postedeClips = new Set<string>();
let sisteStatsukeNr = -1;

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

// ─── Live-sjekk ─────────────────────────────────────────────────────────────

async function checkLive() {
  try {
    const settings = getSettings();
    if (!settings.autoPostLive) return;
    const stream = await getStreamInfo();
    if (stream.isLive && stream.id && stream.id !== settings.lastNotifiedStreamId) {
      await postLiveEmbed(stream, settings);
      saveSettings({ lastNotifiedStreamId: stream.id });
      addLog('success', `Auto live-varsel postet: ${stream.title}`, 'OK');
      console.log(`  ✓ Live-varsel postet: ${stream.title}`);
    } else if (!stream.isLive && settings.lastNotifiedStreamId) {
      saveSettings({ lastNotifiedStreamId: null });
    }
  } catch (error) {
    addLog('error', `Live-sjekk feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Proaktive meldinger ─────────────────────────────────────────────────────

async function sendProaktivMelding() {
  const kanal = finnChatKanal();
  if (!kanal) return;
  try {
    await kanal.send(getProaktivMelding());
  } catch {}
}

// ─── Automatisk clip-deling ──────────────────────────────────────────────────

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
      .setDescription(`En av ukens beste clips fra GLENVEX sin stream!\n\n👀 **${nyClip.viewCount}** visninger • ⏱️ ${Math.round(nyClip.duration)}s\n\n[Se clipsen her](${nyClip.url})`)
      .setImage(nyClip.thumbnailUrl)
      .setFooter({ text: 'GLENVEX Stream Control • Auto Clip' })
      .setTimestamp();

    await kanal.send({
      content: '🔥 Har dere sett denne clipsen? Ta den videre hvis dere synes den er bra!',
      embeds: [embed],
    });

    addLog('success', `Clip postet: ${nyClip.title}`, 'OK');
  } catch (error) {
    addLog('error', `Clip-post feil: ${(error as Error).message}`, 'ERROR');
  }
}

// ─── Ukentlig statistikk ─────────────────────────────────────────────────────

async function sjekkUkentligStats() {
  const now = new Date();
  if (now.getDay() !== 0) return; // Kun søndag
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
        messages: [{
          role: 'user',
          content: `Du er GLENVEX BOT. Skriv én kort, energisk norsk setning (maks 15 ord) som oppsummerer denne uken for GLENVEX-communityet. Følgere: ${stats.followerCount}. Clips: ${stats.clipCount}. Vær hype og motiverende.`,
        }],
        max_tokens: 60,
        temperature: 0.9,
      });
      kommentar = res.choices[0]?.message?.content ?? '';
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('📊 Ukentlig statistikk – GLENVEX')
      .setDescription(kommentar || 'Enda en uke i boken – takk for støtten!')
      .addFields(
        { name: '👥 Følgere', value: stats.followerCount.toLocaleString(), inline: true },
        { name: '🎬 Clips denne uken', value: stats.clipCount.toString(), inline: true },
        { name: '🔴 Status', value: stream?.isLive ? 'LIVE NÅ' : 'Offline', inline: true },
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

// ─── Velkomstmelding ─────────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  const kanal = finnChatKanal();
  if (!kanal) return;

  const apiKey = process.env.OPENAI_API_KEY;
  let velkomst = `Yo **${member.displayName}**, velkommen til GLENVEX sitt community! 🎮 Sjekk ut twitch.tv/glenvex og slå på varslinger – du vil ikke gå glipp av dette. Sig gjerne hei i chatten! 👋`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'Du er GLENVEX BOT. Skriv en kort, varm og energisk velkomstmelding på norsk til et nytt Discord-medlem. Nevn at de bør følge twitch.tv/glenvex. Maks 2 setninger. Bruk brukernavnet.',
        }, {
          role: 'user',
          content: `Nytt medlem: ${member.displayName}`,
        }],
        max_tokens: 100,
        temperature: 0.9,
      });
      velkomst = res.choices[0]?.message?.content ?? velkomst;
    } catch {}
  }

  try {
    await kanal.send(velkomst);
  } catch {}
});

// ─── Schedulers ──────────────────────────────────────────────────────────────

const POLL_INTERVAL       = 2  * 60 * 1000;
const PROAKTIV_INTERVAL   = 4  * 60 * 60 * 1000;
const CLIP_INTERVAL       = 12 * 60 * 60 * 1000;
const STATS_SJEKK_INTERVAL = 6 * 60 * 60 * 1000;

client.once('clientReady', () => {
  console.log(`\n✓ GLENVEX Bot pålogget som: ${client.user?.tag}`);
  console.log(`  Guilds: ${client.guilds.cache.size}`);
  console.log(`  Kommandoer: ${commands.size}`);
  console.log('\n  System aktivert. Kaoset starter nå.\n');
  addLog('success', `Discord bot startet: ${client.user?.tag}`, 'OK');

  setTimeout(() => { checkLive(); setInterval(checkLive, POLL_INTERVAL); }, 5_000);
  setTimeout(() => { sendProaktivMelding(); setInterval(sendProaktivMelding, PROAKTIV_INTERVAL); }, 30 * 60 * 1000);
  setTimeout(() => { postTopClip(); setInterval(postTopClip, CLIP_INTERVAL); }, 60 * 60 * 1000);
  setInterval(sjekkUkentligStats, STATS_SJEKK_INTERVAL);
});

// ─── Meldingslytter (AI chat) ─────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;

  const erTagget = message.mentions.has(client.user);
  const erIChatKanal = process.env.DISCORD_CHAT_CHANNEL_ID
    ? message.channelId === process.env.DISCORD_CHAT_CHANNEL_ID
    : false;

  if (!erTagget && !erIChatKanal) return;
  if (isOnCooldown(message.author.id)) return;

  const tekst = message.content.replace(/<@!?[\d]+>/g, '').trim();
  if (!tekst) return;

  setCooldown(message.author.id);

  try {
    await message.channel.sendTyping();
    const svar = await generateChatReply(message.channelId, message.author.username, tekst);
    if (svar) await message.reply(svar);
  } catch (error) {
    addLog('error', `AI chat feil: ${(error as Error).message}`, 'ERROR');
  }
});

// ─── Interaksjoner ────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('slett_kanal_')) {
      await handleSlettKanalKnapp(interaction).catch(console.error);
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
