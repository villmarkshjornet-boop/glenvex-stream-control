/**
 * subCardService — Sub-kort generator for Twitch-subscribers
 *
 * generateSubCard():
 *   - Sjekker duplikat FØR oppretting (idempotent)
 *   - Lagrer i community_cards: rarity='Sub', title='TWITCH SUB', class='Subscriber'
 *   - Poster lilla Discord-embed (#9146FF) til kortkanal
 *   - Logger alle system-events:
 *       SUB_CARD_GENERATED
 *       SUB_CARD_POSTED_TO_DISCORD
 *       SUB_CARD_SKIPPED_ALREADY_EXISTS
 *       SUB_CARD_SKIPPED_NO_DISCORD_LINK
 *       SUB_CARD_SKIPPED_NOT_SUB (brukes av kallere)
 */

import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

import { getBroadcasterId } from '@/lib/twitch';

const SUB_COLOR   = 0x9146ff; // Twitch purple
const DISCORD_API = 'https://discord.com/api/v10';

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

function botToken(): string {
  return process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN ?? '';
}

async function loadCardDropChannelId(workspaceId: string): Promise<string | null> {
  const sb = getSb();
  if (!sb) return null;
  try {
    const { data } = await sb
      .from('workspaces')
      .select('settings_json')
      .eq('id', workspaceId)
      .single();
    return (data as any)?.settings_json?.communityCardSettings?.discordCardDropChannelId ?? null;
  } catch {
    return null;
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

/**
 * Scannes alle nåværende Twitch-subs mot broadcaster_id og genererer manglende
 * sub-kort for Discord-brukere som allerede har koblet Twitch-kontoen.
 * Kalles ved bot-oppstart og kan kalles manuelt via admin-kommando.
 */
export async function backfillSubCards(
  workspaceId: string,
  broadcasterToken: string,
): Promise<{ checked: number; generated: number; skipped: number }> {
  const sb = getSb();
  if (!sb || !broadcasterToken) return { checked: 0, generated: 0, skipped: 0 };

  const clientId = process.env.TWITCH_CLIENT_ID ?? '';
  const broadcasterId = await getBroadcasterId().catch(() => null);
  if (!broadcasterId) return { checked: 0, generated: 0, skipped: 0 };

  // Hent alle nåværende subs fra Twitch (maks 100 — nok for kanaler under 100 subs)
  let twitchSubs: { user_id: string; user_login: string; user_name: string; tier: string }[] = [];
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=100`,
      { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-Id': clientId }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) {
      logSystemEvent({ workspaceId, source: 'sub_card', event_type: 'SUB_CARD_BACKFILL_ERROR',
        title: `Backfill: Twitch /subscriptions feilet HTTP ${res.status}`, severity: 'warning', metadata: { workspaceId } });
      return { checked: 0, generated: 0, skipped: 0 };
    }
    const body = await res.json() as { data?: typeof twitchSubs };
    // Filter out the broadcaster's own subscription entry
    twitchSubs = (body.data ?? []).filter(s => s.user_id !== broadcasterId);
  } catch (e: any) {
    logSystemEvent({ workspaceId, source: 'sub_card', event_type: 'SUB_CARD_BACKFILL_ERROR',
      title: `Backfill: Twitch API kastet feil: ${e?.message}`, severity: 'warning', metadata: { workspaceId } });
    return { checked: 0, generated: 0, skipped: 0 };
  }

  let generated = 0;
  let skipped   = 0;

  for (const sub of twitchSubs) {
    // Find the linked Discord member for this Twitch user
    const { data: member } = await sb
      .from('community_members')
      .select('discord_id, display_name, twitch_username')
      .eq('workspace_id', workspaceId)
      .eq('twitch_id', sub.user_id)
      .neq('member_type', 'merged')
      .limit(1)
      .maybeSingle();

    if (!member || member.discord_id.startsWith('tw_')) {
      skipped++;
      continue; // Twitch-only member, not linked to Discord
    }

    const result = await generateSubCard({
      workspaceId,
      discordId:      member.discord_id,
      twitchUsername: sub.user_login,
      displayName:    member.display_name ?? sub.user_name,
      subTier:        sub.tier,
    });

    if (result.ok) generated++;
    else skipped++;
  }

  logSystemEvent({
    workspaceId,
    source:     'sub_card',
    event_type: 'SUB_CARD_BACKFILL_COMPLETE',
    title:      `Sub-kort backfill ferdig: ${generated} generert, ${skipped} hoppet over av ${twitchSubs.length} subs`,
    severity:   'info',
    metadata:   { workspaceId, total: twitchSubs.length, generated, skipped },
  });

  return { checked: twitchSubs.length, generated, skipped };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubCardReason =
  | 'generated'
  | 'already_exists'
  | 'no_discord_link'
  | 'not_sub'
  | 'db_error';

export interface SubCardResult {
  ok:      boolean;
  reason:  SubCardReason;
  cardId?: string;
}

export interface GenerateSubCardParams {
  workspaceId:    string;
  discordId:      string;
  twitchUsername: string;
  displayName:    string;
  subTier?:       string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generer og post et SUB-kort for en Twitch-subscriber.
 * Innebygd duplikat-guard — trygt å kalle selv om kortet allerede finnes.
 *
 * Rarity = 'Sub' (Mythic-nivå visuelt, Twitch-lilla #9146FF)
 */
export async function generateSubCard(params: GenerateSubCardParams): Promise<SubCardResult> {
  const { workspaceId, discordId, twitchUsername, displayName, subTier } = params;

  // ── 0. Twitch-only members har ingen Discord-konto ────────────────────────
  if (discordId.startsWith('tw_')) {
    logSystemEvent({
      workspaceId,
      source:     'sub_card',
      event_type: 'SUB_CARD_SKIPPED_NO_DISCORD_LINK',
      title:      `Sub-kort hoppet over: ${twitchUsername} har ingen Discord-kobling`,
      severity:   'info',
      metadata:   { discordId, twitchUsername, workspaceId },
    });
    return { ok: false, reason: 'no_discord_link' };
  }

  const sb = getSb();
  if (!sb) {
    logSystemEvent({
      workspaceId,
      source:     'sub_card',
      event_type: 'SUB_CARD_SKIPPED_NO_DISCORD_LINK',
      title:      `Sub-kort hoppet over: ingen DB-tilkobling (${displayName})`,
      severity:   'warning',
      metadata:   { discordId, twitchUsername, workspaceId },
    });
    return { ok: false, reason: 'db_error' };
  }

  // ── 1. Duplikat-guard ─────────────────────────────────────────────────────
  try {
    const { data: existing } = await sb
      .from('community_cards')
      .select('id, card_image_url')
      .eq('workspace_id', workspaceId)
      .eq('user_id', discordId)
      .eq('card_type', 'sub')
      .limit(1)
      .maybeSingle();

    if (existing) {
      const existingId = (existing as any).id as string;
      // If card exists but has no image, backfill the URL now
      if (!(existing as any).card_image_url) {
        const imageUrl = buildSubCardImageUrl(displayName, twitchUsername, subTier ?? '1000');
        if (imageUrl) {
          await sb.from('community_cards').update({ card_image_url: imageUrl }).eq('id', existingId);
        }
      }
      logSystemEvent({
        workspaceId,
        source:     'sub_card',
        event_type: 'SUB_CARD_SKIPPED_ALREADY_EXISTS',
        title:      `Sub-kort finnes allerede for ${displayName} — hoppet over`,
        severity:   'info',
        metadata:   { discordId, twitchUsername, existingCardId: existingId, workspaceId },
      });
      return { ok: false, reason: 'already_exists' };
    }
  } catch (checkErr: any) {
    console.warn('[subCardService] Duplikat-sjekk feilet:', checkErr?.message);
    // Fortsett — bedre å prøve å opprette enn å blokkere ved midlertidig DB-feil
  }

  // ── 2. Opprett kort ───────────────────────────────────────────────────────
  const tierLabel = subTier === '2000' ? 'TIER 2' : subTier === '3000' ? 'TIER 3' : 'TIER 1';

  const { data: card, error } = await sb
    .from('community_cards')
    .insert({
      workspace_id:  workspaceId,
      user_id:       discordId,
      card_type:     'sub',
      rarity:        'Sub',
      title:         'TWITCH SUB',
      class:         'Subscriber',
      archetype:     `${tierLabel} SUPPORTER`,
      source:        'twitch_sub',
      status:        'active',
      is_active:     true,
      is_tradeable:  false,
      season:        process.env.PERSONA_SEASON ?? 'season_1',
      metadata: {
        twitchUsername,
        subTier:    subTier ?? '1000',
        tierLabel,
        awarded_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (error || !card) {
    console.error('[subCardService] Innsetting feilet:', error?.message);
    logSystemEvent({
      workspaceId,
      source:     'sub_card',
      event_type: 'SUB_CARD_SKIPPED_NO_DISCORD_LINK',
      title:      `Sub-kort DB-innsetting feilet for ${displayName}: ${error?.message ?? 'ukjent feil'}`,
      severity:   'error',
      metadata:   { discordId, twitchUsername, error: error?.message, workspaceId },
    });
    return { ok: false, reason: 'db_error' };
  }

  const cardId = (card as any).id as string;

  // ── 3. Generer og lagre kortbilde ─────────────────────────────────────────
  const imageUrl = await generateAndStoreSubCardImage({
    sb, workspaceId, discordId, displayName, twitchUsername, tierLabel, subTier: subTier ?? '1000',
  });
  if (imageUrl) {
    await sb.from('community_cards').update({ card_image_url: imageUrl }).eq('id', cardId);
  }

  logSystemEvent({
    workspaceId,
    source:     'sub_card',
    event_type: 'SUB_CARD_GENERATED',
    title:      `Sub-kort generert for ${displayName} (${twitchUsername}) — ${tierLabel}`,
    severity:   'info',
    metadata:   { discordId, twitchUsername, cardId, tierLabel, workspaceId, hasImage: !!imageUrl },
  });

  // ── 4. Post til Discord ───────────────────────────────────────────────────
  await postSubCardEmbed({ workspaceId, discordId, displayName, twitchUsername, tierLabel, cardId, imageUrl });

  return { ok: true, reason: 'generated', cardId };
}

// ── Sub-kort bildegenering ────────────────────────────────────────────────────

function buildSubCardImageUrl(displayName: string, twitchUsername: string, subTier: string): string | null {
  // APP_URL = the web app's public base URL (e.g. https://glenvex-stream-control-production.up.railway.app)
  // Falls back to GLENVEX_OAUTH_BASE or NEXT_PUBLIC_BASE_URL if APP_URL is not set.
  const baseUrl = (
    process.env.APP_URL ??
    process.env.GLENVEX_OAUTH_BASE ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    ''
  ).replace(/\/$/, '');
  if (!baseUrl) return null;

  const url = new URL(`${baseUrl}/api/cards/sub-card-image`);
  url.searchParams.set('displayName',    displayName);
  url.searchParams.set('twitchUsername', twitchUsername);
  url.searchParams.set('tier',           subTier);
  return url.toString();
}

// kept for future use (pre-generate + upload flow)
async function generateAndStoreSubCardImage(p: {
  sb:            ReturnType<typeof getSb>;
  workspaceId:   string;
  discordId:     string;
  displayName:   string;
  twitchUsername:string;
  tierLabel:     string;
  subTier:       string;
}): Promise<string | null> {
  // Prefer a simple dynamic URL — Discord and the web app can both fetch it on demand.
  // Falls back to null if APP_URL is not configured (web-app backfill endpoint will fix it later).
  return buildSubCardImageUrl(p.displayName, p.twitchUsername, p.subTier);
}

// ── Discord embed ─────────────────────────────────────────────────────────────

interface PostParams {
  workspaceId:    string;
  discordId:      string;
  displayName:    string;
  twitchUsername: string;
  tierLabel:      string;
  cardId:         string;
  imageUrl:       string | null;
}

async function postSubCardEmbed(p: PostParams): Promise<void> {
  const channelId = await loadCardDropChannelId(p.workspaceId);
  if (!channelId) {
    // no channel configured — silently skip Discord post but card is in DB
    logSystemEvent({
      workspaceId: p.workspaceId,
      source:      'sub_card',
      event_type:  'SUB_CARD_POSTED_TO_DISCORD',
      title:       `Sub-kort Discord-post hoppet over: ingen kortkanal konfigurert for ${p.displayName}`,
      severity:    'warning',
      metadata:    {
        discordId:      p.discordId,
        twitchUsername: p.twitchUsername,
        cardId:         p.cardId,
        workspaceId:    p.workspaceId,
        fix:            'Innstillinger → Community Cards → Velg kortkanal (discordCardDropChannelId)',
      },
    });
    return;
  }

  const token = botToken();
  if (!token) return;

  const embed: Record<string, unknown> = {
    title:       `\u{1F49C} ${p.displayName} er nå Twitch Sub!`,
    description: `**${p.twitchUsername}** har koblet sin Twitch-konto og er subscriber!\n` +
                 `Et eksklusivt **SUB-kort** er lagt til i samlingen.\n` +
                 `Bruk \`/minekort\` for å se det.`,
    color:       SUB_COLOR,
    fields: [
      { name: 'Rarity',   value: '⭐ Sub',              inline: true },
      { name: 'Klasse',   value: 'Subscriber',           inline: true },
      { name: 'Tier',     value: p.tierLabel,            inline: true },
      { name: 'Discord',  value: `<@${p.discordId}>`,   inline: true },
      { name: 'Twitch',   value: p.twitchUsername,       inline: true },
    ],
    footer:    { text: 'Kortet er lagt til i din samling' },
    timestamp: new Date().toISOString(),
    ...(p.imageUrl ? { image: { url: p.imageUrl } } : {}),
  };

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method:  'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embeds: [embed] }),
      signal:  AbortSignal.timeout(10_000),
    });

    logSystemEvent({
      workspaceId: p.workspaceId,
      source:      'sub_card',
      event_type:  'SUB_CARD_POSTED_TO_DISCORD',
      title:       res.ok
        ? `Sub-kort postet i Discord for ${p.displayName}`
        : `Sub-kort Discord-post feilet (HTTP ${res.status}) for ${p.displayName}`,
      severity: res.ok ? 'info' : 'warning',
      metadata: {
        discordId:      p.discordId,
        twitchUsername: p.twitchUsername,
        channelId,
        cardId:         p.cardId,
        httpStatus:     res.status,
        workspaceId:    p.workspaceId,
      },
    });
  } catch (e: any) {
    logSystemEvent({
      workspaceId: p.workspaceId,
      source:      'sub_card',
      event_type:  'SUB_CARD_POSTED_TO_DISCORD',
      title:       `Sub-kort Discord-post kastet feil for ${p.displayName}: ${e?.message}`,
      severity:    'error',
      metadata:    {
        discordId:      p.discordId,
        twitchUsername: p.twitchUsername,
        channelId,
        cardId:         p.cardId,
        error:          e?.message,
        workspaceId:    p.workspaceId,
      },
    });
  }
}
