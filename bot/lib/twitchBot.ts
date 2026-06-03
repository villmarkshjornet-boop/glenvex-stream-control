import * as tmi from 'tmi.js';
import OpenAI from 'openai';
import { trackRaid, trackGiftSub } from './eventTracker';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_URL = process.env.DISCORD_INVITE_URL || 'https://discord.gg/glenvex';
const KANAL = process.env.TWITCH_USERNAME?.toLowerCase() || 'glenvex';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;
const SVAR_SJANSE = 0.35;

const DISCORD_MELDINGER = [
  `Bli med i GLENVEX sitt Discord! Snakk med community, se klipp og få live-varsling: ${DISCORD_URL} GlitchCat`,
  `Har du ikke jotnet Discord ennå? Kom innom: ${DISCORD_URL} PogChamp`,
  `Discord-chatten er varm nå! Bli med: ${DISCORD_URL} 👾`,
  `For drops, klipp og kaos utenom stream – Discord er stedet: ${DISCORD_URL} Kappa`,
  `Stream-varslinger og community på Discord: ${DISCORD_URL} FeelsGoodMan`,
];

const SYSTEM_PROMPT = `Du er GLENVEX BOT i Twitch-chat.
Regler:
- VELDIG korte svar – maks 1 setning, helst under 10 ord
- Norsk med litt gaming-slang
- Bruk Twitch-emotes naturlig: Kappa PogChamp LUL FeelsGoodMan GlitchCat Pog
- Svar kun hvis det er relevant og morsomt
- Promoter discord.gg/glenvex naturlig innimellom`;

let client: tmi.Client | null = null;
let sisteDiscordMelding = 0;
const DISCORD_INTERVAL_MS = 25 * 60 * 1000;

async function postTilDiscord(channelId: string, payload: object) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return;
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {}
}

function liveKanalId(): string {
  return process.env.DISCORD_LIVE_CHANNEL_ID || '';
}

function chatKanalId(): string {
  return process.env.DISCORD_CHAT_CHANNEL_ID || '';
}

async function aiSvar(kontekst: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: kontekst },
      ],
      max_tokens: 60,
      temperature: 0.9,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}

export function startTwitchBot() {
  const oauth = process.env.TWITCH_BOT_OAUTH;
  const botNavn = process.env.TWITCH_BOT_USERNAME || KANAL;

  if (!oauth) {
    console.log('  ⚠ TWITCH_BOT_OAUTH mangler – Twitch chat-bot ikke startet');
    return;
  }

  client = new tmi.Client({
    options: { debug: false },
    identity: { username: botNavn, password: oauth },
    channels: [KANAL],
  });

  client.connect().then(() => {
    console.log(`  ✓ Twitch chat-bot koblet til #${KANAL}`);
  }).catch((err: Error) => {
    console.error('  ✗ Twitch chat feil:', err.message);
  });

  // ─── RAID ──────────────────────────────────────────────────────────────────

  client.on('raided', async (channel, username, viewers) => {
    trackRaid(username, viewers);

    const twitchSvar = await aiSvar(`${username} raidet med ${viewers} seere. Lag en energisk takkemelding på norsk, nevn raid-størrelsen. Maks 1 setning.`);
    const melding = twitchSvar || `RAID! Velkommen ${username} og alle ${viewers} raiders! PogChamp Dere er sjuke for å komme innom! Sjekk Discord: ${DISCORD_URL}`;

    client?.say(channel, melding).catch(() => {});

    // Post i Discord
    await postTilDiscord(liveKanalId(), {
      embeds: [{
        title: `🚨 RAID – ${username}`,
        description: `**${username}** raidet med **${viewers} seere!**\n\nGi dem en varm velkomst! PogChamp`,
        color: 0x9146ff,
        fields: [
          { name: '👥 Raid-størrelse', value: viewers.toString(), inline: true },
          { name: '🎮 Raider', value: `[twitch.tv/${username}](https://twitch.tv/${username})`, inline: true },
        ],
        footer: { text: 'GLENVEX Stream Control • Raid' },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── SUBSCRIPTION ──────────────────────────────────────────────────────────

  client.on('subscription', async (channel, username, _method, _message, _userstate) => {
    const svar = await aiSvar(`${username} har nettopp subscripet! Lag en kort, entusiastisk takkemelding på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} TAKK for sub! Du er legen! FeelsGoodMan`).catch(() => {});

    await postTilDiscord(chatKanalId(), {
      content: `🌟 **${username}** er nå subscriber! Takk for støtten! FeelsGoodMan`,
    });
  });

  // ─── RESUB ─────────────────────────────────────────────────────────────────

  client.on('resub', async (channel, username, months, _message, _userstate, methods) => {
    const svar = await aiSvar(`${username} har hatt sub i ${months} måneder! Takk dem på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} ${months} måneder! Legendarisk lojalitet! PogChamp`).catch(() => {});
  });

  // ─── GIFT SUB ──────────────────────────────────────────────────────────────

  client.on('subgift', async (channel, username, _streakMonths, recipient, _methods, _userstate) => {
    trackGiftSub(username, 1);
    const svar = await aiSvar(`${username} giftet sub til ${recipient}! Takk på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} gifter sub til @${recipient}! Sjenerøst! PogChamp`).catch(() => {});
  });

  client.on('submysterygift', async (channel, username, numbOfSubs, _methods, _userstate) => {
    trackGiftSub(username, numbOfSubs);

    const svar = await aiSvar(`${username} giftet ${numbOfSubs} subs til random seere! Lag en episk takkemelding på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} gifter ${numbOfSubs} subs! HVEM ER DETTE MENNESKET?! PogChamp`).catch(() => {});

    await postTilDiscord(chatKanalId(), {
      embeds: [{
        title: `🎁 MASSE GIFT SUBS – ${username}`,
        description: `**${username}** giftet **${numbOfSubs} subs** til chatten! Dette er sjenerøsitet på et annet nivå! 👑`,
        color: 0xffd700,
        footer: { text: 'GLENVEX Stream Control • Gift Sub' },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── CHEER (bits) ──────────────────────────────────────────────────────────

  client.on('cheer', async (channel, userstate, message) => {
    const bits = userstate.bits ?? '?';
    const username = userstate.username ?? 'Noen';
    const svar = await aiSvar(`${username} cheeret ${bits} bits! Takk på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} ${bits} bits!! Du er gal! PogChamp`).catch(() => {});
  });

  // ─── Meldinger ─────────────────────────────────────────────────────────────

  client.on('message', async (channel, tags, message, self) => {
    if (self) return;
    if (!tags.username) return;

    const brukernavn = tags.username.toLowerCase();
    const tekst = message.trim();

    if (tekst.startsWith('!') || tekst.startsWith('/')) return;
    if (brukernavn.includes('nightbot') || brukernavn.includes('streamlabs') || brukernavn.includes('streamelements')) return;

    const sist = cooldowns.get(brukernavn);
    if (sist && Date.now() - sist < COOLDOWN_MS) return;

    const tekLower = tekst.toLowerCase();
    const spørOmDiscord = tekLower.includes('discord') || tekLower.includes('server');

    if (spørOmDiscord) {
      cooldowns.set(brukernavn, Date.now());
      client?.say(channel, `@${tags.username} Discord er her: ${DISCORD_URL} PogChamp`).catch(() => {});
      return;
    }

    const botNamnLower = botNavn.toLowerCase();
    const erTagget = tekLower.includes(botNamnLower) || tekLower.includes('@glenvex');
    if (!erTagget && Math.random() > SVAR_SJANSE) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    cooldowns.set(brukernavn, Date.now());

    const svar = await aiSvar(`${tags.username}: ${tekst}`);
    if (svar) client?.say(channel, `@${tags.username} ${svar}`).catch(() => {});
  });

  // ─── Periodic Discord-promo ────────────────────────────────────────────────

  setInterval(() => {
    if (Date.now() - sisteDiscordMelding < DISCORD_INTERVAL_MS) return;
    sisteDiscordMelding = Date.now();
    const melding = DISCORD_MELDINGER[Math.floor(Math.random() * DISCORD_MELDINGER.length)];
    client?.say(`#${KANAL}`, melding).catch(() => {});
  }, 5 * 60 * 1000);
}

export function stopTwitchBot() {
  client?.disconnect();
  client = null;
}
