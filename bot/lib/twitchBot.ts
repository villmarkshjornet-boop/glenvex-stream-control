import * as tmi from 'tmi.js';
import OpenAI from 'openai';
import { trackRaid, trackGiftSub } from './eventTracker';
import { getSettings } from '@/lib/settings';
import { getBroadcasterId } from '@/lib/twitch';
import { logBotAgentEvent, upsertBotMemory, logChatMessage } from './agentLogger';
import { recordViewerActivity } from './audienceTracker';
import { incrementChatMessages, incrementFollowerGain } from './streamHistory';
import { getRandomActivePartner, logPartnerPromoResult, trackPartnerExposure } from './partnerHelper';
import { decidePromotion, loadPartnerBotSettings } from './partnerPromotionEngine';
import { getRecentCrossPlatformContext, summarizeRecentActivity, isCommandCooldown, setCommandCooldown } from './crossPlatformContext';
import { logSystemEvent } from './systemEvents';
import { logApiError } from './observability';
import { getSubsKanalId, getClipsKanalId as getBotClipsKanalId, getChatKanalId as getBotChatKanalId, getLiveKanalId as getBotLiveKanalId, getRaidKanalId as getBotRaidKanalId, getPauseTwitch, getPausePartnerPromo, getSvarSjanse, getCooldownMs, getDiscordInviteUrl, getTwitchUrl } from './botKanalPreferanser';

const DISCORD_API = 'https://discord.com/api/v10';
const KANAL      = process.env.TWITCH_USERNAME?.toLowerCase() || 'streameren';
const BOT_BRAND  = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'streameren';

const cooldowns = new Map<string, number>();

// Log + send til Twitch-chat
async function chatSend(channel: string, message: string, context?: Record<string, any>): Promise<void> {
  client?.say(channel, message).catch(() => {});
  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'BOT_CHAT_MESSAGE',
    title: message.slice(0, 100),
    severity: 'info',
    metadata: { channel, message: message.slice(0, 500), ...context },
  });
}

// Callback som index.ts setter for å tildele Discord Twitch-Sub-rolle
let _onSubCallback: ((username: string) => Promise<void>) | null = null;
export function setOnSubCallback(cb: (username: string) => Promise<void>): void {
  _onSubCallback = cb;
}

// Henter Discord URL fra Supabase hver gang så det alltid er oppdatert
async function getDiscordMeldinger(): Promise<string[]> {
  const url = await getDiscordInviteUrl().catch(() => '') || process.env.DISCORD_INVITE_URL || 'https://discord.gg/glenvex';
  return [
    `Bli med i ${BOT_BRAND} sitt Discord! Snakk med community, se klipp og få live-varsling: ${url} GlitchCat`,
    `Har du ikke jotnet Discord ennå? Kom innom: ${url} PogChamp`,
    `Discord-chatten er varm nå! Bli med: ${url} 👾`,
    `For drops, klipp og kaos utenom stream – Discord er stedet: ${url} Kappa`,
    `Stream-varslinger og community på Discord: ${url} FeelsGoodMan`,
  ];
}

async function getSystemPrompt(): Promise<string> {
  const discordUrl = await getDiscordInviteUrl().catch(() => '') || process.env.DISCORD_INVITE_URL || 'discord.gg/glenvex';
  return `Du er community-boten for ${BOT_BRAND} i Twitch-chat.
Regler:
- VELDIG korte svar – maks 1 setning, helst under 10 ord
- Norsk med litt gaming-slang
- Bruk Twitch-emotes naturlig: Kappa PogChamp LUL FeelsGoodMan GlitchCat Pog
- Svar kun hvis det er relevant og morsomt
- Promoter ${discordUrl} naturlig innimellom`;
}

let client: tmi.Client | null = null;
let sisteDiscordMelding = 0;
const DISCORD_INTERVAL_MS = 25 * 60 * 1000;

// ─── Promotion engine state ───────────────────────────────────────────────────
let _chatMsgsLastMinute = 0;
let _recentChatLines: string[] = [];
let _sistePartnerPromo = 0;
let _promoerDenneStream = 0;

// ─── Multi-tenant ekstern kanal-ruting ────────────────────────────────────────

type ExternalChannelHandler = (channel: string, username: string, text: string, tags: tmi.ChatUserstate) => void;
const externalChannelHandlers = new Map<string, ExternalChannelHandler>();

/**
 * Registrer en ekstern workspace-kanal på den delte tmi.js-klienten.
 * Returnerer en cleanup-funksjon som forlater kanalen og fjerner handleren.
 */
export function registerExternalChannel(channel: string, handler: ExternalChannelHandler): () => void {
  const ch = channel.toLowerCase().replace(/^#/, '');
  externalChannelHandlers.set(ch, handler);

  if (client) {
    const joined = client.getChannels();
    if (!joined.includes(`#${ch}`)) {
      client.join(ch).catch((err: Error) =>
        console.error(`[twitchBot] Kan ikke joine ${ch}:`, err.message?.slice(0, 80))
      );
    }
  }

  return () => {
    externalChannelHandlers.delete(ch);
    client?.part(ch).catch(() => {});
  };
}

/** Send en melding i en kanal via den delte tmi.js-klienten (for workspace bots). */
export function sayInChannel(channel: string, message: string): void {
  client?.say(channel.startsWith('#') ? channel : `#${channel}`, message).catch(() => {});
}

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
    let systemPrompt = await getSystemPrompt().catch(() => `Du er community-boten for ${BOT_BRAND} i Twitch-chat. Veldig korte norske svar.`);
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

    if (!res?.ok) {
      if (res) {
        logApiError({
          service: 'Twitch',
          endpoint: '/helix/channels/followers',
          statusCode: res.status,
          errorMessage: `HTTP ${res.status}: follower-sjekk feilet`,
        });
      }
      return;
    }
    const data = await res.json() as any;
    const nyAntall: number = data.total ?? 0;

    if (forrigeFollowerAntall === -1) {
      forrigeFollowerAntall = nyAntall;
      return;
    }

    if (nyAntall <= forrigeFollowerAntall) return;

    const antallNye = nyAntall - forrigeFollowerAntall;
    forrigeFollowerAntall = nyAntall;
    incrementFollowerGain(antallNye);

    // Log til dashboard
    const navnListe = (data.data ?? []).slice(0, antallNye).map((f: any) => f.user_name).filter(Boolean);
    if (navnListe.length > 0) {
      for (const navn of navnListe) {
        logBotAgentEvent({ source: 'twitch', event_type: 'follow', username: navn, importance_score: 40, metadata: { total: nyAntall } });
      }
    } else {
      logBotAgentEvent({ source: 'twitch', event_type: 'follow', importance_score: 30, metadata: { count: antallNye, total: nyAntall } });
    }

    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'FOLLOW_RECEIVED',
      title: navnListe.length > 0
        ? `${antallNye === 1 ? navnListe[0] : `${navnListe[0]} og ${antallNye - 1} til`} fulgte ${BOT_BRAND}`
        : `${antallNye} ny${antallNye > 1 ? 'e' : ''} følger${antallNye > 1 ? 'e' : ''}`,
      severity: 'info',
      metadata: { antallNye, totalFollowers: nyAntall, names: navnListe.slice(0, 5) },
    });

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
          ? `${navn} fulgte nettopp ${BOT_BRAND}! Lag én kort, varm velkomst på norsk. Maks 10 ord.`
          : `Noen nye fulgte ${BOT_BRAND}! Lag én kort velkomst til de nye seerne på norsk. Maks 10 ord.`;
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
        ? `**${nyeNavn[0]}** fulgte nettopp ${BOT_BRAND}! Velkommen til familien! 💚`
        : nyeNavn.map(n => `💚 **${n}**`).join('\n') + (antallNye > nyeNavn.length ? `\n... og ${antallNye - nyeNavn.length} til` : '');

      await postTilDiscord(kanalId, {
        embeds: [{
          title: antallNye === 1 ? '💚 Ny følger!' : `💚 ${antallNye} nye følgere!`,
          description: beskrivelse,
          color: 0x00e676,
          footer: { text: `${BOT_BRAND} har nå ${nyAntall.toLocaleString()} følgere på Twitch` },
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

// ─── Partner-promo i Twitch chat ──────────────────────────────────────────────

async function sendTwitchPartnerPromo(): Promise<void> {
  if (!client) return;
  const settings = getSettings();
  if (!settings.lastNotifiedStreamId) return; // bare når live
  if (await getPausePartnerPromo().catch(() => false)) return;

  const partner = await getRandomActivePartner();
  if (!partner) return;

  const kode = partner.rabattkode ? ` (kode: ${partner.rabattkode})` : '';
  let tekst = `🤝 Sjekk ut vår partner ${partner.navn}! ${partner.finalUrl}${kode}`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Skriv en veldig kort Twitch-chat promo (maks 15 ord) for partner: ${partner.navn}${partner.beskrivelse ? ` – ${partner.beskrivelse}` : ''}. Norsk, uformell, ikke salesy. Ikke start med emoji.` }],
        max_tokens: 40,
        temperature: 0.8,
      });
      const ai = res.choices[0]?.message?.content?.trim() ?? '';
      if (ai) tekst = `${ai} → ${partner.finalUrl}${kode}`;
    } catch {}
  }

  await chatSend(`#${KANAL}`, tekst, { trigger: 'twitch_partner_promo', partner: partner.navn });
  logSystemEvent({
    source: 'twitch_bot',
    event_type: 'PARTNER_PROMO_SENT',
    title: `Twitch-promo: ${partner.navn}`,
    severity: 'info',
    metadata: { partner: partner.navn, featured: (partner as any).prioritet >= 100, channel: KANAL },
  });
  logPartnerPromoResult({
    partnerName: partner.navn,
    platform: 'twitch',
    channel: KANAL,
    affiliateUrlUsed: partner.finalUrl,
    hadAffiliateUrl: partner.affiliateUrl !== null,
    missingAffiliate: partner.missedAffiliate,
    copyText: tekst,
  }).catch(() => {});

  trackPartnerExposure({
    partnerId: partner.id,
    partnerName: partner.navn,
    platform: 'twitch',
    channelId: KANAL,
    source: 'twitch_timer',
  }).catch(() => {});
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
    // Join eventuelle workspace-kanaler som ble registrert før connect()
    for (const ch of externalChannelHandlers.keys()) {
      client!.join(ch).catch(() => {});
    }
    // Start følger-polling etter 30s (vent på at broadcaster ID er klart)
    setTimeout(() => {
      sjekkNyeFollowers();
      setInterval(sjekkNyeFollowers, 2 * 60 * 1000);
    }, 30_000);

    // Partner-promo via promotionEngine: context-aware, anti-spam
    // Resetter per-minutt-telleren hvert minutt
    setInterval(() => { _chatMsgsLastMinute = 0; }, 60_000);

    // Sjekk for promo-muligheter hvert 5. minutt (engine bestemmer om den faktisk sender)
    setTimeout(() => {
      const runPromoCheck = async () => {
        const settings = await loadPartnerBotSettings().catch(() => null);
        if (!settings?.enabled || !settings.twitchEnabled) return;

        const streamSettings = getSettings();
        if (!streamSettings.lastNotifiedStreamId) return; // bare når live
        if (await getPausePartnerPromo().catch(() => false)) return;

        const minutesSinceLastPromo = (Date.now() - _sistePartnerPromo) / 60_000;

        const decision = await decidePromotion({
          workspaceId: process.env.WORKSPACE_ID ?? 'glenvex-default',
          game: '',
          viewerCount: 0,
          historicalAvgViewers: 0,
          chatMessagesLastMinute: _chatMsgsLastMinute,
          recentChatLines: [..._recentChatLines],
          minutesSinceLastPost: minutesSinceLastPromo,
          postsThisStream: _promoerDenneStream,
          settings,
        }).catch(() => null);

        if (!decision) return;

        // requireApproval=true: proposal stored, nothing to send yet
        if (!decision.shouldPromote) return;

        const msg = decision.messageTwitch;
        if (!msg) return;

        await chatSend(`#${KANAL}`, msg, { trigger: 'partner_promotion_engine', partner: decision.partnerName, triggerType: decision.triggerType });

        _sistePartnerPromo = Date.now();
        _promoerDenneStream++;

        if (decision.partnerName) {
          await trackPartnerExposure({
            partnerId: decision.partnerId ?? undefined,
            partnerName: decision.partnerName,
            platform: 'twitch',
            channelId: KANAL,
            source: `engine_${decision.triggerType}`,
          }).catch(() => {});
        }
      };

      runPromoCheck().catch(() => {});
      setInterval(() => runPromoCheck().catch(() => {}), 5 * 60_000);
    }, 20 * 60_000); // første sjekk etter 20 min (la stream komme i gang)

    // Reset promo-teller ved ny stream (lastNotifiedStreamId endres)
    let _prevStreamId = getSettings().lastNotifiedStreamId;
    setInterval(() => {
      const cur = getSettings().lastNotifiedStreamId;
      if (cur !== _prevStreamId) { _promoerDenneStream = 0; _sistePartnerPromo = 0; _prevStreamId = cur; }
    }, 60_000);
  }).catch((err: Error) => {
    console.error('  ✗ Twitch chat feil:', err.message);
  });

  // ─── RAID ──────────────────────────────────────────────────────────────────

  client.on('raided', async (channel, username, viewers) => {
    trackRaid(username, viewers);
    logBotAgentEvent({ source: 'twitch', event_type: 'raid', username, importance_score: Math.min(100, viewers / 2), metadata: { viewers } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_EVENT_RECEIVED', title: `Raid fra ${username}: ${viewers} seere`, severity: 'info', metadata: { type: 'raid', username, viewers } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Raidet kanalen med ${viewers} seere`, confidence_score: 0.8, metadata: { viewers, type: 'raider' } }).catch(() => {});

    const twitchSvar = await aiSvar(`${username} raidet med ${viewers} seere. Lag en energisk takkemelding på norsk, nevn raid-størrelsen. Maks 1 setning.`);
    const discordUrlRaid = await getDiscordInviteUrl();
    const melding = twitchSvar || `RAID! Velkommen ${username} og alle ${viewers} raiders! PogChamp Dere er sjuke for å komme innom!${discordUrlRaid ? ` Sjekk Discord: ${discordUrlRaid}` : ''}`;

    await chatSend(channel, melding, { trigger: 'raid', username, viewers });

    await postTilDiscord(await getBotRaidKanalId() || liveKanalId(), {
      embeds: [{
        title: `🚨 RAID – ${username}`,
        description: `**${username}** raidet med **${viewers} seere!**\n\nGi dem en varm velkomst! PogChamp`,
        color: 0x9146ff,
        fields: [
          { name: '👥 Raid-størrelse', value: viewers.toString(), inline: true },
          { name: '🎮 Raider', value: `[twitch.tv/${username}](https://twitch.tv/${username})`, inline: true },
        ],
        footer: { text: 'Stream Control • Raid' },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── SUBSCRIPTION ──────────────────────────────────────────────────────────

  client.on('subscription', async (channel, username, _method, _message, _userstate) => {
    logBotAgentEvent({ source: 'twitch', event_type: 'sub', username, importance_score: 80, metadata: { type: 'new_sub' } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Ny sub: ${username}`, severity: 'info', metadata: { type: 'new_sub', giver: username, mottaker: username } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Subscriber på ${BOT_BRAND}`, confidence_score: 0.85, metadata: { subscriber: true } }).catch(() => {});
    const svar = await aiSvar(`${username} har nettopp subscripet! Lag en kort, entusiastisk takkemelding på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} TAKK for sub! Du er legen! FeelsGoodMan`, { trigger: 'sub', username });
    _onSubCallback?.(username).catch(() => {});

    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      content: `🌟 **${username}** er nå subscriber! Takk for støtten! FeelsGoodMan`,
    });
  });

  // ─── RESUB ─────────────────────────────────────────────────────────────────

  client.on('resub', async (channel, username, months, _message, _userstate, _methods) => {
    logBotAgentEvent({ source: 'twitch', event_type: 'resub', username, importance_score: 75, metadata: { months } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Resub: ${username} (${months} mnd)`, severity: 'info', metadata: { type: 'resub', giver: username, mottaker: username, months } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Lojal subscriber – ${months} måneder`, confidence_score: 0.9, metadata: { subscriber: true, months } }).catch(() => {});
    const svar = await aiSvar(`${username} har hatt sub i ${months} måneder! Takk dem på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} ${months} måneder! Legendarisk lojalitet! PogChamp`, { trigger: 'resub', username, months });
    _onSubCallback?.(username).catch(() => {});
  });

  // ─── GIFT SUB ──────────────────────────────────────────────────────────────

  client.on('subgift', async (channel, username, _streakMonths, recipient, _methods, _userstate) => {
    trackGiftSub(username, 1);
    logBotAgentEvent({ source: 'twitch', event_type: 'giftsub', username, importance_score: 85, metadata: { recipient } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_GIFT_SUB_RECEIVED', title: `Gift sub: ${username} → ${recipient ?? 'ukjent'}`, severity: 'info', metadata: { type: 'gift_sub', giver: username, mottaker: recipient ?? 'ukjent', antall: 1 } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Gifter subs til community`, confidence_score: 0.85, metadata: { gifter: true } }).catch(() => {});
    const svar = await aiSvar(`${username} giftet sub til ${recipient}! Takk på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} gifter sub til @${recipient}! Sjenerøst! PogChamp`, { trigger: 'giftsub', username, recipient });
    _onSubCallback?.(recipient).catch(() => {}); // recipient får sub-rollen
    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      content: `🎁 **${username}** giftet sub til **${recipient ?? 'noen'}**! Sjenerøst! PogChamp`,
    });
  });

  client.on('submysterygift', async (channel, username, numbOfSubs, _methods, _userstate) => {
    trackGiftSub(username, numbOfSubs);
    logBotAgentEvent({ source: 'twitch', event_type: 'mystery_gift', username, importance_score: 90, metadata: { count: numbOfSubs } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_GIFT_SUB_RECEIVED', title: `Mystery gift: ${username} giftet ${numbOfSubs} subs til community`, severity: 'info', metadata: { type: 'mystery_gift', giver: username, mottaker: 'community', antall: numbOfSubs } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Mass gift-giver – ${numbOfSubs} subs`, confidence_score: 0.95, metadata: { gifter: true, totalGifts: numbOfSubs } }).catch(() => {});

    const svar = await aiSvar(`${username} giftet ${numbOfSubs} subs til random seere! Lag en episk takkemelding på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} gifter ${numbOfSubs} subs! HVEM ER DETTE MENNESKET?! PogChamp`, { trigger: 'mystery_gift', username, count: numbOfSubs });

    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      embeds: [{
        title: `🎁 MASSE GIFT SUBS – ${username}`,
        description: `**${username}** giftet **${numbOfSubs} subs** til chatten! Dette er sjenerøsitet på et annet nivå! 👑`,
        color: 0xffd700,
        footer: { text: 'Stream Control • Gift Sub' },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── CHEER (bits) ──────────────────────────────────────────────────────────

  client.on('cheer', async (channel, userstate, _message) => {
    const bits = userstate.bits ?? '?';
    const username = userstate.username ?? 'Noen';
    const bitsNum = typeof bits === 'string' ? parseInt(bits) || 0 : bits;
    logBotAgentEvent({ source: 'twitch', event_type: 'cheer', username, importance_score: Math.min(90, bitsNum / 10), metadata: { bits: bitsNum } });
    if (username !== 'Noen') upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Cheerer bits på ${BOT_BRAND}`, confidence_score: 0.8, metadata: { bits: bitsNum } }).catch(() => {});
    const svar = await aiSvar(`${username} cheeret ${bits} bits! Takk på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} ${bits} bits!! Du er gal! PogChamp`, { trigger: 'cheer', username, bits });
  });

  // ─── Meldinger ─────────────────────────────────────────────────────────────

  // Telletabell for aktive chat-brukere (oppdateres i minne, flusher til memory via aggregering)
  const chatActivity = new Map<string, number>();
  setInterval(() => {
    const totalMessages = Array.from(chatActivity.values()).reduce((a, b) => a + b, 0);
    const uniqueUsers = chatActivity.size;

    if (totalMessages >= 20 && uniqueUsers >= 5) {
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'CHAT_SPIKE_DETECTED',
        title: `Chat-spike: ${totalMessages} meldinger fra ${uniqueUsers} brukere (10 min)`,
        severity: 'info',
        metadata: { totalMessages, uniqueUsers, windowMin: 10 },
      });
    }

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

    // Rut til workspace-handler hvis dette ikke er hoved-kanalen
    const chNavn = channel.replace('#', '').toLowerCase();
    if (chNavn !== KANAL) {
      const extHandler = externalChannelHandlers.get(chNavn);
      if (extHandler) {
        extHandler(channel, tags.username, message, tags);
        return;
      }
    }

    const brukernavn = tags.username.toLowerCase();
    const tekst = message.trim();
    const tekLower = tekst.toLowerCase();

    // Spor chat-aktivitet (billig – bare telle)
    chatActivity.set(brukernavn, (chatActivity.get(brukernavn) ?? 0) + 1);
    recordViewerActivity(tags.username, tags);
    incrementChatMessages();

    // Promotion engine: per-minutt teller + rullende buffer
    _chatMsgsLastMinute++;
    _recentChatLines.push(`${tags.username}: ${tekst}`);
    if (_recentChatLines.length > 30) _recentChatLines = _recentChatLines.slice(-30);

    const erBot = brukernavn.includes('nightbot') || brukernavn.includes('streamlabs') || brukernavn.includes('streamelements');

    // ── Cross-platform kommandoer (BEFORE vanlig kommando-filter) ───────────
    if (tekLower === '!discordsiste' || tekLower === '!discordtema') {
      if (isCommandCooldown(channel, tekLower)) return;
      setCommandCooldown(channel, tekLower);
      const oppsummering = await summarizeRecentActivity('discord', 60);
      await chatSend(channel, oppsummering.slice(0, 490), { trigger: 'command', command: tekLower });
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

    const cooldownMs = await getCooldownMs();
    const sist = cooldowns.get(brukernavn);
    if (sist && Date.now() - sist < cooldownMs) return;

    const spørOmDiscord = tekLower.includes('discord') || tekLower.includes('server');
    if (spørOmDiscord) {
      cooldowns.set(brukernavn, Date.now());
      const discordUrlChat = await getDiscordInviteUrl();
      await chatSend(channel, `@${tags.username} Discord er her: ${discordUrlChat || 'discord.gg/glenvex'} PogChamp`, { trigger: 'discord_mention', username: tags.username });
      return;
    }

    const botNamnLower = botNavn.toLowerCase();
    const erTagget = tekLower.includes(botNamnLower) || (process.env.TWITCH_USERNAME ? tekLower.includes(`@${process.env.TWITCH_USERNAME.toLowerCase()}`) : false);
    const svarSjanse = await getSvarSjanse();
    if (!erTagget && Math.random() > svarSjanse) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    cooldowns.set(brukernavn, Date.now());

    // Bruk Discord-kontekst hvis brukeren spør om community/discord
    const vilHaDiscordInfo = tekLower.includes('discord') || tekLower.includes('community') || tekLower.includes('hva skjer');
    const discordCtx = vilHaDiscordInfo ? await hentDiscordKontekst() : undefined;

    const svar = await aiSvar(`${tags.username}: ${tekst}`, discordCtx || undefined);
    if (svar) await chatSend(channel, `@${tags.username} ${svar}`, { trigger: 'ai_reply', username: tags.username });
  });

  // ─── Periodic Discord-promo ────────────────────────────────────────────────

  setInterval(async () => {
    const [aktiv, pauseTwitch] = await Promise.all([
      getPauseTwitch().then(p => !p).catch(() => true), // aktiv = ikke pauset
      getPauseTwitch().catch(() => false),
    ]);
    if (!aktiv || pauseTwitch) return;

    if (Date.now() - sisteDiscordMelding < DISCORD_INTERVAL_MS) return;
    sisteDiscordMelding = Date.now();
    const meldinger = await getDiscordMeldinger();
    const melding = meldinger[Math.floor(Math.random() * meldinger.length)];
    await chatSend(`#${KANAL}`, melding, { trigger: 'discord_promo' });
  }, 5 * 60 * 1000);

  // Partner-promotering via Supabase håndteres av sendTwitchPartnerPromo() (se startTwitchBot-timeren over).
  // Tidligere fantes en duplikat 15/60-min poller her som promoterte uavhengig av live-status –
  // fjernet for å unngå dobbel kadens og fordi den ikke sjekket lastNotifiedStreamId.
}

export function stopTwitchBot() {
  client?.disconnect();
  client = null;
}
