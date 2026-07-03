import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  getMemberCards,
  sellCard,
  setShowcaseCard,
  getShowcaseCard,
  getSellPrice,
  CardRecord,
} from '../lib/cardService';

// ── Rarity display helpers ─────────────────────────────────────────────────────

const RARITY_BANNER: Record<string, string> = {
  Mythic:    '🔴 MYTHIC',
  Legendary: '🟧 LEGENDARY',
  Epic:      '🟪 EPIC',
  Rare:      '🟦 RARE',
  Uncommon:  '🟩 UNCOMMON',
  Common:    '⬜ COMMON',
};

const RARITY_COLOR: Record<string, number> = {
  Mythic:    0xef4444,
  Legendary: 0xf97316,
  Epic:      0xa855f7,
  Rare:      0x3b82f6,
  Uncommon:  0x22c55e,
  Common:    0x9ca3af,
};

const RARITY_EMOJI: Record<string, string> = {
  Mythic:    '🔴',
  Legendary: '🟧',
  Epic:      '🟪',
  Rare:      '🟦',
  Uncommon:  '🟩',
  Common:    '⬜',
};

function rarityEmoji(rarity: string): string {
  return RARITY_EMOJI[rarity] ?? '🎴';
}

// ── Command definition ─────────────────────────────────────────────────────────

export const minekortCommand = {
  data: new SlashCommandBuilder()
    .setName('minekort')
    .setDescription('Se dine GLENVEX-kort, selg dem eller sett showcase-kort.'),

  execute,
};

// ── Execute: show oversikt view ────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction,
  workspaceId: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });
  await renderOversikt(interaction, workspaceId);
}

// ── Oversikt ───────────────────────────────────────────────────────────────────

async function renderOversikt(
  interaction: ChatInputCommandInteraction,
  workspaceId: string,
): Promise<void> {
  const userId = interaction.user.id;

  const [cards, showcase] = await Promise.all([
    getMemberCards(workspaceId, userId, 'all'),
    getShowcaseCard(workspaceId, userId),
  ]);

  const activeCards = cards.filter((c: CardRecord) => c.status !== 'sold');
  const total = activeCards.length;

  // Rarity breakdown
  const rarityCounts: Record<string, number> = {};
  for (const c of activeCards) {
    rarityCounts[c.rarity] = (rarityCounts[c.rarity] ?? 0) + 1;
  }
  const rarityOrder = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
  const rarityBreakdown = rarityOrder
    .filter(r => rarityCounts[r])
    .map(r => `${rarityEmoji(r)} ${rarityCounts[r] ?? 0} ${r}`)
    .join('  ');

  const collectionValue = total > 0
    ? `**${total} kort**\n${rarityBreakdown}`
    : '*Ingen kort ennå — bruk `/persona` for å lage ditt første!*';

  const showcaseValue = showcase
    ? `${rarityEmoji(showcase.rarity)} **${showcase.title}** (${showcase.rarity})`
    : '*Ikke satt*';

  const sorted = [...activeCards].sort(
    (a: CardRecord, b: CardRecord) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const siste5 = sorted.slice(0, 5);
  const sisteStr = siste5.length > 0
    ? siste5.map((c: CardRecord) => `${rarityEmoji(c.rarity)} **${c.title}** (${c.rarity})`).join('\n')
    : '*Ingen kort ennå*';

  const embed = new EmbedBuilder()
    .setColor(0xf9a825)
    .setTitle(`🎴 Mine kort — ${interaction.user.displayName ?? interaction.user.username}`)
    .addFields(
      { name: '📦 Samling',      value: collectionValue, inline: false },
      { name: '⭐ Showcase-kort', value: showcaseValue,   inline: false },
      { name: '🕐 Siste 5 kort', value: sisteStr,         inline: false },
    )
    .setFooter({ text: 'Bla gjennom kortene dine for å selge eller velge showcase.' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mekort_browse_${userId}_0`)
      .setLabel('Bla gjennom kort')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total === 0),
    new ButtonBuilder()
      .setCustomId(`mekort_trekk_${userId}`)
      .setLabel('Trekk nytt')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── Browse view (one card at a time, paginated) ────────────────────────────────

async function renderBrowse(
  btn: ButtonInteraction,
  workspaceId: string,
  userId: string,
  page: number,
): Promise<void> {
  const cards = await getMemberCards(workspaceId, userId, 'active');
  const total = cards.length;

  if (total === 0) {
    await btn.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9ca3af)
          .setTitle('🎴 Ingen aktive kort')
          .setDescription('Du har ingen aktive kort. Bruk `/persona` for å trekke ditt første!'),
      ],
      components: [],
    });
    return;
  }

  const clampedPage = Math.max(0, Math.min(page, total - 1));
  const card = cards[clampedPage];
  if (!card) return;

  const price = getSellPrice(card.rarity);
  const statusLabel = card.status === 'sold'
    ? 'Solgt'
    : card.isActive
      ? 'Aktivt'
      : 'Normal';

  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[card.rarity] ?? 0x9ca3af)
    .setTitle(`${rarityEmoji(card.rarity)} ${card.title}`)
    .addFields(
      {
        name:   'Klasse / Archetype',
        value:  `${card.cardClass ?? '—'} / ${card.archetype ?? '—'}`,
        inline: true,
      },
      {
        name:   'Kortnr',
        value:  card.cardNumber != null ? `#${card.cardNumber}` : '—',
        inline: true,
      },
      { name: 'Status', value: statusLabel, inline: true },
    )
    .setFooter({ text: `Kort ${clampedPage + 1} av ${total} · ${card.rarity}` });

  if (card.cardImageUrl) {
    embed.setImage(card.cardImageUrl);
  }

  const isSold = card.status === 'sold';

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mekort_prev_${userId}_${clampedPage}`)
      .setLabel('◀ Forrige')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage === 0),
    new ButtonBuilder()
      .setCustomId(`mekort_next_${userId}_${clampedPage}`)
      .setLabel('▶ Neste')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage === total - 1),
    new ButtonBuilder()
      .setCustomId(`card_sell_${card.id}`)
      .setLabel(`💰 Selg (${price} 🪙)`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isSold),
    new ButtonBuilder()
      .setCustomId(`card_showcase_${card.id}`)
      .setLabel('⭐ Showcase')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isSold),
    new ButtonBuilder()
      .setCustomId(`mekort_trekk_${userId}`)
      .setLabel('🎴 Trekk nytt')
      .setStyle(ButtonStyle.Primary),
  );

  await btn.update({ embeds: [embed], components: [row] });
}

// ── Button handler (exported for use in index.ts) ──────────────────────────────

export async function handleMinekortButton(
  btn: ButtonInteraction,
  workspaceId: string,
): Promise<void> {
  const cid      = btn.customId;
  const viewerId = btn.user.id;

  // ── Browse navigation: mekort_browse_{userId}_{page}
  //                       mekort_prev_{userId}_{page}
  //                       mekort_next_{userId}_{page}  ─────────────────────────
  if (
    cid.startsWith('mekort_browse_') ||
    cid.startsWith('mekort_prev_')   ||
    cid.startsWith('mekort_next_')
  ) {
    const parts   = cid.split('_');
    // e.g. ['mekort', 'browse', '123456789', '0']
    const userId  = parts[2] ?? '';
    const rawPage = parseInt(parts[3] ?? '0', 10);

    if (userId !== viewerId) {
      await btn.reply({ content: '❌ Du kan bare bla gjennom dine egne kort.', ephemeral: true });
      return;
    }

    let targetPage = rawPage;
    if (cid.startsWith('mekort_prev_')) targetPage = Math.max(0, rawPage - 1);
    if (cid.startsWith('mekort_next_')) targetPage = rawPage + 1;

    await renderBrowse(btn, workspaceId, userId, targetPage);
    return;
  }

  // ── Trekk nytt: mekort_trekk_{userId} ─────────────────────────────────────
  if (cid.startsWith('mekort_trekk_')) {
    const userId = cid.slice('mekort_trekk_'.length);
    if (userId !== viewerId) {
      await btn.reply({ content: '❌ Du kan bare trekke dine egne kort.', ephemeral: true });
      return;
    }
    await btn.reply({
      content:   '🎴 Trekker nytt kort… bruk `/persona` for å trekke ditt neste kort!',
      ephemeral: true,
    });
    return;
  }

  // ── Sell confirm: card_sell_confirm_{cardId} ───────────────────────────────
  if (cid.startsWith('card_sell_confirm_')) {
    const cardId = cid.slice('card_sell_confirm_'.length);
    const cards  = await getMemberCards(workspaceId, viewerId, 'all');
    const card   = cards.find((c: CardRecord) => c.id === cardId);

    if (!card) {
      await btn.update({ content: '❌ Kortet ble ikke funnet.', embeds: [], components: [] });
      return;
    }

    const price  = getSellPrice(card.rarity);
    const result = await sellCard(workspaceId, viewerId, cardId);

    await btn.update({
      content:    `✅ **${card.title}** solgt for **${price} 🪙**! Ny saldo: 🪙 ${result.newBalance}`,
      embeds:     [],
      components: [],
    });
    return;
  }

  // ── Sell cancel: card_sell_cancel_{cardId} ─────────────────────────────────
  if (cid.startsWith('card_sell_cancel_')) {
    await btn.update({ content: '❌ Salg avbrutt.', embeds: [], components: [] });
    return;
  }

  // ── Show sell confirmation: card_sell_{cardId} ─────────────────────────────
  if (cid.startsWith('card_sell_')) {
    const cardId = cid.slice('card_sell_'.length);
    const cards  = await getMemberCards(workspaceId, viewerId, 'all');
    const card   = cards.find((c: CardRecord) => c.id === cardId);

    if (!card) {
      await btn.reply({ content: '❌ Kortet ble ikke funnet.', ephemeral: true });
      return;
    }
    if (card.status === 'sold') {
      await btn.reply({ content: '❌ Dette kortet er allerede solgt.', ephemeral: true });
      return;
    }

    const price      = getSellPrice(card.rarity);
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`card_sell_confirm_${cardId}`)
        .setLabel('✅ Bekreft salg')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`card_sell_cancel_${cardId}`)
        .setLabel('❌ Avbryt')
        .setStyle(ButtonStyle.Secondary),
    );

    await btn.reply({
      content:    `Selg **${card.title}** (${card.rarity}) for **${price} 🪙**?`,
      components: [confirmRow],
      ephemeral:  true,
    });
    return;
  }

  // ── Set showcase: card_showcase_{cardId} ───────────────────────────────────
  if (cid.startsWith('card_showcase_')) {
    const cardId = cid.slice('card_showcase_'.length);
    const cards  = await getMemberCards(workspaceId, viewerId, 'all');
    const card   = cards.find((c: CardRecord) => c.id === cardId);

    if (!card) {
      await btn.reply({ content: '❌ Kortet ble ikke funnet.', ephemeral: true });
      return;
    }

    await setShowcaseCard(workspaceId, viewerId, cardId);

    await btn.reply({
      content:   `⭐ **${card.title}** er nå ditt showcase-kort!`,
      ephemeral: true,
    });
    return;
  }
}

// re-export for any callers that still reference the banner/color maps
export { RARITY_BANNER, RARITY_COLOR };
