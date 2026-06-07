import * as tmi from 'tmi.js';
import OpenAI from 'openai';
import { trackRaid, trackGiftSub } from './eventTracker';
import { getSettings } from '@/lib/settings';
import { getBroadcasterId } from '@/lib/twitch';
import { logBotAgentEvent, upsertBotMemory, logChatMessage } from './agentLogger';
import { getRandomActivePartner, logPartnerPromoResult } from './partnerHelper';
import { getRecentCrossPlatformContext, summarizeRecentActivity, isCommandCooldown, setCommandCooldown } from './crossPlatformContext';
import { logSystemEvent } from './systemEvents';
import { getSubsKanalId, getClipsKanalId as getBotClipsKanalId, getChatKanalId as getBotChatKanalId, getLiveKanalId as getBotLiveKanalId, getRaidKanalId as getBotRaidKanalId } from './botKanalPreferanser';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_URL = process.env.DISCORD_INVITE_URL || 'https://discord.gg/glenvex';
const KANAL = process.env.TWITCH_USERNAME?.toLowerCase() || 'glenvex';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;
const SVAR_SJANSE = 0.35;

// Callback som index.ts setter for å tildele Discord Twitch-Sub-rolle
let _onSubCallback: ((username: string) => Promise<void>) | null = null;
export function setOnSubCallback(cb: (username: string) => Promise<void>): void {
  _onSubCallback = cb;
}

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

// Cache for Discord-kontekst (oppdateres hvert 5. min, ikke per melding)
let _discordCtxCache = '';
let _discordCtxLastFetch = 0;
const DISCORD_CTX_CACHE_MS = 5 * 60_000;

async function hentDiscordKontekst(): Promise<string> {
  if (Date.now() - _discordCtxLastFetch < DISCORD_CTX_CACHE_MS && _discordCtxCache) return _discordCtxCache;
  _discordCtxCache = await getRecentCrossPlatformContext({ includeDiscord: true, includeTwitch: false, minutesBack: 60, maxMessages: 20 });
  _discordCtxLastFetch = Date.now();
  return _discordCtxCache;
}

async function aiSvar(kontekst: string, discordCtx?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';
  try {
    const openai = new OpenAI({ apiKey });
    let systemPrompt = SYSTEM_PROMPT;
    if (discordCtx) {
      systemPrompt += `\n\nFersk Discord-aktivitet (bruk til å svare på Discord-spørsmål):\n${discordCtx}`;
      logBotAgentEvent({ source: 'twitch', event_type: 'cross_platform_context_used', metadata: { type: 'TWITCH_BOT_USED_DISCORD_CONTEXT' } });
    }
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
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

// ─── Følger-detektor ──────────────────────────────────────────────────────────

let forrigeFollowerAntall = -1;
let followAppToken: string | null = null;
let followAppTokenExpiry = 0;

async function getAppToken(): Promise<string | null> {
  if (followAppToken && Date.now() < followAppTokenExpiry) return followAppToken;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(5000) }
    );
    const d = await res.json() as any;
    followAppToken = d.access_token ?? null;
    followAppTokenExpiry = Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000;
    return followAppToken;
  } catch { return null; }
}

async function sjekkNyeFollowers() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return;

  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return;

    // Prøv med bruker-token (gir tilgang til enkeltfølgere), ellers app token
    const userOauth = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
    const token = userOauth || await getAppToken();
    if (!token) return;

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=10`,
      {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      }
    ).catch(() => null);

    if (!res?.ok) return;
    const data = await res.json() as any;
    const nyAntall: number = data.total ?? 0;

    if (forrigeFollowerAntall === -1) {
      forrigeFollowerAntall = nyAntall;
      return;
    }

    if (nyAntall <= forrigeFollowerAntall) return;

    const antallNye = nyAntall - forrigeFollowerAntall;
    forrigeFollowerAntall = nyAntall;

    // Log til dashboard
    const navnListe = (data.data ?? []).slice(0, antallNye).map((f: any) => f.user_name).filter(Boolean);
    if (navnListe.length > 0) {
      for (const navn of navnListe) {
        logHendelse('follow', { username: navn, total: nyAntall });
        logBotAgentEvent({ source: 'twitch', event_type: 'follow', username: navn, importance_score: 40, metadata: { total: nyAntall } });
      }
    } else {
      logHendelse('follow', { count: antallNye, total: nyAntall });
      logBotAgentEvent({ source: 'twitch', event_type: 'follow', importance_score: 30, metadata: { count: antallNye, total: nyAntall } });
    }

    // Nyeste følgere (tilgjengelig ved user token, tom liste ellers)
    const nyeNavn: string[] = (data.data ?? [])
      .slice(0, antallNye)
      .map((f: any) => f.user_name as string)
      .filter(Boolean);

    // Velkomst i Twitch chat
    const erLive = (await getSettings()).lastNotifiedStreamId != null;
    if (erLive && client) {
      const navnListe = nyeNavn.length > 0 ? nyeNavn : Array(Math.min(antallNye, 3)).fill(null).map(() => null as null);
      for (const navn of navnListe) {
        const tekst = navn
          ? `${navn} fulgte nettopp GLENVEX! Lag én kort, varm velkomst på norsk. Maks 10 ord.`
          : `Noen nye fulgte GLENVEX! Lag én kort velkomst til de nye seerne på norsk. Maks 10 ord.`;
        const svar = await aiSvar(tekst);
        const hilsen = svar || (navn ? `@${navn} Takk for follow! Velkommen! PogChamp` : `Takk til alle nye følgere! PogChamp FeelsGoodMan`);
        client.say(`#${KANAL}`, hilsen).catch(() => {});
      }
    }

    // Post til Discord
    const kanalId = chatKanalId() || liveKanalId();
    if (!kanalId) return;

    if (nyeNavn.length > 0) {
      const beskrivelse = antallNye === 1
        ? `**${nyeNavn[0]}** fulgte nettopp GLENVEX! Velkommen til familien! 💚`
        : nyeNavn.map(n => `💚 **${n}**`).join('\n') + (antallNye > nyeNavn.length ? `\n... og ${antallNye - nyeNavn.length} til` : '');

      await postTilDiscord(kanalId, {
        embeds: [{
          title: antallNye === 1 ? '💚 Ny følger!' : `💚 ${antallNye} nye følgere!`,
          description: beskrivelse,
          color: 0x00e676,
          footer: { text: `GLENVEX har nå ${nyAntall.toLocaleString()} følgere på Twitch` },
          timestamp: new Date().toISOString(),
        }],
      });
    } else {
      await postTilDiscord(kanalId, {
        content: `💚 **${antallNye}** ny${antallNye > 1 ? 'e' : ''} følger${antallNye > 1 ? 'e' : ''}! Totalt: **${nyAntall.toLocaleString()}** på Twitch`,
      });
    }
  } catch {}
}

// ─── Live-hendelser → Supabase (buffret, skrives hvert 30s) ──────────────────

const hendelsesBuffer: { type: string; ts: string; [k: string]: any }[] = [];
const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';

function logHendelse(type: string, data: Record<string, any>) {
  hendelsesBuffer.push({ type, ts: new Date().toISOString(), ...data });
}

async function flushHendelser() {
  if (hendelsesBuffer.length === 0) return;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const batch = hendelsesBuffer.splice(0, hendelsesBuffer.length); // tøm buffer
  try {
    const { createClient } = require('@supabase/supabase-js');
    const ws = require('ws');
    const sb = createClient(url, key, { realtime: { transport: ws } });
    const { data: ws_ } = await sb.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    const existing = ws_?.settings_json ?? {};
    const liveEvents: any[] = existing.live_events ?? [];
    liveEvents.unshift(...batch);
    if (liveEvents.length > 150) liveEvents.length = 150;
    await sb.from('workspaces').update({
      settings_json: { ...existing, live_events: liveEvents },
    }).eq('id', WORKSPACE_ID);
  } catch {
    // Legg tilbake i bufferet hvis skriving feilet
    hendelsesBuffer.unshift(...batch);
  }
}

setInterval(flushHendelser, 30_000);

// ─── Partner-promo via Supabase ───────────────────────────────────────────────


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
    // Start følger-polling etter 30s (vent på at broadcaster ID er klart)
    setTimeout(() => {
      sjekkNyeFollowers();
      setInterval(sjekkNyeFollowers, 2 * 60 * 1000);
    }, 30_000);
  }).catch((err: Error) => {
    console.error('  ✗ Twitch chat feil:', err.message);
  });

  // ─── RAID ──────────────────────────────────────────────────────────────────

  client.on('raided', async (channel, username, viewers) => {
    trackRaid(username, viewers);
    logHendelse('raid', { username, viewers });
    logBotAgentEvent({ source: 'twitch', event_type: 'raid', username, importance_score: Math.min(100, viewers / 2), metadata: { viewers } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_EVENT_RECEIVED', title: `Raid fra ${username}: ${viewers} seere`, severity: 'info', metadata: { type: 'raid', username, viewers } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Raidet GLENVEX med ${viewers} seere`, confidence_score: 0.8, metadata: { viewers, type: 'raider' } }).catch(() => {});

    const twitchSvar = await aiSvar(`${username} raidet med ${viewers} seere. Lag en energisk takkemelding på norsk, nevn raid-størrelsen. Maks 1 setning.`);
    const melding = twitchSvar || `RAID! Velkommen ${username} og alle ${viewers} raiders! PogChamp Dere er sjuke for å komme innom! Sjekk Discord: ${DISCORD_URL}`;

    client?.say(channel, melding).catch(() => {});

    await postTilDiscord(await getBotRaidKanalId() || liveKanalId(), {
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
    logHendelse('sub', { username });
    logBotAgentEvent({ source: 'twitch', event_type: 'sub', username, importance_score: 80, metadata: { type: 'new_sub' } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Ny sub: ${username}`, severity: 'info', metadata: { type: 'new_sub', giver: username, mottaker: username } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Subscriber på GLENVEX`, confidence_score: 0.85, metadata: { subscriber: true } }).catch(() => {});
    const svar = await aiSvar(`${username} har nettopp subscripet! Lag en kort, entusiastisk takkemelding på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} TAKK for sub! Du er legen! FeelsGoodMan`).catch(() => {});
    _onSubCallback?.(username).catch(() => {});

    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      content: `🌟 **${username}** er nå subscriber! Takk for støtten! FeelsGoodMan`,
    });
  });

  // ─── RESUB ─────────────────────────────────────────────────────────────────

  client.on('resub', async (channel, username, months, _message, _userstate, _methods) => {
    logHendelse('resub', { username, months });
    logBotAgentEvent({ source: 'twitch', event_type: 'resub', username, importance_score: 75, metadata: { months } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Resub: ${username} (${months} mnd)`, severity: 'info', metadata: { type: 'resub', giver: username, mottaker: username, months } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Lojal subscriber – ${months} måneder`, confidence_score: 0.9, metadata: { subscriber: true, months } }).catch(() => {});
    const svar = await aiSvar(`${username} har hatt sub i ${months} måneder! Takk dem på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} ${months} måneder! Legendarisk lojalitet! PogChamp`).catch(() => {});
    _onSubCallback?.(username).catch(() => {});
  });

  // ─── GIFT SUB ──────────────────────────────────────────────────────────────

  client.on('subgift', async (channel, username, _streakMonths, recipient, _methods, _userstate) => {
    trackGiftSub(username, 1);
    logHendelse('giftsub', { username, recipient });
    logBotAgentEvent({ source: 'twitch', event_type: 'giftsub', username, importance_score: 85, metadata: { recipient } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_GIFT_SUB_RECEIVED', title: `Gift sub: ${username} → ${recipient ?? 'ukjent'}`, severity: 'info', metadata: { type: 'gift_sub', giver: username, mottaker: recipient ?? 'ukjent', antall: 1 } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Gifter subs til community`, confidence_score: 0.85, metadata: { gifter: true } }).catch(() => {});
    const svar = await aiSvar(`${username} giftet sub til ${recipient}! Takk på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} gifter sub til @${recipient}! Sjenerøst! PogChamp`).catch(() => {});
    _onSubCallback?.(recipient).catch(() => {}); // recipient får sub-rollen
    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      content: `🎁 **${username}** giftet sub til **${recipient ?? 'noen'}**! Sjenerøst! PogChamp`,
    });
  });

  client.on('submysterygift', async (channel, username, numbOfSubs, _methods, _userstate) => {
    trackGiftSub(username, numbOfSubs);
    logHendelse('mystery_gift', { username, count: numbOfSubs });
    logBotAgentEvent({ source: 'twitch', event_type: 'mystery_gift', username, importance_score: 90, metadata: { count: numbOfSubs } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_GIFT_SUB_RECEIVED', title: `Mystery gift: ${username} giftet ${numbOfSubs} subs til community`, severity: 'info', metadata: { type: 'mystery_gift', giver: username, mottaker: 'community', antall: numbOfSubs } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Mass gift-giver – ${numbOfSubs} subs`, confidence_score: 0.95, metadata: { gifter: true, totalGifts: numbOfSubs } }).catch(() => {});

    const svar = await aiSvar(`${username} giftet ${numbOfSubs} subs til random seere! Lag en episk takkemelding på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} gifter ${numbOfSubs} subs! HVEM ER DETTE MENNESKET?! PogChamp`).catch(() => {});

    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
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

  client.on('cheer', async (channel, userstate, _message) => {
    const bits = userstate.bits ?? '?';
    const username = userstate.username ?? 'Noen';
    logHendelse('cheer', { username, bits });
    const bitsNum = typeof bits === 'string' ? parseInt(bits) || 0 : bits;
    logBotAgentEvent({ source: 'twitch', event_type: 'cheer', username, importance_score: Math.min(90, bitsNum / 10), metadata: { bits: bitsNum } });
    if (username !== 'Noen') upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Cheerer bits på GLENVEX`, confidence_score: 0.8, metadata: { bits: bitsNum } }).catch(() => {});
    const svar = await aiSvar(`${username} cheeret ${bits} bits! Takk på norsk. Maks 1 setning.`);
    client?.say(channel, svar || `@${username} ${bits} bits!! Du er gal! PogChamp`).catch(() => {});
  });

  // ─── Meldinger ─────────────────────────────────────────────────────────────

  // Telletabell for aktive chat-brukere (oppdateres i minne, flusher til memory via aggregering)
  const chatActivity = new Map<string, number>();
  setInterval(() => {
    // Topp 5 aktive chatters → logg som events for aggregering
    const sorted = Array.from(chatActivity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [username, count] of sorted) {
      if (count >= 3) {
        logBotAgentEvent({ source: 'twitch', event_type: 'active_chatter', username, importance_score: Math.min(60, count * 5), metadata: { messageCount: count } });
      }
    }
    chatActivity.clear();
  }, 10 * 60_000); // Hvert 10. min

  client.on('message', async (channel, tags, message, self) => {
    if (self) return;
    if (!tags.username) return;

    const brukernavn = tags.username.toLowerCase();
    const tekst = message.trim();
    const tekLower = tekst.toLowerCase();

    // Spor chat-aktivitet (billig – bare telle)
    chatActivity.set(brukernavn, (chatActivity.get(brukernavn) ?? 0) + 1);

    const erBot = brukernavn.includes('nightbot') || brukernavn.includes('streamlabs') || brukernavn.includes('streamelements');

    // ── Cross-platform kommandoer (BEFORE vanlig kommando-filter) ───────────
    if (tekLower === '!discordsiste' || tekLower === '!discordtema') {
      if (isCommandCooldown(channel, tekLower)) return;
      setCommandCooldown(channel, tekLower);
      const oppsummering = await summarizeRecentActivity('discord', 60);
      client?.say(channel, oppsummering.slice(0, 490)).catch(() => {});
      logBotAgentEvent({ source: 'twitch', event_type: 'cross_platform_context_used', metadata: { command: tekLower, type: 'TWITCH_BOT_USED_DISCORD_CONTEXT' } });
      return;
    }

    // ── Logg chat-meldinger (relevante, ≥3 ord, ikke bot) ───────────────────
    if (!erBot && !tekst.startsWith('!') && !tekst.startsWith('/')) {
      const ordTelling = tekst.split(/\s+/).filter(w => w.length > 0).length;
      if (ordTelling >= 3) {
        logChatMessage({ source: 'twitch', username: tags.username, message_text: tekst.slice(0, 500), metadata: { channel } });
      }
    }

    if (tekst.startsWith('!') || tekst.startsWith('/')) return;
    if (erBot) return;

    const sist = cooldowns.get(brukernavn);
    if (sist && Date.now() - sist < COOLDOWN_MS) return;

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

    // Bruk Discord-kontekst hvis brukeren spør om community/discord
    const vilHaDiscordInfo = tekLower.includes('discord') || tekLower.includes('community') || tekLower.includes('hva skjer');
    const discordCtx = vilHaDiscordInfo ? await hentDiscordKontekst() : undefined;

    const svar = await aiSvar(`${tags.username}: ${tekst}`, discordCtx || undefined);
    if (svar) client?.say(channel, `@${tags.username} ${svar}`).catch(() => {});
  });

  // ─── Periodic Discord-promo ────────────────────────────────────────────────

  setInterval(() => {
    try {
      const { getBotSettings } = require('@/lib/botMemory');
      const settings = getBotSettings();
      if (!settings.aktiv || settings.pauseTwitch) return;
    } catch {}

    if (Date.now() - sisteDiscordMelding < DISCORD_INTERVAL_MS) return;
    sisteDiscordMelding = Date.now();
    const melding = DISCORD_MELDINGER[Math.floor(Math.random() * DISCORD_MELDINGER.length)];
    client?.say(`#${KANAL}`, melding).catch(() => {});
  }, 5 * 60 * 1000);

  // ─── Partner-promotering via Supabase ─────────────────────────────────────

  const PARTNER_INTERVAL_MS = 60 * 60 * 1000; // 1 time mellom hver partner-promo
  let sistePartnerPromo = 0;

  setInterval(async () => {
    try {
      const { getBotSettings } = require('@/lib/botMemory');
      const s = getBotSettings();
      if (!s.aktiv || s.pauseTwitch || s.pausePartnerPromo) return;
    } catch {}

    if (Date.now() - sistePartnerPromo < PARTNER_INTERVAL_MS) return;
    sistePartnerPromo = Date.now();

    const partner = await getRandomActivePartner();
    if (!partner) return; // ingen URL eller ingen aktive partnere

    const kode = partner.rabattkode ? ` – Bruk kode: ${partner.rabattkode}` : '';
    const ai = await aiSvar(
      `Lag en naturlig, kort Twitch-chat-reklame for partneren vår "${partner.navn}": ${partner.beskrivelse}. Lenke: ${partner.finalUrl}${kode}. Maks 200 tegn. Norsk, avslappet tone.`
    );
    const melding = ai || `🤝 ${partner.navn}: ${partner.beskrivelse}${kode} ${partner.finalUrl}`;
    client?.say(`#${KANAL}`, melding.slice(0, 500)).catch(() => {});

    logPartnerPromoResult({
      partnerName: partner.navn,
      platform: 'twitch',
      channel: `#${KANAL}`,
      affiliateUrlUsed: partner.finalUrl,
      hadAffiliateUrl: partner.affiliateUrl !== null,
      missingAffiliate: partner.missedAffiliate,
      copyText: melding,
    }).catch(() => {});
  }, 15 * 60 * 1000);
}

export function stopTwitchBot() {
  client?.disconnect();
  client = null;
}
