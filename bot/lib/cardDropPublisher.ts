/**
 * cardDropPublisher — felles publisering av card drop events
 *
 * Kalles etter vellykket generering/lagring av nytt kort.
 * Leser communityCardSettings fra workspaces.settings_json og:
 *   1. Poster kortbildet som attachment i valgt Discord-kanal
 *   2. Sender DM til brukeren
 *   3. Sender Twitch-chat-varsel
 *   4. Logger til community_card_drop_events
 */

import { createClient } from '@supabase/supabase-js';
import { sendTwitchChatMessage } from './twitchBot';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';
const DISCORD_API  = 'https://discord.com/api/v10';

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CardDropEvent {
  userId:           string;
  discordUsername:  string;
  twitchUsername?:  string | null;
  cardId?:          string | null;
  cardType:         string;
  rarity:           string;
  title:            string;
  klass?:           string | null;
  archetype?:       string | null;
  level:            number;
  xp:               number;
  coinsBalance:     number;
  cardNumber?:      number | null;
  cardImageUrl?:    string | null;
  cardImageBuffer?: Buffer | null;
  source: 'persona_reroll' | 'sub' | 'achievement' | 'milestone' | 'admin_generate';
}

export interface CommunityCardSettings {
  discordCardDropChannelEnabled:       boolean;
  discordCardDropChannelId:            string | null;
  discordCardDropDmEnabled:            boolean;
  twitchCardDropNotificationsEnabled:  boolean;
}

const SETTINGS_DEFAULTS: CommunityCardSettings = {
  discordCardDropChannelEnabled:      false,
  discordCardDropChannelId:           null,
  discordCardDropDmEnabled:           true,
  twitchCardDropNotificationsEnabled: false,
};

// ── Settings loader ───────────────────────────────────────────────────────────

async function loadSettings(wsId: string): Promise<CommunityCardSettings> {
  const sb = getSb();
  if (!sb) return SETTINGS_DEFAULTS;
  try {
    const { data } = await sb
      .from('workspaces')
      .select('settings_json')
      .eq('id', wsId)
      .single();
    const sj = (data as any)?.settings_json ?? {};
    return { ...SETTINGS_DEFAULTS, ...(sj.communityCardSettings ?? {}) };
  } catch {
    return SETTINGS_DEFAULTS;
  }
}

// ── Discord REST helpers ──────────────────────────────────────────────────────

function botToken(): string {
  return process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN ?? '';
}

async function discordPost(
  channelId: string,
  payload: object,
  imageBuf?: Buffer | null,
): Promise<boolean> {
  const token = botToken();
  if (!token) return false;

  const url = `${DISCORD_API}/channels/${channelId}/messages`;
  try {
    if (imageBuf) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', new Blob([imageBuf], { type: 'image/png' }), 'kort.png');
      const res = await fetch(url, {
        method:  'POST',
        headers: { Authorization: `Bot ${token}` },
        body:    form,
        signal:  AbortSignal.timeout(20_000),
      });
      return res.ok;
    } else {
      const res = await fetch(url, {
        method:  'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      });
      return res.ok;
    }
  } catch {
    return false;
  }
}

async function openDmChannel(userId: string): Promise<string | null> {
  const token = botToken();
  if (!token) return null;
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method:  'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ recipient_id: userId }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

// ── Embed builders ────────────────────────────────────────────────────────────

const RARITY_COLOR: Record<string, number> = {
  Common:    0x9e9e9e,
  Rare:      0x1565c0,
  Epic:      0x7b1fa2,
  Legendary: 0xf9a825,
  Mythic:    0xd50000,
};

function channelPayload(event: CardDropEvent, withBuf: boolean): object {
  const banners: Record<string, string> = {
    Mythic: '⚡', Legendary: '✨', Epic: '✨', Rare: '💎', Common: '🎴',
  };
  const banner  = banners[event.rarity] ?? '🎴';
  const color   = RARITY_COLOR[event.rarity] ?? 0x9e9e9e;
  const cardNum = event.cardNumber ? `Card #${String(event.cardNumber).padStart(3, '0')}` : '';

  let title: string;
  let desc:  string;

  if (event.rarity === 'Mythic') {
    title = `${banner} MYTHIC CARD DROP!`;
    desc  = `**${event.discordUsername}** låste opp et **MYTHIC**-kort!\n**${event.title}**`;
    if (event.klass) desc += `\nClass: ${event.klass}`;
    if (cardNum)     desc += `  ·  ${cardNum}`;
    desc += '\nHele communityet kan gratulere! 🎉';
  } else if (event.rarity === 'Legendary') {
    title = `${banner} LEGENDARY CARD DROP!`;
    desc  = `**${event.discordUsername}** trakk **${event.title}**!\nDette kortet er sjeldent.`;
    if (event.klass) desc += `\nClass: ${event.klass}`;
    if (cardNum)     desc += `  ·  ${cardNum}`;
  } else {
    title = `${banner} Nytt samlekort trukket!`;
    desc  = `**${event.discordUsername}** fikk et **${event.rarity.toUpperCase()}**-kort: **${event.title}**`;
    if (event.klass) desc += `\nClass: ${event.klass}`;
    if (cardNum)     desc += `  ·  ${cardNum}`;
  }

  const embed: Record<string, any> = { title, description: desc, color };
  if (withBuf) {
    embed.image = { url: 'attachment://kort.png' };
  } else if (event.cardImageUrl) {
    embed.image = { url: event.cardImageUrl };
  }

  return { embeds: [embed] };
}

function dmPayload(event: CardDropEvent, withBuf: boolean): object {
  const color   = RARITY_COLOR[event.rarity] ?? 0x9e9e9e;
  const cardNum = event.cardNumber ? String(event.cardNumber).padStart(3, '0') : null;

  let desc = `**Rarity:** ${event.rarity}\n**Kort:** ${event.title}`;
  if (event.klass)     desc += `\n**Class:** ${event.klass}`;
  if (event.archetype) desc += `\n**Archetype:** ${event.archetype}`;
  if (cardNum)         desc += `\n**Card #:** ${cardNum}`;
  desc += `\n**Coins igjen:** ${event.coinsBalance}`;

  const embed: Record<string, any> = {
    title:       '🎴 Du fikk et nytt GLENVEX Samlekort!',
    description: desc,
    color,
  };
  if (withBuf) {
    embed.image = { url: 'attachment://kort.png' };
  } else if (event.cardImageUrl) {
    embed.image = { url: event.cardImageUrl };
  }

  return { embeds: [embed] };
}

function twitchMessage(event: CardDropEvent): string {
  const name = event.twitchUsername ?? event.discordUsername;
  switch (event.rarity) {
    case 'Mythic':    return `⚡ MYTHIC CARD DROP! ${name} fikk et MYTHIC kort! Sjekk Discord-kortkanalen!`;
    case 'Legendary': return `✨ LEGENDARY CARD DROP! ${name} fikk ${event.title}!`;
    case 'Epic':      return `✨ ${name} trakk et EPIC kort: ${event.title}!`;
    case 'Rare':      return `💎 ${name} trakk et RARE kort: ${event.title}!`;
    default:          return `🎴 ${name} fikk just et ${event.rarity.toUpperCase()} samlekort: ${event.title}!`;
  }
}

// ── DB log ────────────────────────────────────────────────────────────────────

async function logDropEvent(
  event: CardDropEvent,
  result: { channelPosted: boolean; dmSent: boolean; twitchSent: boolean; error?: string },
): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  try {
    await sb.from('community_card_drop_events').insert({
      workspace_id:           WORKSPACE_ID,
      user_id:                event.userId,
      card_id:                event.cardId ?? null,
      rarity:                 event.rarity,
      card_type:              event.cardType,
      source:                 event.source,
      discord_channel_posted: result.channelPosted,
      dm_sent:                result.dmSent,
      twitch_sent:            result.twitchSent,
      error:                  result.error ?? null,
      metadata: {
        title:       event.title,
        klass:       event.klass ?? null,
        level:       event.level,
        xp:          event.xp,
        coinsBalance: event.coinsBalance,
      },
    });
  } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function publishCardDrop(event: CardDropEvent): Promise<void> {
  logSystemEvent({
    source:     'card_drop',
    event_type: 'CARD_DROP_PUBLISH_STARTED',
    title:      `Card drop: ${event.title} (${event.rarity}) for ${event.discordUsername}`,
    severity:   'info',
    metadata:   { userId: event.userId, rarity: event.rarity, source: event.source },
  });

  const settings = await loadSettings(WORKSPACE_ID);
  const hasBuf   = !!event.cardImageBuffer;
  const result   = { channelPosted: false, dmSent: false, twitchSent: false, error: undefined as string | undefined };

  // ── 1. Discord channel — post hvis channelId er konfigurert (enabled-flagg valgfritt) ──
  if (settings.discordCardDropChannelId) {
    try {
      const ok = await discordPost(
        settings.discordCardDropChannelId,
        channelPayload(event, hasBuf),
        event.cardImageBuffer,
      );
      result.channelPosted = ok;
      const isPurchase = event.source === 'persona_reroll';
      logSystemEvent({
        source:     'card_drop',
        event_type: ok
          ? (isPurchase ? 'CARD_PURCHASE_POSTED' : 'CARD_DRAW_POSTED')
          : 'CARD_CHANNEL_SEND_FAILED',
        title:      ok
          ? `${isPurchase ? 'Kjøp' : 'Korttrekk'} postet i kanal: ${event.title}`
          : `Kanalpost feilet: ${event.title}`,
        severity:   ok ? 'info' : 'warning',
        metadata:   { channelId: settings.discordCardDropChannelId, source: event.source },
      });
    } catch (e: any) {
      result.error = e?.message;
      logSystemEvent({ source: 'card_drop', event_type: 'CARD_CHANNEL_SEND_FAILED', title: `Kanalpost kastet feil: ${e?.message}`, severity: 'error', metadata: {} });
    }
  } else {
    logSystemEvent({ source: 'card_drop', event_type: 'CARD_DROP_CHANNEL_SKIPPED', title: 'Kanalpost ikke aktivert (ingen channelId i settings)', severity: 'info', metadata: {} });
  }

  // ── 2. DM ─────────────────────────────────────────────────────────────────
  if (settings.discordCardDropDmEnabled && event.userId && !event.userId.startsWith('tw_')) {
    try {
      const dmChannelId = await openDmChannel(event.userId);
      if (dmChannelId) {
        const ok = await discordPost(dmChannelId, dmPayload(event, hasBuf), event.cardImageBuffer);
        result.dmSent = ok;
        logSystemEvent({
          source:     'card_drop',
          event_type: ok ? 'CARD_DROP_DM_SENT' : 'CARD_DM_FAILED',
          title:      ok ? `DM sendt for ${event.title}` : `DM feilet for ${event.title}`,
          severity:   ok ? 'info' : 'warning',
          metadata:   {},
        });
      } else {
        logSystemEvent({ source: 'card_drop', event_type: 'CARD_DM_FAILED', title: 'Kunne ikke åpne DM-kanal', severity: 'warning', metadata: {} });
      }
    } catch (e: any) {
      logSystemEvent({ source: 'card_drop', event_type: 'CARD_DM_FAILED', title: `DM kastet feil: ${e?.message}`, severity: 'warning', metadata: {} });
    }
  }

  // ── 3. Twitch ─────────────────────────────────────────────────────────────
  if (settings.twitchCardDropNotificationsEnabled) {
    try {
      sendTwitchChatMessage(twitchMessage(event));
      result.twitchSent = true;
      logSystemEvent({ source: 'card_drop', event_type: 'CARD_DROP_TWITCH_SENT', title: `Twitch-varsel sendt: ${event.title}`, severity: 'info', metadata: {} });
    } catch (e: any) {
      logSystemEvent({ source: 'card_drop', event_type: 'CARD_DROP_TWITCH_FAILED', title: `Twitch-varsel feilet: ${e?.message}`, severity: 'warning', metadata: {} });
    }
  } else {
    logSystemEvent({ source: 'card_drop', event_type: 'CARD_DROP_TWITCH_SKIPPED', title: 'Twitch-varsel ikke aktivert', severity: 'info', metadata: {} });
  }

  await logDropEvent(event, result);
}
