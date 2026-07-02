import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import { getMember } from '../lib/memberTracker';
import { getStats } from '../lib/coinService';
import {
  getUserCards,
  getActiveCard,
  getRarityCounts,
  getTotalCardCount,
  CollectionCard,
} from '../lib/cardCollectionService';
import { hentSistePersona, renderPersonaCard, RARITY_COLOR, RARITY_BANNER } from '../lib/personaService';
import { publishCardDrop } from '../lib/cardDropPublisher';
import { logSystemEvent } from '../lib/systemEvents';

// ── Rarity sort order ─────────────────────────────────────────────────────────

const RARITY_ORDER = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

function raritySort(a: CollectionCard, b: CollectionCard): number {
  return RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
}

// ── Format card line ──────────────────────────────────────────────────────────

function kortLinje(c: CollectionCard): string {
  const EMOJI: Record<string, string> = {
    Mythic: '⚡', Legendary: '✨', Epic: '🔮', Rare: '💎', Common: '🎴',
  };
  const typeLabel: Record<string, string> = {
    persona: '', sub: ' [SUB]', achievement: ' [ACH]', milestone: ' [MILE]', event: ' [EVT]',
  };
  const active  = c.is_active ? ' ★' : '';
  const emoji   = EMOJI[c.rarity] ?? '🎴';
  const typeSfx = typeLabel[c.card_type] ?? '';
  return `${emoji} **${c.title}**${typeSfx}${active}`;
}

// ── /minekort command ─────────────────────────────────────────────────────────

export const minekortCommand = {
  data: new SlashCommandBuilder()
    .setName('minekort')
    .setDescription('Se din GLENVEX kortsamling, coins og aktivt kort.')
    .addStringOption(opt =>
      opt.setName('vis')
        .setDescription('Hva vil du se?')
        .setRequired(false)
        .addChoices(
          { name: 'Oversikt (standard)', value: 'oversikt' },
          { name: 'Alle kort', value: 'alle' },
          { name: 'Aktivt persona-kort', value: 'aktivt' },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const vis  = interaction.options.getString('vis') ?? 'oversikt';
    const user = interaction.user;

    await interaction.deferReply({ ephemeral: false });

    const member = getMember(user.id);

    // ── Vis aktivt persona-kort ────────────────────────────────────────────────

    if (vis === 'aktivt') {
      const avatarUrl    = user.displayAvatarURL({ extension: 'png', size: 512 } as any);
      const eksisterende = await hentSistePersona(user.id);

      if (!eksisterende || !eksisterende.imageUrl) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xff3333)
            .setTitle('❌ Ingen aktivt persona-kort')
            .setDescription('Du har ikke generert et persona-kort ennå. Bruk `/persona` for å lage ditt første kort!')],
        });
        return;
      }

      let png: Buffer | null = null;
      if (member) {
        try {
          png = await renderPersonaCard(eksisterende.card, eksisterende.imageUrl, member, eksisterende.collectionNumber, avatarUrl);
        } catch {}
      }

      if (png) {
        const banner = RARITY_BANNER[eksisterende.card.rarity as keyof typeof RARITY_BANNER] ?? eksisterende.card.rarity;
        const fil    = new AttachmentBuilder(png, { name: 'persona-card.png' });
        await interaction.editReply({
          content: `🎴 ${banner}  **${eksisterende.card.title}**  ·  *${eksisterende.card.class}*`,
          files:   [fil],
        });
      } else {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(RARITY_COLOR[eksisterende.card.rarity as keyof typeof RARITY_COLOR])
            .setTitle(eksisterende.card.title)
            .setDescription(`**${eksisterende.card.class}** · ${eksisterende.card.rarity}\n\n*${eksisterende.card.quote}*`)
            .setImage(eksisterende.imageUrl)],
        });
      }
      return;
    }

    // ── Hent data ──────────────────────────────────────────────────────────────

    const [coins, totalKort, rarityMap, alleKort, aktivt] = await Promise.all([
      getStats(user.id),
      getTotalCardCount(user.id),
      getRarityCounts(user.id),
      getUserCards(user.id, 50),
      getActiveCard(user.id, 'persona'),
    ]);

    // ── Vis alle kort ──────────────────────────────────────────────────────────

    if (vis === 'alle') {
      if (alleKort.length === 0) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x9e9e9e)
            .setTitle('🎴 Ingen kort ennå')
            .setDescription('Bruk `/persona` for å lage ditt første GLENVEX Samlekort!')],
        });
        return;
      }

      const sorted   = [...alleKort].sort(raritySort);
      const chunks: string[] = [];
      let current = '';

      for (const k of sorted) {
        const linje = kortLinje(k) + '\n';
        if ((current + linje).length > 900) {
          chunks.push(current.trimEnd());
          current = linje;
        } else {
          current += linje;
        }
      }
      if (current.trim()) chunks.push(current.trimEnd());

      const rarityLine = [
        rarityMap['Mythic']    ? `⚡ ${rarityMap['Mythic']} Mythic`    : '',
        rarityMap['Legendary'] ? `✨ ${rarityMap['Legendary']} Legendary` : '',
        rarityMap['Epic']      ? `🔮 ${rarityMap['Epic']} Epic`         : '',
        rarityMap['Rare']      ? `💎 ${rarityMap['Rare']} Rare`         : '',
        rarityMap['Common']    ? `🎴 ${rarityMap['Common']} Common`     : '',
      ].filter(Boolean).join('  ');

      const embed = new EmbedBuilder()
        .setColor(0xf9a825)
        .setTitle(`🎴 ${user.displayName ?? user.username} sin kortsamling`)
        .setDescription(`**${totalKort} kort totalt**\n${rarityLine}`)
        .addFields(
          ...chunks.map((chunk, i) => ({
            name:   i === 0 ? 'Kort' : '​',
            value:  chunk,
            inline: false,
          })),
        );

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── Standard oversikt ──────────────────────────────────────────────────────

    const rarityLine = [
      rarityMap['Mythic']    ? `⚡ ${rarityMap['Mythic']}`    : '',
      rarityMap['Legendary'] ? `✨ ${rarityMap['Legendary']}` : '',
      rarityMap['Epic']      ? `🔮 ${rarityMap['Epic']}`      : '',
      rarityMap['Rare']      ? `💎 ${rarityMap['Rare']}`      : '',
      rarityMap['Common']    ? `🎴 ${rarityMap['Common']}`    : '',
    ].filter(Boolean).join('  ');

    const sisteKort = [...alleKort]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    const sisteStr = sisteKort.length > 0
      ? sisteKort.map(kortLinje).join('\n')
      : '*Ingen kort ennå — bruk `/persona` for å lage ditt første!*';

    const aktivtStr = aktivt
      ? `${RARITY_BANNER[aktivt.rarity as keyof typeof RARITY_BANNER] ?? aktivt.rarity}  **${aktivt.title}**  ·  *${aktivt.class ?? ''}*`
      : '*Ingen aktivt persona-kort*';

    const level = member?.level ?? 1;
    const xp    = member?.xp    ?? 0;

    const embed = new EmbedBuilder()
      .setColor(0xf9a825)
      .setTitle(`🎴 ${user.displayName ?? user.username} sin kortsamling`)
      .setDescription(
        `**Lv ${level}**  ·  ${xp} XP\n` +
        `**${coins.balance} coins**  ·  ${coins.earned} tjent totalt`,
      )
      .addFields(
        {
          name:   '📦 Samling',
          value:  totalKort > 0 ? `**${totalKort} kort**\n${rarityLine}` : '*Tom*',
          inline: false,
        },
        {
          name:   '★ Aktivt kort',
          value:  aktivtStr,
          inline: false,
        },
        {
          name:   '🕐 Siste 5 kort',
          value:  sisteStr,
          inline: false,
        },
      )
      .setFooter({ text: `Bruk /minekort vis:alle for hele samlingen · /persona for å lage nytt kort` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`minekort_vis_aktivt:${user.id}`)
        .setLabel('🎴 Vis aktivt kort')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!aktivt),
      new ButtonBuilder()
        .setCustomId(`minekort_vis_alle:${user.id}`)
        .setLabel('📦 Alle kort')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalKort === 0),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};

// ── Button handler (kalles fra global interactionCreate i index.ts) ───────────

export async function handleMinekortButton(interaction: ButtonInteraction): Promise<void> {
  const [action, ownerId] = interaction.customId.split(':');
  const user              = interaction.user;

  // Validate that the user who clicked owns the card collection
  if (ownerId && ownerId !== user.id) {
    await interaction.reply({
      content: '❌ Disse kortene tilhører en annen bruker.',
      ephemeral: true,
    });
    return;
  }

  if (action === 'minekort_vis_aktivt') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const avatarUrl    = user.displayAvatarURL({ extension: 'png', size: 512 } as any);
      const eksisterende = await hentSistePersona(user.id);

      if (!eksisterende || !eksisterende.imageUrl) {
        await interaction.editReply({ content: '❌ Ingen aktivt persona-kort. Bruk `/persona` for å lage ditt første!' });
        return;
      }

      const member = getMember(user.id);
      let png: Buffer | null = null;
      if (member) {
        try {
          png = await renderPersonaCard(eksisterende.card, eksisterende.imageUrl, member, eksisterende.collectionNumber, avatarUrl);
        } catch {}
      }

      // Fire-and-forget: publish card via DM + settings channel
      publishCardDrop({
        userId:          user.id,
        discordUsername: member?.displayName ?? user.username,
        twitchUsername:  member?.twitchUsername ?? null,
        cardType:        'persona',
        rarity:          eksisterende.card.rarity,
        title:           eksisterende.card.title,
        klass:           eksisterende.card.class ?? null,
        archetype:       eksisterende.card.archetype ?? null,
        level:           member?.level ?? 1,
        xp:              member?.xp ?? 0,
        coinsBalance:    0,
        cardImageUrl:    eksisterende.imageUrl,
        cardImageBuffer: png,
        source:          'persona_reroll',
      }).catch(() => {});

      await interaction.editReply({ content: '🎴 Kortet ditt er sendt til kortkanalen og via DM!' });
    } catch (err: any) {
      try { await interaction.editReply({ content: '⚠️ Noe gikk galt. Prøv igjen.' }); } catch {}
      logSystemEvent({
        source: 'bot_button', event_type: 'CARD_DM_FAILED',
        title: `minekort_vis_aktivt feilet: ${err?.message}`,
        severity: 'error', metadata: { discordId: user.id, error: err?.message },
      });
    }
    return;
  }

  if (action === 'minekort_vis_alle') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const [alleKort, rarityMap, totalKort] = await Promise.all([
        getUserCards(user.id, 50),
        getRarityCounts(user.id),
        getTotalCardCount(user.id),
      ]);

      if (alleKort.length === 0) {
        await interaction.editReply({ content: '🎴 Ingen kort ennå. Bruk `/persona` for å lage ditt første!' });
        return;
      }

      const sorted  = [...alleKort].sort(raritySort);
      const chunks: string[] = [];
      let current = '';
      for (const k of sorted) {
        const linje = kortLinje(k) + '\n';
        if ((current + linje).length > 900) { chunks.push(current.trimEnd()); current = linje; }
        else { current += linje; }
      }
      if (current.trim()) chunks.push(current.trimEnd());

      const rarityLine = [
        rarityMap['Mythic']    ? `⚡ ${rarityMap['Mythic']} Mythic`    : '',
        rarityMap['Legendary'] ? `✨ ${rarityMap['Legendary']} Legendary` : '',
        rarityMap['Epic']      ? `🔮 ${rarityMap['Epic']} Epic`         : '',
        rarityMap['Rare']      ? `💎 ${rarityMap['Rare']} Rare`         : '',
        rarityMap['Common']    ? `🎴 ${rarityMap['Common']} Common`     : '',
      ].filter(Boolean).join('  ');

      const embed = new EmbedBuilder()
        .setColor(0xf9a825)
        .setTitle(`🎴 ${user.displayName ?? user.username} sin kortsamling`)
        .setDescription(`**${totalKort} kort totalt**\n${rarityLine}`)
        .addFields(...chunks.map((chunk, i) => ({ name: i === 0 ? 'Kort' : '​', value: chunk, inline: false })));

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      try { await interaction.editReply({ content: '⚠️ Noe gikk galt. Prøv igjen.' }); } catch {}
    }
  }
}
