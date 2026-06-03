import * as tmi from 'tmi.js';
import OpenAI from 'openai';

const DISCORD_URL = process.env.DISCORD_INVITE_URL || 'https://discord.gg/glenvex';
const KANAL = process.env.TWITCH_USERNAME?.toLowerCase() || 'glenvex';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;
const SVAR_SJANSE = 0.35; // 35% sjanse for å svare på en tilfeldig melding

const DISCORD_MELDINGER = [
  `Bli med i GLENVEX sitt Discord-community! Snakk med andre fans, se klipp og få varsling når stream starter: ${DISCORD_URL} GlitchCat`,
  `Visste du at vi har et aktivt Discord? Drops, klipp og community – alt er der! ${DISCORD_URL} PogChamp`,
  `Discord-chatten er varm nå! Kom innom og bli kjent med resten av community: ${DISCORD_URL} 👾`,
  `Stream-varslinger, klipp og kaos – alt skjer på Discord: ${DISCORD_URL} Kappa`,
  `For de som vil henge med GLENVEX utenom stream – Discord er stedet: ${DISCORD_URL} FeelsGoodMan`,
];

const SYSTEM_PROMPT = `Du er GLENVEX BOT i Twitch-chat.
Regler:
- VELDIG korte svar – maks 1 setning, helst under 10 ord
- Norsk med litt gaming-slang
- Bruk Twitch-emotes naturlig: Kappa PogChamp LUL FeelsGoodMan GlitchCat Pog
- Svar kun hvis det er relevant og morsomt
- Ikke svar på spam eller kommandoer fra andre bots
- Promoter discord.gg/glenvex og klipp naturlig innimellom`;

let client: tmi.Client | null = null;
let sisteDiscordMelding = 0;
const DISCORD_INTERVAL_MS = 25 * 60 * 1000; // hver 25. min

export function startTwitchBot() {
  const oauth = process.env.TWITCH_BOT_OAUTH;
  const botNavn = process.env.TWITCH_BOT_USERNAME || KANAL;

  if (!oauth) {
    console.log('  ⚠ TWITCH_BOT_OAUTH mangler – Twitch chat-bot ikke startet');
    return;
  }

  client = new tmi.Client({
    options: { debug: false },
    identity: {
      username: botNavn,
      password: oauth,
    },
    channels: [KANAL],
  });

  client.connect().then(() => {
    console.log(`  ✓ Twitch chat-bot koblet til #${KANAL}`);
  }).catch((err: Error) => {
    console.error('  ✗ Twitch chat feil:', err.message);
  });

  client.on('message', async (channel, tags, message, self) => {
    if (self) return;
    if (!tags.username) return;

    const brukernavn = tags.username.toLowerCase();
    const tekst = message.trim();

    // Ikke svar på andre bots eller kommandoer
    if (tekst.startsWith('!') || tekst.startsWith('/')) return;
    if (brukernavn.includes('bot') || brukernavn.includes('nightbot') || brukernavn.includes('streamlabs')) return;

    // Cooldown per bruker
    const sist = cooldowns.get(brukernavn);
    if (sist && Date.now() - sist < COOLDOWN_MS) return;

    // Sjekk om noen nevner Discord eller spør om det
    const tekLower = tekst.toLowerCase();
    const spørOmDiscord = tekLower.includes('discord') || tekLower.includes('server') || tekLower.includes('community');

    if (spørOmDiscord) {
      cooldowns.set(brukernavn, Date.now());
      client?.say(channel, `@${tags.username} Discord er her: ${DISCORD_URL} PogChamp`);
      return;
    }

    // Svar på direkte omtale av boten
    const botNamnLower = (process.env.TWITCH_BOT_USERNAME || 'glenvexbot').toLowerCase();
    const erTagget = tekLower.includes(botNamnLower) || tekLower.includes('@glenvex');

    if (!erTagget && Math.random() > SVAR_SJANSE) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    cooldowns.set(brukernavn, Date.now());

    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${tags.username}: ${tekst}` },
        ],
        max_tokens: 60,
        temperature: 0.9,
      });

      const svar = res.choices[0]?.message?.content?.trim();
      if (svar) {
        client?.say(channel, `@${tags.username} ${svar}`);
      }
    } catch {}
  });

  // Periodic Discord-promotering
  setInterval(async () => {
    if (Date.now() - sisteDiscordMelding < DISCORD_INTERVAL_MS) return;
    sisteDiscordMelding = Date.now();

    const melding = DISCORD_MELDINGER[Math.floor(Math.random() * DISCORD_MELDINGER.length)];
    client?.say(`#${KANAL}`, melding).catch(() => {});
  }, 5 * 60 * 1000); // Sjekk hvert 5. min
}

export function stopTwitchBot() {
  client?.disconnect();
  client = null;
}
