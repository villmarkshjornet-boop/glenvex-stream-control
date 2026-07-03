/**
 * rerollService — single source of truth for all persona card button interactions.
 *
 * Handles:
 *   - persona_reroll_<userId>  button
 *   - persona_share_<userId>   button
 *
 * Both entry points (global interactionCreate in index.ts and any active
 * in-message collector) call into this file. Because the global handler
 * fires for every button press regardless of collector state, it works
 * even after bot restarts or after the previous 60-second collector window.
 *
 * Flow (reroll):
 *   1. deferUpdate()          — Discord sees response in < 1 s
 *   2. editReply "generating" — user gets feedback in < 2 s
 *   3. genererPersona()       — 90 s hard timeout via Promise.race
 *   4. editReply with card    — show result or clean error
 *
 * Logging: every major step emits [REROLL] to Railway stdout.
 */

import {
  ButtonInteraction,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

import { getMember, upsertMember }            from './memberTracker';
import {
  genererPersona,
  hentSistePersona,
  renderPersonaCard,
  REROLL_COIN_COST,
  RARITY_COLOR,
  RARITY_BANNER,
}                                              from './personaService';
import { getBalance }                          from './coinService';
import { getActiveCard }                       from './cardCollectionService';
import { publishCardDrop }                     from './cardDropPublisher';
import { logSystemEvent }                      from './systemEvents';

const SHOWCASE_KANAL_ID = process.env.DISCORD_PERSONA_SHOWCASE_CHANNEL_ID ?? '';
const REROLL_TIMEOUT_MS = 90_000;

// ── Shared button row builder ─────────────────────────────────────────────────

export function lagPersonaKnappeRad(kortId: string, harNokCoins: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`persona_reroll_${kortId}`)
      .setLabel(`🔁 Reroll (${REROLL_COIN_COST} coins)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!harNokCoins),
    new ButtonBuilder()
      .setCustomId(`persona_share_${kortId}`)
      .setLabel('📢 Del i #persona-showcase')
      .setStyle(ButtonStyle.Primary),
  );
}

// ── Mini embed (mirrors persona.ts) ──────────────────────────────────────────

export function byggMiniEmbed(card: any, member: any, rerollCount: number, collectionNumber: number): EmbedBuilder {
  const banner = RARITY_BANNER[card.rarity as keyof typeof RARITY_BANNER] ?? card.rarity;
  return new EmbedBuilder()
    .setColor(RARITY_COLOR[card.rarity as keyof typeof RARITY_COLOR])
    .setTitle(`${banner}  ${card.title}`)
    .setDescription(
      `**${card.class}**  ·  ${card.archetype}\n` +
      `Lv ${member.level}  ·  ${member.xp} XP` +
      (rerollCount > 0 ? `  ·  Reroll #${rerollCount}` : '') +
      `  ·  Card #${String(collectionNumber).padStart(3, '0')}`,
    );
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutResult: T): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>(resolve => {
      handle = setTimeout(() => resolve(timeoutResult), ms);
    }),
  ]).finally(() => clearTimeout(handle));
}

// ── Reroll button handler ─────────────────────────────────────────────────────

export async function handlePersonaReroll(btn: ButtonInteraction): Promise<void> {
  const step = (s: string) => console.log(`[REROLL] ${s}`);

  step(`interaction received — customId=${btn.customId} userId=${btn.user.id}`);

  const kortId = btn.customId.replace('persona_reroll_', '');

  // Acknowledge immediately — must happen within 3 s or Discord shows "interaction failed"
  await btn.deferUpdate();
  step('deferUpdate OK');

  // Only the card owner can reroll their card
  if (btn.user.id !== kortId) {
    step(`ownership FAILED — presser=${btn.user.id} eier=${kortId}`);
    await btn.followUp({ content: '❌ Du kan bare rerulle ditt eget kort.', ephemeral: true });
    return;
  }

  // Get member — try cache first, fall back to stub (bot restart case)
  let member = getMember(kortId);
  if (!member) {
    step('cache miss — lager stub fra Discord-bruker');
    member = upsertMember(btn.user.id, btn.user.username, btn.user.displayName, {});
  }
  step(`member=${member.username} xp=${member.xp} level=${member.level}`);

  // Active card lock check
  const activeCard = await getActiveCard(kortId, 'persona');
  if (activeCard && activeCard.is_tradeable === false) {
    step('card is locked — reroll rejected');
    await btn.editReply({ content: '🔒 Kortet ditt er låst. Lås det opp i kortsamlingen før du rerullerer.', embeds: [], files: [], components: [] });
    logSystemEvent({
      source: 'bot_button', event_type: 'CARD_REROLL_FAILED',
      title:  `Reroll avvist — kort låst for ${member.username}`,
      severity: 'warning',
      metadata: { discordId: kortId, cardId: activeCard.id },
    });
    return;
  }
  step(`old card id=${activeCard?.id ?? 'none'}`);

  // Show generating state — user gets feedback before the long AI call
  const avatarUrl = btn.user.displayAvatarURL({ extension: 'png', size: 512 } as any);
  await btn.editReply({
    content:    `🔁 Regenererer kort... **${REROLL_COIN_COST} coins** trekkes ⏳\n*Ca. 20–40 sekunder*`,
    embeds:     [],
    files:      [],
    components: [],
  });
  step('shown generating state — calling genererPersona');

  logSystemEvent({
    source: 'bot_button', event_type: 'CARD_REROLL_STARTED',
    title:    `Reroll startet for ${member.username}`,
    severity: 'info',
    metadata: { discordId: kortId, username: member.username },
  });

  // Generate new card — hard timeout at 90 s
  const ny = await withTimeout(
    genererPersona(member, true, avatarUrl),
    REROLL_TIMEOUT_MS,
    { feil: 'Kortgenerering tok for lang tid (>90 sek). Prøv igjen om litt.' },
  );

  if ('feil' in ny) {
    step(`genererPersona FAILED: ${ny.feil}`);
    await btn.editReply({ content: `❌ ${ny.feil}`, embeds: [], files: [], components: [] });
    logSystemEvent({
      source: 'bot_button', event_type: 'CARD_REROLL_FAILED',
      title:    `Reroll feilet for ${member.username}: ${ny.feil}`,
      severity: 'error',
      metadata: { discordId: kortId, reason: ny.feil },
    });
    return;
  }

  step(`genererPersona OK — rarity=${ny.card.rarity} title=${ny.card.title} card#=${ny.collectionNumber}`);
  step(`db update success — ny community_cards rad lagret`);

  const nyBalance     = await getBalance(kortId);
  const nyHarNokCoins = nyBalance >= REROLL_COIN_COST;
  step(`discord edit success — nyBalance=${nyBalance}`);

  const knappeRad = lagPersonaKnappeRad(kortId, nyHarNokCoins);

  if (ny.cardPng) {
    const fil     = new AttachmentBuilder(ny.cardPng, { name: 'persona-card.png' });
    const nyEmbed = byggMiniEmbed(ny.card, member, ny.rerollCount, ny.collectionNumber);
    await btn.editReply({ files: [fil], embeds: [nyEmbed as any], components: [knappeRad] });
  } else {
    await btn.editReply({
      content:    `🔁 Rerollet! **${ny.card.rarity}** · Card #${String(ny.collectionNumber).padStart(3, '0')} (-${REROLL_COIN_COST} coins)`,
      components: [knappeRad],
    });
  }

  logSystemEvent({
    source: 'bot_button', event_type: 'CARD_REROLL_COMPLETED',
    title:    `Reroll fullført for ${member.username}: ${ny.card.rarity} ${ny.card.title}`,
    severity: 'info',
    metadata: { discordId: kortId, rarity: ny.card.rarity, title: ny.card.title, collectionNumber: ny.collectionNumber },
  });

  step(`completed — rarity=${ny.card.rarity} card#=${ny.collectionNumber}`);

  publishCardDrop({
    userId:          kortId,
    discordUsername: member.displayName,
    twitchUsername:  member.twitchUsername ?? null,
    cardType:        'persona',
    rarity:          ny.card.rarity,
    title:           ny.card.title,
    klass:           ny.card.class,
    archetype:       ny.card.archetype,
    level:           member.level,
    xp:              member.xp,
    coinsBalance:    nyBalance,
    cardNumber:      ny.collectionNumber,
    cardImageUrl:    ny.imageUrl,
    cardImageBuffer: ny.cardPng,
    source:          'persona_reroll',
  }).catch(() => {});
}

// ── Share button handler ──────────────────────────────────────────────────────

export async function handlePersonaShare(btn: ButtonInteraction): Promise<void> {
  const kortId = btn.customId.replace('persona_share_', '');

  if (btn.user.id !== kortId) {
    await btn.reply({ content: '❌ Du kan bare dele ditt eget kort.', ephemeral: true });
    return;
  }

  if (!SHOWCASE_KANAL_ID) {
    await btn.reply({ content: '⚠️ Showcase-kanal ikke konfigurert (DISCORD_PERSONA_SHOWCASE_CHANNEL_ID).', ephemeral: true });
    return;
  }

  await btn.deferUpdate();

  const eksisterende = await hentSistePersona(kortId);
  if (!eksisterende) {
    await btn.followUp({ content: '⚠️ Ingen persona funnet å dele. Kjør `/persona` først.', ephemeral: true });
    return;
  }

  try {
    const kanal = btn.guild?.channels.cache.get(SHOWCASE_KANAL_ID) as any;
    if (!kanal?.isTextBased?.()) {
      await btn.followUp({ content: '⚠️ Fant ikke showcase-kanalen.', ephemeral: true });
      return;
    }

    const member     = getMember(kortId);
    const avatarUrl  = btn.user.displayAvatarURL({ extension: 'png', size: 512 } as any);
    let   png: Buffer | null = null;

    if (member) {
      try {
        png = await renderPersonaCard(
          eksisterende.card,
          eksisterende.imageUrl,
          member,
          eksisterende.collectionNumber,
          avatarUrl,
        );
      } catch {}
    }

    const bannerTekst = `${RARITY_BANNER[eksisterende.card.rarity as keyof typeof RARITY_BANNER] ?? eksisterende.card.rarity}  **${eksisterende.card.title}**  ·  *${eksisterende.card.class}*`;

    if (png) {
      const fil = new AttachmentBuilder(png, { name: 'persona-card.png' });
      await kanal.send({ content: `🎴 <@${kortId}> deler sitt Persona Card!\n${bannerTekst}`, files: [fil] });
    } else {
      await kanal.send(`🎴 <@${kortId}> — **${eksisterende.card.title}** (${eksisterende.card.rarity})`);
    }

    await btn.followUp({ content: '✅ Persona Card delt i showcase!', ephemeral: true });
  } catch (e: any) {
    await btn.followUp({ content: `⚠️ Klarte ikke å dele: ${e.message}`, ephemeral: true });
  }
}
