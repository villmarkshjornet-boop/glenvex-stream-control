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
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', discordId)
      .eq('card_type', 'sub')
      .limit(1)
      .maybeSingle();

    if (existing) {
      logSystemEvent({
        workspaceId,
        source:     'sub_card',
        event_type: 'SUB_CARD_SKIPPED_ALREADY_EXISTS',
        title:      `Sub-kort finnes allerede for ${displayName} — hoppet over`,
        severity:   'info',
        metadata:   {
          discordId,
          twitchUsername,
          existingCardId: (existing as any).id as string,
          workspaceId,
        },
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

  logSystemEvent({
    workspaceId,
    source:     'sub_card',
    event_type: 'SUB_CARD_GENERATED',
    title:      `Sub-kort generert for ${displayName} (${twitchUsername}) — ${tierLabel}`,
    severity:   'info',
    metadata:   { discordId, twitchUsername, cardId, tierLabel, workspaceId },
  });

  // ── 3. Post til Discord ───────────────────────────────────────────────────
  await postSubCardEmbed({ workspaceId, discordId, displayName, twitchUsername, tierLabel, cardId });

  return { ok: true, reason: 'generated', cardId };
}

// ── Discord embed ─────────────────────────────────────────────────────────────

interface PostParams {
  workspaceId:    string;
  discordId:      string;
  displayName:    string;
  twitchUsername: string;
  tierLabel:      string;
  cardId:         string;
}

async function postSubCardEmbed(p: PostParams): Promise<void> {
  const channelId = await loadCardDropChannelId(p.workspaceId);
  if (!channelId) {
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

  // Mythic-nivå visuell, Twitch-lilla ramme
  const embed = {
    title:       `\u{1F49C} ${p.displayName} er nå Twitch Sub!`,
    description: `**${p.twitchUsername}** har koblet sin Twitch-konto og er subscriber!\n` +
                 `Et eksklusivt **SUB-kort** er lagt til i samlingen.\n` +
                 `Bruk \`/minekort\` for å se det.`,
    color:       SUB_COLOR,
    fields: [
      { name: 'Rarity',   value: '⭐ Sub',         inline: true },
      { name: 'Klasse',   value: 'Subscriber',          inline: true },
      { name: 'Tier',     value: p.tierLabel,           inline: true },
      { name: 'Korttype', value: 'TWITCH SUB',          inline: true },
      { name: 'Discord',  value: `<@${p.discordId}>`,  inline: true },
      { name: 'Twitch',   value: p.twitchUsername,      inline: true },
    ],
    footer:    { text: 'Kortet er lagt til i din samling' },
    timestamp: new Date().toISOString(),
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
