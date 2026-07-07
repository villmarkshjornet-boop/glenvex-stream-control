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
import { getBrainState } from './creatorBrain';
import { getSubsKanalId, getClipsKanalId as getBotClipsKanalId, getChatKanalId as getBotChatKanalId, getLiveKanalId as getBotLiveKanalId, getRaidKanalId as getBotRaidKanalId, getPauseTwitch, getPausePartnerPromo, getSvarSjanse, getCooldownMs, getDiscordInviteUrl, getTwitchUrl } from './botKanalPreferanser';
import { addTwitchMessageXP } from './memberTracker';
import { verifyLinkCode } from './twitchLinkService';
import { checkCompliance } from './complianceEngine';
import { canPostToTwitch, isTwitchLive } from './postingGate';
import { getBotDb } from './supabase';

const DISCORD_API = 'https://discord.com/api/v10';
const KANAL      = process.env.TWITCH_USERNAME?.toLowerCase() || 'streameren';
const BOT_BRAND  = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'streameren';

const cooldowns = new Map<string, number>();

// Log + send til Twitch-chat
async function chatSend(channel: string, message: string, context?: Record<string, any>): Promise<void> {
  if (!client) {
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_CHAT_SEND_FAILED', title: 'chatSend: klient ikke tilkoblet', severity: 'warning', metadata: { channel, ...context } });
    return;
  }
  client.say(channel, message).then(() => {
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'BOT_CHAT_MESSAGE',
      title: message.slice(0, 100),
      severity: 'info',
      metadata: { channel, message: message.slice(0, 500), ...context },
    });
  }).catch((err: any) => {
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'TWITCH_CHAT_SEND_FAILED',
      title: `Twitch chat send feilet: ${String(err?.message ?? err).slice(0, 100)}`,
      severity: 'error',
      metadata: { channel, error: String(err?.message ?? err), ...context },
    });
  });
}

// Callback som index.ts setter for å tildele Discord Twitch-Sub-rolle
// twitchUserId er Twitch numeric user-id fra IRC tags (kan mangle for gift-mottakere)
type OnSubCb = (twitchUsername: string, twitchUserId?: string, subTier?: string) => Promise<void>;
let _onSubCallback: OnSubCb | null = null;
export function setOnSubCallback(cb: OnSubCb): void {
  _onSubCallback = cb;
}

// Callback som index.ts setter for å behandle verifiserte Discord ↔ Twitch-koblinger
// hasStoredSub: true hvis verifyLinkCode fant en lagret sub (unlinked_subs eller tw_-rad)
type LinkVerifiedCb = (discordId: string, twitchUserId: string, twitchUsername: string, hasStoredSub: boolean) => void;
let _onLinkVerifiedCallback: LinkVerifiedCb | null = null;
export function setOnLinkVerifiedCallback(cb: LinkVerifiedCb): void {
  _onLinkVerifiedCallback = cb;
}

// Henter Discord URL fra Supabase hver gang så det alltid er oppdatert
async function getDiscordMeldinger(): Promise<string[]> {
  const url = await getDiscordInviteUrl().catch(() => '') || process.env.DISCORD_INVITE_URL || '';
  return [
    `Bli med i ${BOT_BRAND} sitt Discord! Snakk med community, se klipp og få live-varsling: ${url} GlitchCat`,
    `Har du ikke jotnet Discord ennå? Kom innom: ${url} PogChamp`,
    `Discord-chatten er varm nå! Bli med: ${url} 👾`,
    `For drops, klipp og kaos utenom stream – Discord er stedet: ${url} Kappa`,
    `Stream-varslinger og community på Discord: ${url} FeelsGoodMan`,
  ];
}

async function getSystemPrompt(): Promise<string> {
  const discordUrl = await getDiscordInviteUrl().catch(() => '') || process.env.DISCORD_INVITE_URL || '';
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
let _sisteRaidTidspunkt: number | null = null;

// ─── External chat message handlers (for Poll Manager vote collection) ────────
type ExternalChatHandler = (username: string, message: string) => void;
const _externalChatHandlers = new Set<ExternalChatHandler>();

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

// /helix/channels/followers requires a broadcaster user token (not app token) since Aug 2023.
// We read twitch_access_token from Supabase and auto-refresh via twitch_refresh_token on 401.
let _cachedBroadcasterToken: string | null = null;
let _cachedBroadcasterTokenAt: number | null = null;

export async function getBroadcasterUserToken(workspaceId?: string): Promise<string | null> {
  const TOKEN_TTL_MS = 3.5 * 60 * 60 * 1000; // 3.5 hours — Twitch tokens expire ~4h
  if (_cachedBroadcasterToken && _cachedBroadcasterTokenAt && (Date.now() - _cachedBroadcasterTokenAt) < TOKEN_TTL_MS) {
    return _cachedBroadcasterToken;
  }

  const wsId = workspaceId ?? process.env.WORKSPACE_ID ?? '';
  if (!wsId) {
    console.error('[getBroadcasterUserToken] WORKSPACE_ID env var is not set and no workspaceId argument provided');
    return null;
  }
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const clientId     = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!sbUrl || !sbKey) {
    console.error('[getBroadcasterUserToken] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return null;
  }
  if (!clientId || !clientSecret) {
    console.error('[getBroadcasterUserToken] TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET missing');
    return null;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

    // Primary lookup: workspaces.id (TEXT PK — must match exactly)
    let { data: ws, error: dbError } = await sb
      .from('workspaces')
      .select('id,twitch_access_token,twitch_refresh_token,twitch_user_id,twitch_channel_name,streamer_name')
      .eq('id', wsId)
      .single();

    // Fallback: WORKSPACE_ID may be a slug/name rather than the actual PK value.
    // Try twitch_channel_name and streamer_name before giving up.
    if ((dbError || !ws) && wsId) {
      const { data: wsAlt } = await sb
        .from('workspaces')
        .select('id,twitch_access_token,twitch_refresh_token,twitch_user_id,twitch_channel_name,streamer_name')
        .or(`twitch_channel_name.eq.${wsId},streamer_name.eq.${wsId}`)
        .limit(1)
        .maybeSingle();

      if (wsAlt) {
        console.warn(`[getBroadcasterUserToken] wsId="${wsId}" ikke funnet som PK — fallback til rad med id="${wsAlt.id}" (twitch_channel_name="${wsAlt.twitch_channel_name}"). Oppdater WORKSPACE_ID i Railway til "${wsAlt.id}".`);
        logSystemEvent({
          source: 'twitch_bot',
          event_type: 'TWITCH_AUTH_ERROR',
          title: `WORKSPACE_ID="${wsId}" matcher ikke workspaces.id — fallback brukt (faktisk id="${wsAlt.id}"). Oppdater Railway.`,
          severity: 'warning',
          metadata: { providedWsId: wsId, actualId: wsAlt.id, twitchChannelName: wsAlt.twitch_channel_name },
        });
        ws = wsAlt;
        dbError = null;
      }
    }

    if (dbError || !ws) {
      console.error(`[getBroadcasterUserToken] DB lookup feilet for wsId="${wsId}":`, dbError?.message ?? 'no row returned');
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'TWITCH_AUTH_ERROR',
        title: `Twitch token: workspace "${wsId}" ikke funnet i DB (hverken som id, twitch_channel_name eller streamer_name)`,
        severity: 'error',
        metadata: { workspaceId: wsId, dbError: dbError?.message ?? 'no row' },
      });
      return null;
    }

    if (!ws.twitch_access_token) {
      console.error(`[getBroadcasterUserToken] wsId="${wsId}" row found but twitch_access_token is null — user must reconnect Twitch in settings`);
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'TWITCH_AUTH_ERROR',
        title: `Twitch token: twitch_access_token mangler for workspace "${wsId}" — koble til Twitch på nytt`,
        severity: 'critical',
        metadata: { workspaceId: wsId, hasTwitchUserId: !!ws.twitch_user_id },
      });
      return null;
    }

    // Validate via /oauth2/validate (lightweight, no quota cost)
    const testRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${ws.twitch_access_token}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (testRes?.ok) {
      // Verify required scope is present
      const validateData = await testRes.json().catch(() => null) as { scopes?: string[] } | null;
      const scopes = validateData?.scopes ?? [];
      if (scopes.length > 0 && !scopes.includes('channel:read:subscriptions')) {
        console.warn(`[getBroadcasterUserToken] Token valid but missing scope "channel:read:subscriptions". Has: ${scopes.join(', ')}`);
        logSystemEvent({
          source: 'twitch_bot',
          event_type: 'TWITCH_AUTH_ERROR',
          title: 'Twitch token mangler scope channel:read:subscriptions — koble til Twitch på nytt',
          severity: 'error',
          metadata: { workspaceId: wsId, scopes },
        });
        // Return token anyway — some endpoints don't need this scope
      }
      _cachedBroadcasterToken = ws.twitch_access_token;
      _cachedBroadcasterTokenAt = Date.now();
      return _cachedBroadcasterToken;
    }

    const validateStatus = testRes?.status ?? 'network_error';
    console.warn(`[getBroadcasterUserToken] Token validation failed (HTTP ${validateStatus}) — attempting refresh`);

    if (!ws.twitch_refresh_token) {
      console.error(`[getBroadcasterUserToken] Token expired and no refresh_token stored for wsId="${wsId}"`);
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'TWITCH_AUTH_ERROR',
        title: 'Twitch token utløpt og ingen refresh_token — koble til Twitch på nytt',
        severity: 'critical',
        metadata: { workspaceId: wsId, validateStatus },
      });
      return null;
    }

    const refreshRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: ws.twitch_refresh_token,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (refreshRes?.ok) {
      const tokens = await refreshRes.json() as { access_token: string; refresh_token?: string };
      await sb.from('workspaces').update({
        twitch_access_token:  tokens.access_token,
        ...(tokens.refresh_token ? { twitch_refresh_token: tokens.refresh_token } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', wsId);

      _cachedBroadcasterToken = tokens.access_token;
      _cachedBroadcasterTokenAt = Date.now();
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'TWITCH_TOKEN_REFRESHED',
        title: 'Twitch broadcaster token auto-refreshed og lagret',
        severity: 'info',
        metadata: { workspaceId: wsId },
      });
      return _cachedBroadcasterToken;
    }

    // Refresh failed — log the specific error from Twitch
    let refreshErrBody = '';
    try { refreshErrBody = await refreshRes?.text() ?? ''; } catch {}
    console.error(`[getBroadcasterUserToken] Token refresh failed HTTP ${refreshRes?.status ?? 'network_error'}: ${refreshErrBody.slice(0, 200)}`);
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'TWITCH_AUTH_ERROR',
      title: 'Twitch token refresh feilet — koble til Twitch på nytt i innstillinger',
      severity: 'critical',
      metadata: {
        workspaceId: wsId,
        refreshStatus: refreshRes?.status ?? 'network_error',
        refreshError: refreshErrBody.slice(0, 200),
      },
    });
  } catch (err) {
    console.error('[getBroadcasterUserToken] Unexpected error:', err);
  }
  return null;
}

async function sjekkNyeFollowers() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return;

  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return;

    const token = await getBroadcasterUserToken();
    if (!token) return;

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=10`,
      {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      }
    ).catch(() => null);

    if (!res?.ok) {
      // Invalidate cached token so next call re-fetches
      if (res?.status === 401) { _cachedBroadcasterToken = null; _cachedBroadcasterTokenAt = null; }
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

    // Velkomst i Twitch chat — branded "Velkommen til gjengen" greeting
    const erLive = await isTwitchLive(process.env.WORKSPACE_ID ?? '').catch(() => false);
    if (erLive) {
      const navnListe = nyeNavn.length > 0 ? nyeNavn : Array(Math.min(antallNye, 3)).fill(null).map(() => null as null);
      for (const navn of navnListe) {
        const hilsen = navn
          ? `Velkommen til gjengen, ${navn}! 💚 PogChamp`
          : `Velkommen til alle nye følgere! 💚 PogChamp`;
        await chatSend(`#${KANAL}`, hilsen, { trigger: 'new_follower', follower: navn ?? undefined });
      }
    }

    // Post til Discord
    const kanalId = chatKanalId() || liveKanalId();
    if (!kanalId) return;

    if (nyeNavn.length > 0) {
      const velkomst = antallNye === 1
        ? `Velkommen til gjengen, **${nyeNavn[0]}**! 💚`
        : nyeNavn.map(n => `💚 Velkommen til gjengen, **${n}**!`).join('\n') +
          (antallNye > nyeNavn.length ? `\n... og ${antallNye - nyeNavn.length} til!` : '');

      await postTilDiscord(kanalId, {
        embeds: [{
          title: antallNye === 1 ? '💚 Ny følger!' : `💚 ${antallNye} nye følgere!`,
          description: velkomst,
          color: 0x00e676,
          footer: { text: `${BOT_BRAND} har nå ${nyAntall.toLocaleString()} følgere på Twitch` },
          timestamp: new Date().toISOString(),
        }],
      });
    } else {
      await postTilDiscord(kanalId, {
        content: `💚 **${antallNye}** ny${antallNye > 1 ? 'e' : ''} følger${antallNye > 1 ? 'e' : ''}! Totalt: **${nyAntall.toLocaleString()}** på Twitch — Velkommen til gjengen! PogChamp`,
      });
    }
  } catch {}
}

// ─── Partner-promo i Twitch chat ──────────────────────────────────────────────

async function sendTwitchPartnerPromo(): Promise<void> {
  if (!client) return;
  const isLive = await isTwitchLive(process.env.WORKSPACE_ID ?? '').catch(() => false);
  if (!isLive) return; // bare når live
  if (await getPausePartnerPromo().catch(() => false)) return;

  const partner = await getRandomActivePartner(process.env.WORKSPACE_ID);
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

let _chatRetryCount = 0;

export async function startTwitchBot({ skipEnvOauth = false }: { skipEnvOauth?: boolean } = {}) {
  let oauth: string | undefined = skipEnvOauth ? undefined : process.env.TWITCH_BOT_OAUTH;
  const botNavn = process.env.TWITCH_BOT_USERNAME || KANAL;

  if (!oauth) {
    // Fallback: try broadcaster token stored in DB (requires chat:read + chat:edit scopes)
    const wsId = process.env.WORKSPACE_ID ?? '';
    const db   = getBotDb();
    if (db && wsId) {
      const { data } = await db
        .from('workspaces')
        .select('twitch_access_token')
        .eq('id', wsId)
        .single()
        .then((r) => r, () => ({ data: null }));
      if (data?.twitch_access_token) {
        oauth = `oauth:${data.twitch_access_token}`;
        console.log('  ℹ TWITCH_BOT_OAUTH ikke satt — bruker broadcaster token fra DB som fallback');
        logSystemEvent({
          source: 'twitch_bot',
          event_type: 'TWITCH_BOT_USING_BROADCASTER_TOKEN',
          title: 'Twitch chat: bruker broadcaster token fra DB (TWITCH_BOT_OAUTH ikke satt)',
          severity: 'info',
          metadata: { channel: KANAL, wsId },
        });
      }
    }
  }

  if (!oauth) {
    console.log('  ⚠ TWITCH_BOT_OAUTH mangler og ingen broadcaster token — Twitch chat-bot ikke startet');
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'TWITCH_BOT_MISSING_OAUTH',
      title: 'Twitch chat-bot ikke startet — TWITCH_BOT_OAUTH mangler og ingen broadcaster token i DB',
      severity: 'error',
      metadata: { channel: KANAL, fix: 'Koble til Twitch på nytt med chat-scopes i Innstillinger, eller sett TWITCH_BOT_OAUTH i Railway' },
    });
    return;
  }

  client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username: botNavn, password: oauth },
    channels: [KANAL],
  });

  // tmi.js requires password in format "oauth:TOKEN". Warn early if missing prefix.
  const oauthHasPrefix = oauth.startsWith('oauth:');
  if (!oauthHasPrefix) {
    console.warn(`[twitchBot] TWITCH_BOT_OAUTH mangler "oauth:"-prefix — autentisering vil sannsynligvis feile. Forventet format: "oauth:TOKEN"`);
  }

  console.log(`[twitchBot] Kobler til #${KANAL} som bot="${botNavn}" | oauth-prefix=${oauthHasPrefix}`);

  client.connect().then(() => {
    _chatRetryCount = 0; // reset retry-teller ved vellykket tilkobling
    console.log(`  ✓ Twitch chat-bot koblet til #${KANAL}`);
    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'TWITCH_CHAT_JOINED',
      title: `Twitch chat-bot koblet til #${KANAL}`,
      severity: 'info',
      metadata: { channel: KANAL, botUsername: botNavn },
    });
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

        const streamIsLive = await isTwitchLive(process.env.WORKSPACE_ID ?? '').catch(() => false);
        if (!streamIsLive) return; // bare når live
        if (await getPausePartnerPromo().catch(() => false)) return;

        const minutesSinceLastPromo = (Date.now() - _sistePartnerPromo) / 60_000;

        // Phase 4+6: real-time state from Creator State (avgViewers30d cached at stream start)
        const _brainStream = getBrainState().stream;
        const decision = await decidePromotion({
          workspaceId: process.env.WORKSPACE_ID ?? '',
          game: _brainStream.game ?? '',
          viewerCount: _brainStream.viewerCount ?? 0,
          historicalAvgViewers: _brainStream.avgViewers30d ?? 0,
          chatMessagesLastMinute: _chatMsgsLastMinute,
          recentChatLines: [..._recentChatLines],
          minutesSinceLastPost: minutesSinceLastPromo,
          postsThisStream: _promoerDenneStream,
          settings,
          recentRaidAt: _sisteRaidTidspunkt,
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

    // Lurker engagement — every 18 min check if viewers >> chatters and ping lurkers
    let _sisteLurkerPing = 0;
    const LURKER_MIN_VIEWERS = 3;
    const LURKER_MAX_CHAT_PER_MIN = 4;
    const LURKER_COOLDOWN_MS = 22 * 60_000;

    setInterval(async () => {
      const lurkerStreamLive = await isTwitchLive(process.env.WORKSPACE_ID ?? '').catch(() => false);
      if (!lurkerStreamLive) return;
      if (Date.now() - _sisteLurkerPing < LURKER_COOLDOWN_MS) return;

      const viewerCount = getBrainState().stream.viewerCount ?? 0;
      if (viewerCount < LURKER_MIN_VIEWERS) return;
      if (_chatMsgsLastMinute > LURKER_MAX_CHAT_PER_MIN) return;

      const LURKER_MSGS = [
        `Ser at det er ${viewerCount} her inne — ikke vær redd for å si hei! Lurking er helt ok, men chatten er hyggelig 👋`,
        `Hei til alle ${viewerCount} seere! Vet at mange er stille — si gjerne hei om du vil, vi biter ikke 😊`,
        `${viewerCount} av dere er her nå! Mange lurker — det er supert. Men om du vil snakke litt er det bare å skrive noe 🙌`,
        `Hei alle som ser på! Lurking er en fin sport, men chatten er hyggelig å komme inn i — kom innom! PogChamp`,
        `Ser vi har ${viewerCount} seere! Om du er ny: hei og velkommen! Skriv gjerne hva du heter 👀`,
      ];
      const msg = LURKER_MSGS[Math.floor(Math.random() * LURKER_MSGS.length)];

      if (client) {
        await chatSend(`#${KANAL}`, msg, { trigger: 'lurker_engagement', viewerCount, chatMsgsLastMin: _chatMsgsLastMinute });
        _sisteLurkerPing = Date.now();
        logSystemEvent({
          source: 'twitch_bot',
          event_type: 'LURKER_ENGAGEMENT_SENT',
          title: `Lurker-hilsen sendt (${viewerCount} seere, ${_chatMsgsLastMinute} msgs/min)`,
          severity: 'info',
          metadata: { viewerCount, chatMsgsLastMinute: _chatMsgsLastMinute, channel: KANAL },
        });
      }
    }, 18 * 60_000);
  }).catch((err: Error) => {
    const raw = err.message ?? '';
    console.error(`  ✗ Twitch chat feil (kanal=#${KANAL} bot=${botNavn}): ${raw}`);

    // Categorize the failure so admin can act on it without reading raw TMI errors
    let reason: string;
    let fix: string;
    if (/login authentication failed|improperly formatted auth|invalid oauth/i.test(raw)) {
      reason = 'TWITCH_BOT_OAUTH er ugyldig eller utløpt';
      fix = 'Generer et nytt OAuth-token på https://twitchapps.com/tmi/ og oppdater TWITCH_BOT_OAUTH i Railway';
    } else if (!oauthHasPrefix) {
      reason = 'TWITCH_BOT_OAUTH mangler "oauth:"-prefix';
      fix = 'Sett TWITCH_BOT_OAUTH til "oauth:TOKEN" (ikke bare TOKEN)';
    } else if (/no response from twitch|etimedout|econnrefused|enotfound/i.test(raw)) {
      reason = 'Nettverksfeil — ingen respons fra Twitch TMI';
      fix = 'Sjekk nettverkstilgang fra Railway til irc.chat.twitch.tv:443';
    } else if (/error joining|bad_authentication/i.test(raw)) {
      reason = `Feil ved join av #${KANAL} — kanal finnes ikke eller token mangler chat-scope`;
      fix = 'Verifiser at TWITCH_USERNAME er korrekt Twitch-login og at tokenet har chat:read + chat:edit scope';
    } else if (/wrong username/i.test(raw)) {
      reason = `TWITCH_BOT_USERNAME="${botNavn}" matcher ikke tokenet`;
      fix = 'Sett TWITCH_BOT_USERNAME til brukernavn for kontoen tokenet tilhører';
    } else {
      reason = raw.slice(0, 150) || 'ukjent feil';
      fix = 'Se Railway-logg for full stacktrace';
    }

    logSystemEvent({
      source: 'twitch_bot',
      event_type: 'TWITCH_CHAT_JOIN_FAILED',
      title: `Twitch chat-bot feilet: ${reason}`,
      severity: 'error',
      metadata: {
        channel: KANAL,
        botUsername: botNavn,
        oauthPresent: !!oauth,
        oauthHasPrefix,
        reason,
        fix,
        rawError: raw.slice(0, 300),
      },
    });

    // Auth-feil: prøv på nytt med fersk broadcaster-token fra DB (maks 3 forsøk)
    // Nettverksfeil er allerede dekket av TMI sin innebygde reconnect: true
    const isAuthError = /login authentication failed|improperly formatted auth|invalid oauth|bad_authentication/i.test(raw);
    if (isAuthError && _chatRetryCount < 3) {
      _chatRetryCount++;
      const RETRY_DELAYS = [5, 15, 30];
      const delayMin = RETRY_DELAYS[_chatRetryCount - 1];
      logSystemEvent({
        source: 'twitch_bot',
        event_type: 'TWITCH_CHAT_RETRY_SCHEDULED',
        title: `Chat retry ${_chatRetryCount}/3 planlagt om ${delayMin} min — henter fersk token fra DB`,
        severity: 'warning',
        metadata: { retryCount: _chatRetryCount, delayMin, channel: KANAL,
          hint: 'Koble til Twitch på nytt i Innstillinger for å friske opp tokenet mens retrien venter' },
      });
      setTimeout(() => {
        startTwitchBot({ skipEnvOauth: true }).catch((e: any) =>
          console.error('[twitchBot] Chat retry kastet feil:', e?.message)
        );
      }, delayMin * 60_000);
    }
  });

  // ─── RAID ──────────────────────────────────────────────────────────────────

  client.on('raided', async (channel, username, viewers) => {
    _sisteRaidTidspunkt = Date.now();
    trackRaid(username, viewers);
    logBotAgentEvent({ source: 'twitch', event_type: 'raid', username, importance_score: Math.min(100, viewers / 2), metadata: { viewers } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_EVENT_RECEIVED', title: `Raid fra ${username}: ${viewers} seere`, severity: 'info', metadata: { type: 'raid', username, viewers } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Raidet kanalen med ${viewers} seere`, confidence_score: 0.8, metadata: { viewers, type: 'raider' } }).catch(() => {});

    const profileUrl = `twitch.tv/${username}`;
    const størrelse  = viewers >= 100 ? '🔥 MEGA-RAID' : viewers >= 50 ? '⚡ STOR RAID' : viewers >= 20 ? '🚀 RAID' : '🎮 Raid';

    // Melding 1 — umiddelbar hype
    const hype1 = viewers >= 20
      ? `${størrelse}!!! @${username} og ${viewers} raiders er i huset!!! KomodoHype KomodoHype KomodoHype`
      : `${størrelse}! @${username} raidet oss med ${viewers} seere! KomodoHype`;
    await chatSend(channel, hype1, { trigger: 'raid', username, viewers });

    // Melding 2 — AI shoutout med lenke (400ms delay)
    await new Promise(r => setTimeout(r, 400));
    const aiShoutout = await aiSvar(
      `${username} raidet kanalen med ${viewers} seere. Lag en kort, entusiastisk norsk shoutout (1 setning) som oppfordrer folk til å sjekke dem ut på ${profileUrl}. Nevn URL-en. Ikke bruk @-tegn.`
    );
    const shoutoutTekst = aiShoutout
      || `Gi MASSE kjærlighet til ${username} — dere MÅ sjekke dem ut på ${profileUrl} PogChamp`;
    await chatSend(channel, shoutoutTekst, { trigger: 'raid_shoutout', username, viewers });

    // Melding 3 — native Twitch /shoutout-kommando (800ms delay)
    await new Promise(r => setTimeout(r, 800));
    await chatSend(channel, `/shoutout ${username}`, { trigger: 'raid_so', username }).catch(() => {});

    await postTilDiscord(await getBotRaidKanalId() || liveKanalId(), {
      content: viewers >= 50 ? `@everyone 🚨 **MASSIVT RAID** innkommende!` : undefined,
      embeds: [{
        title: `${størrelse} fra ${username}!`,
        description:
          `**[${username}](https://twitch.tv/${username})** raidet oss med **${viewers} seere!** KomodoHype\n\n` +
          `Vis litt kjærlighet og følg dem: **[${profileUrl}](https://twitch.tv/${username})**`,
        color: viewers >= 50 ? 0xff6b00 : 0x9146ff,
        fields: [
          { name: '👥 Raiders', value: `**${viewers}**`, inline: true },
          { name: '🔗 Profil', value: `[twitch.tv/${username}](https://twitch.tv/${username})`, inline: true },
        ],
        footer: { text: 'Stream Control • Twitch Raid' },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── SUBSCRIPTION ──────────────────────────────────────────────────────────

  client.on('subscription', async (channel, username, _method, _message, userstate) => {
    logBotAgentEvent({ source: 'twitch', event_type: 'sub', username, importance_score: 80, metadata: { type: 'new_sub' } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Ny sub: ${username}`, severity: 'info', metadata: { type: 'new_sub', giver: username, mottaker: username } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Subscriber på ${BOT_BRAND}`, confidence_score: 0.85, metadata: { subscriber: true } }).catch(() => {});

    // Twitch chat hype
    const svar = await aiSvar(`${username} har nettopp subscripet for første gang! Lag en veldig entusiastisk, personlig norsk takkemelding. Maks 2 setninger.`);
    await chatSend(channel, svar || `@${username} TUSEN TAKK for subben! 💜 Du er absolutt en legende! FeelsGoodMan PartyTime`, { trigger: 'sub', username });
    await chatSend(channel, `LET'S GO chat — vi farmar subs! Hvem er neste?! PogChamp 🔥`, { trigger: 'sub_hype', username });
    _onSubCallback?.(username, (userstate as any)?.['user-id'], (userstate as any)?.['msg-param-sub-plan']).catch(() => {});

    // Discord hype — full embed med sub-farming energi
    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      embeds: [{
        title: `🌟 NY SUBSCRIBER — ${username}!`,
        description:
          `**${username}** subscribet akkurat til ${BOT_BRAND}! 💜\n\n` +
          `Vi FARMER subs — hvem er neste?! @here kom igjen! PogChamp 🔥`,
        color: 0x9146ff,
        fields: [
          { name: '💜 Subscriber', value: `**${username}**`, inline: true },
          { name: '🔴 Status', value: 'NY SUB!', inline: true },
        ],
        footer: { text: `${BOT_BRAND} • Twitch Sub` },
        timestamp: new Date().toISOString(),
      }],
    });
  });

  // ─── RESUB ─────────────────────────────────────────────────────────────────

  client.on('resub', async (channel, username, months, _message, userstate, _methods) => {
    logBotAgentEvent({ source: 'twitch', event_type: 'resub', username, importance_score: 75, metadata: { months } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_SUB_RECEIVED', title: `Resub: ${username} (${months} mnd)`, severity: 'info', metadata: { type: 'resub', giver: username, mottaker: username, months } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Lojal subscriber – ${months} måneder`, confidence_score: 0.9, metadata: { subscriber: true, months } }).catch(() => {});

    // Twitch chat
    const svar = await aiSvar(`${username} har hatt sub i ${months} måneder! Takk dem på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} ${months} måneder! Legendarisk lojalitet! PogChamp`, { trigger: 'resub', username, months });
    _onSubCallback?.(username, (userstate as any)?.['user-id'], (userstate as any)?.['msg-param-sub-plan']).catch(() => {});

    // Discord
    await postTilDiscord(await getSubsKanalId() || chatKanalId(), {
      content: `💜 **${username}** har hatt sub i **${months} måneder** — lojal legende! 👑 Vi farmer videre! PogChamp`,
    });
  });

  // ─── GIFT SUB ──────────────────────────────────────────────────────────────

  client.on('subgift', async (channel, username, _streakMonths, recipient, _methods, _userstate) => {
    trackGiftSub(username, 1);
    logBotAgentEvent({ source: 'twitch', event_type: 'giftsub', username, importance_score: 85, metadata: { recipient } });
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_GIFT_SUB_RECEIVED', title: `Gift sub: ${username} → ${recipient ?? 'ukjent'}`, severity: 'info', metadata: { type: 'gift_sub', giver: username, mottaker: recipient ?? 'ukjent', antall: 1 } });
    upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Gifter subs til community`, confidence_score: 0.85, metadata: { gifter: true } }).catch(() => {});
    const svar = await aiSvar(`${username} giftet sub til ${recipient}! Takk på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} gifter sub til @${recipient}! Sjenerøst! PogChamp`, { trigger: 'giftsub', username, recipient });
    // Gift recipient: user-id not available from gift event tags — use username fallback
    _onSubCallback?.(recipient, undefined, undefined).catch(() => {}); // recipient får sub-rollen
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
    logSystemEvent({ source: 'twitch_bot', event_type: 'TWITCH_BITS_RECEIVED', title: `${username} cheeret ${bitsNum} bits`, severity: 'info', metadata: { type: 'cheer', username, bits: bitsNum } });
    if (username !== 'Noen') upsertBotMemory({ agent_type: 'twitch', memory_type: 'viewer', key: username.toLowerCase(), summary: `Cheerer bits på ${BOT_BRAND}`, confidence_score: 0.8, metadata: { bits: bitsNum } }).catch(() => {});

    // Twitch chat
    const svar = await aiSvar(`${username} cheeret ${bits} bits! Takk på norsk. Maks 1 setning.`);
    await chatSend(channel, svar || `@${username} ${bits} bits!! Du er gal! PogChamp`, { trigger: 'cheer', username, bits });

    // Discord hype
    const bitsEmoji = bitsNum >= 1000 ? '🔥💎' : bitsNum >= 500 ? '🔥' : '💎';
    await postTilDiscord(chatKanalId() || liveKanalId(), {
      content: `${bitsEmoji} **${username}** cheeret **${bits} bits** til ${BOT_BRAND}! HYPE! PogChamp`,
    });
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

    // ── XP-tracking for Twitch-chattere ──────────────────────────────────────
    const twitchUid = (tags as any)['user-id'] ?? tags.username ?? brukernavn;
    const xpRes = addTwitchMessageXP(twitchUid, tags.username ?? brukernavn, tekst);
    if (xpRes) {
      if (xpRes.leveledUp) {
        const lvlEmoji = xpRes.newLevel >= 20 ? '👑' : xpRes.newLevel >= 10 ? '⭐' : '🎉';
        setTimeout(() => chatSend(channel,
          `${lvlEmoji} @${tags.username} gikk opp til Level ${xpRes.newLevel}! KomodoHype`,
          { trigger: 'level_up', username: tags.username }
        ).catch(() => {}), 800);
      }
      if (xpRes.nyeBadges.length > 0) {
        const badgeTekst = xpRes.nyeBadges.join(', ');
        setTimeout(() => chatSend(channel,
          `🏅 @${tags.username} låste opp: ${badgeTekst}! PogChamp`,
          { trigger: 'badge_unlock', username: tags.username }
        ).catch(() => {}), xpRes.leveledUp ? 2000 : 800);
      }
    }

    // ── !verify <kode> — Discord ↔ Twitch link-verifisering ─────────────────────
    if (tekLower.startsWith('!verify ') || tekLower === '!verify') {
      const parts  = tekst.trim().split(/\s+/);
      const code   = parts[1] ?? '';
      const twitchUserId = (tags as any)['user-id'] ?? '';
      if (code.length >= 4 && twitchUserId) {
        verifyLinkCode(twitchUserId, tags.username ?? brukernavn, code)
          .then(result => {
            if (result) {
              chatSend(channel,
                `✅ @${tags.username} — Twitch-kontoen din er nå koblet til Discord! 🔗 GlitchCat`,
                { trigger: 'verify_success', twitchUsername: tags.username },
              ).catch(() => {});
              // Notify Discord via callback if registered
              _onLinkVerifiedCallback?.(result.discordId, twitchUserId, tags.username ?? brukernavn, result.hasStoredSub ?? false);
            } else {
              client?.say(channel,
                `/w ${tags.username} Ugyldig eller utløpt kode. Bruk /linktwitch i Discord for ny kode.`,
              ).catch(() => {});
            }
          })
          .catch(() => {});
      }
      return;
    }

    // Promotion engine: per-minutt teller + rullende buffer
    _chatMsgsLastMinute++;
    _recentChatLines.push(`${tags.username}: ${tekst}`);
    if (_recentChatLines.length > 30) _recentChatLines = _recentChatLines.slice(-30);

    // Notify external handlers (e.g. Poll Manager vote collection)
    if (_externalChatHandlers.size > 0) {
      _externalChatHandlers.forEach(h => { try { h(tags.username ?? '', tekst); } catch {} });
    }

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
      await chatSend(channel, `@${tags.username} Discord er her: ${discordUrlChat || process.env.DISCORD_INVITE_URL || ''} PogChamp`, { trigger: 'discord_mention', username: tags.username });
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

export function sendTwitchPromoToChat(msg: string): void {
  void (async () => {
    const workspaceId = process.env.WORKSPACE_ID ?? '';
    const gate = await canPostToTwitch(workspaceId, 'partner_promo');
    if (!gate.allowed) {
      console.log(`[PostGate] Blocked Twitch post: ${gate.reason} — ${gate.detail}`);
      return;
    }
    const compliance = checkCompliance({
      content: msg,
      channel: 'twitch_chat',
      category: 'partner_promo',
      workspaceId,
    });
    if (!compliance.allowed) {
      console.log(`[COMPLIANCE_BLOCKED] ${compliance.ruleId}: ${compliance.reason}`);
      return;
    }
    void chatSend(`#${KANAL}`, msg, { trigger: 'approved_proposal' });
  })();
}

export function stopTwitchBot() {
  client?.disconnect();
  client = null;
}

// ─── Live Agent accessors ─────────────────────────────────────────────────────
// Read-only snapshots of chat state for the live agent loop.

export function getRecentChatLines(): string[] {
  return [..._recentChatLines];
}

export function getChatMsgsLastMinute(): number {
  return _chatMsgsLastMinute;
}

// ─── Poll Manager hooks ───────────────────────────────────────────────────────

export function sendTwitchChatMessage(msg: string): void {
  if (!client) return;
  void (async () => {
    const workspaceId = process.env.WORKSPACE_ID ?? '';
    const gate = await canPostToTwitch(workspaceId, 'system');
    if (!gate.allowed) {
      console.log(`[PostGate] Blocked Twitch post: ${gate.reason} — ${gate.detail}`);
      return;
    }
    const compliance = checkCompliance({
      content: msg,
      channel: 'twitch_chat',
      category: 'system',
      workspaceId,
    });
    if (!compliance.allowed) {
      console.log(`[COMPLIANCE_BLOCKED] ${compliance.ruleId}: ${compliance.reason}`);
      return;
    }
    client?.say(`#${KANAL}`, msg).catch(() => {});
    logSystemEvent({
      source: 'twitch_bot', event_type: 'BOT_CHAT_MESSAGE',
      title: msg.slice(0, 100), severity: 'info',
      metadata: { trigger: 'poll_manager', channel: KANAL },
    });
  })();
}

export function onTwitchChatMessage(handler: (username: string, message: string) => void): void {
  _externalChatHandlers.add(handler);
}

export function offTwitchChatMessage(handler: (username: string, message: string) => void): void {
  _externalChatHandlers.delete(handler);
}
