import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ComponentType,
} from 'discord.js';
import {
  getMember,
  upsertMember,
} from '../lib/memberTracker';
import {
  genererPersona,
  hentSistePersona,
  byggPersonaEmbed,
  REROLL_XP_COST,
  RARITY_COLOR,
  RARITY_BANNER,
} from '../lib/personaService';

const SHOWCASE_KANAL_ID = process.env.DISCORD_PERSONA_SHOWCASE_CHANNEL_ID ?? '';

function lagKnappeRad(kortId: string, harNokXP: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`persona_reroll_${kortId}`)
      .setLabel(`🔁 Reroll (${REROLL_XP_COST} XP)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!harNokXP),
    new ButtonBuilder()
      .setCustomId(`persona_share_${kortId}`)
      .setLabel('📢 Del i #persona-showcase')
      .setStyle(ButtonStyle.Primary),
  );
}

export const personaCommand = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Generer din AI Persona Card — ditt unike GLENVEX samlekort.')
    .addBooleanOption(opt =>
      opt.setName('reroll')
        .setDescription(`Reroll persona for ${REROLL_XP_COST} XP?`)
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const erReroll = interaction.options.getBoolean('reroll') ?? false;
    const user     = interaction.user;

    let member = getMember(user.id);
    if (!member) {
      const dn = (user as any).displayName ?? user.username;
      member = upsertMember(user.id, user.username, dn);
    }

    await interaction.deferReply({ ephemeral: false });

    // Vis eksisterende persona
    if (!erReroll) {
      const eksisterende = await hentSistePersona(user.id);
      if (eksisterende) {
        const embed     = byggPersonaEmbed(eksisterende.card, eksisterende.imageUrl, user.username, eksisterende.rerollCount, member!, eksisterende.collectionNumber);
        const harNokXP  = member!.xp >= REROLL_XP_COST;
        const knappeRad = lagKnappeRad(user.id, harNokXP);

        const rarityFarge = RARITY_COLOR[eksisterende.card.rarity];
        const rarityBanner = RARITY_BANNER[eksisterende.card.rarity];

        const infoEmbed = new EmbedBuilder()
          .setColor(rarityFarge)
          .setDescription(
            `Ditt aktive ${rarityBanner}-kort for denne sesongen.\n` +
            `**${member!.xp} XP** · Reroll koster **${REROLL_XP_COST} XP**`
          );

        await interaction.editReply({ embeds: [infoEmbed, embed as any], components: [knappeRad] });
        return;
      }
    }

    // Ventemelding
    const venteEmbed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🎴 GLENVEX Persona Generator')
      .setDescription(
        erReroll
          ? `Regenererer samlekort... **${REROLL_XP_COST} XP** trekkes. ⏳`
          : `Analyserer din Discord-aktivitet og genererer ditt unike samlekort...\n\n10–30 sekunder ⏳`
      );
    await interaction.editReply({ embeds: [venteEmbed] });

    const resultat = await genererPersona(member!, erReroll);

    if ('feil' in resultat) {
      const feilEmbed = new EmbedBuilder()
        .setColor(0xff3333)
        .setTitle('❌ Feil')
        .setDescription(resultat.feil);
      await interaction.editReply({ embeds: [feilEmbed], components: [] });
      return;
    }

    const embed     = byggPersonaEmbed(resultat.card, resultat.imageUrl, user.username, resultat.rerollCount, member!, resultat.collectionNumber);
    const harNokXP  = (member!.xp - resultat.xpCost) >= REROLL_XP_COST;
    const knappeRad = lagKnappeRad(user.id, harNokXP);

    let toppTekst = '';
    if (resultat.ersteGang) {
      toppTekst = `🎴 **${user.username}** — ditt første GLENVEX Persona Card er generert! Card #${String(resultat.collectionNumber).padStart(3, '0')}`;
    } else if (erReroll) {
      toppTekst = `🔁 Rerollet! Ny sjeldenhet: **${resultat.card.rarity}** · Card #${String(resultat.collectionNumber).padStart(3, '0')} (-${REROLL_XP_COST} XP)`;
    }

    await interaction.editReply({
      content:    toppTekst || undefined,
      embeds:     [embed as any],
      components: [knappeRad],
    });

    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (btn) => btn.user.id === user.id,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      if (btn.customId.startsWith('persona_reroll_')) {
        const oppdatertMedlem = getMember(user.id) ?? member!;

        const venteRe = new EmbedBuilder()
          .setColor(0x00ff41)
          .setTitle('🔁 Regenererer kort...')
          .setDescription(`Koster ${REROLL_XP_COST} XP · Vennligst vent... ⏳`);
        await btn.editReply({ embeds: [venteRe], components: [] });

        const nyResultat = await genererPersona(oppdatertMedlem, true);

        if ('feil' in nyResultat) {
          await btn.editReply({ embeds: [new EmbedBuilder().setColor(0xff3333).setDescription(nyResultat.feil)], components: [] });
          return;
        }

        const nyEmbed   = byggPersonaEmbed(nyResultat.card, nyResultat.imageUrl, user.username, nyResultat.rerollCount, oppdatertMedlem, nyResultat.collectionNumber);
        const nyHarNokXP = (oppdatertMedlem.xp - nyResultat.xpCost) >= REROLL_XP_COST;

        await btn.editReply({
          content:    `🔁 Rerollet! Ny sjeldenhet: **${nyResultat.card.rarity}** · Card #${String(nyResultat.collectionNumber).padStart(3, '0')} (-${REROLL_XP_COST} XP)`,
          embeds:     [nyEmbed as any],
          components: [lagKnappeRad(user.id, nyHarNokXP)],
        });
        return;
      }

      if (btn.customId.startsWith('persona_share_')) {
        try {
          if (!SHOWCASE_KANAL_ID) {
            await btn.followUp({ content: '⚠️ Showcase-kanal er ikke satt opp (DISCORD_PERSONA_SHOWCASE_CHANNEL_ID).', ephemeral: true });
            return;
          }
          const kanal = btn.guild?.channels.cache.get(SHOWCASE_KANAL_ID) as any;
          if (!kanal?.isTextBased?.()) {
            await btn.followUp({ content: '⚠️ Fant ikke showcase-kanalen.', ephemeral: true });
            return;
          }

          const sistePersona = await hentSistePersona(user.id);
          if (!sistePersona) return;

          const currentMember = getMember(user.id) ?? member!;
          const shareEmbed = byggPersonaEmbed(sistePersona.card, sistePersona.imageUrl, user.username, sistePersona.rerollCount, currentMember, sistePersona.collectionNumber);
          await kanal.send({
            content: `🎴 <@${user.id}> deler sitt **${sistePersona.card.rarity}** Persona Card!  ${RARITY_BANNER[sistePersona.card.rarity]}`,
            embeds:  [shareEmbed as any],
          });

          await btn.followUp({ content: '✅ Persona Card delt i showcase!', ephemeral: true });
        } catch (e: any) {
          await btn.followUp({ content: `⚠️ Klarte ikke å dele: ${e.message}`, ephemeral: true });
        }
      }
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
