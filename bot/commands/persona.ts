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
  PersonaCard,
} from '../lib/personaService';

const SHOWCASE_KANAL_ID = process.env.DISCORD_PERSONA_SHOWCASE_CHANNEL_ID ?? '';

// ── Helper: bygg knapperaden ───────────────────────────────────────────────────

function lagKnappeRad(kortId: string, harNokXP: boolean, xp: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`persona_reroll_${kortId}`)
      .setLabel(`🔁 Reroll persona (${REROLL_XP_COST} XP)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!harNokXP),
    new ButtonBuilder()
      .setCustomId(`persona_share_${kortId}`)
      .setLabel('📢 Del i #persona-showcase')
      .setStyle(ButtonStyle.Primary),
  );
}

// ── Kommando ───────────────────────────────────────────────────────────────────

export const personaCommand = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Generer din AI Persona Card — din unike GLENVEX-karakter.')
    .addBooleanOption(opt =>
      opt.setName('reroll')
        .setDescription(`Reroll persona for ${REROLL_XP_COST} XP? (kun hvis du har eksisterende)`)
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

    // Vis eksisterende persona hvis bruker ikke ber om reroll
    if (!erReroll) {
      const eksisterende = await hentSistePersona(user.id);
      if (eksisterende) {
        const embed = byggPersonaEmbed(eksisterende.card, eksisterende.imageUrl, user.username, eksisterende.rerollCount);
        const harNokXP  = member.xp >= REROLL_XP_COST;
        const knappeRad = lagKnappeRad(user.id, harNokXP, member.xp);

        const infoEmbed = new EmbedBuilder()
          .setColor(0x1a1a2e)
          .setDescription(
            `Dette er din eksisterende **${eksisterende.card.rarity}**-persona for denne sesongen.\n` +
            `Du har **${member.xp} XP**. Reroll koster **${REROLL_XP_COST} XP**.`
          );

        await interaction.editReply({ embeds: [infoEmbed, embed], components: [knappeRad] });
        return;
      }
    }

    // Generer ny persona
    const venteEmbed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🎭 AI Persona Generator')
      .setDescription(
        erReroll
          ? `Regenererer din persona... Dette tar 10–30 sekunder ⏳`
          : `Analyserer din Discord-aktivitet og genererer din unike persona...\n\nDette tar 10–30 sekunder ⏳`
      );
    await interaction.editReply({ embeds: [venteEmbed] });

    const resultat = await genererPersona(member, erReroll);

    if ('feil' in resultat) {
      const feilEmbed = new EmbedBuilder()
        .setColor(0xff3333)
        .setTitle('❌ Feil')
        .setDescription(resultat.feil);
      await interaction.editReply({ embeds: [feilEmbed], components: [] });
      return;
    }

    const embed     = byggPersonaEmbed(resultat.card, resultat.imageUrl, user.username, resultat.rerollCount);
    const harNokXP  = (member.xp - resultat.xpCost) >= REROLL_XP_COST;
    const knappeRad = lagKnappeRad(user.id, harNokXP, member.xp - resultat.xpCost);

    let toppTekst = '';
    if (resultat.ersteGang) {
      toppTekst = `🎉 **${user.username}** — din første GLENVEX Persona Card er her!`;
    } else if (erReroll) {
      toppTekst = `🔁 **${user.username}** rerollet persona (-${REROLL_XP_COST} XP). Ny sjeldenhet: **${resultat.card.rarity}**!`;
    }

    await interaction.editReply({
      content:    toppTekst || undefined,
      embeds:     [embed],
      components: [knappeRad],
    });

    // Lytt til knappetrykk (60s vindu)
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (btn) => btn.user.id === user.id,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      // ── Reroll ────────────────────────────────────────────────────────────────
      if (btn.customId.startsWith('persona_reroll_')) {
        const oppdatertMedlem = getMember(user.id) ?? member!;

        const venteRe = new EmbedBuilder()
          .setColor(0x00ff41)
          .setTitle('🔁 Regenererer persona...')
          .setDescription(`Koster ${REROLL_XP_COST} XP. Vennligst vent... ⏳`);
        await btn.editReply({ embeds: [venteRe], components: [] });

        const nyResultat = await genererPersona(oppdatertMedlem, true);

        if ('feil' in nyResultat) {
          const feilEmbed = new EmbedBuilder()
            .setColor(0xff3333)
            .setDescription(nyResultat.feil);
          await btn.editReply({ embeds: [feilEmbed], components: [] });
          return;
        }

        const nyEmbed    = byggPersonaEmbed(nyResultat.card, nyResultat.imageUrl, user.username, nyResultat.rerollCount);
        const nyHarNokXP = (oppdatertMedlem.xp - nyResultat.xpCost) >= REROLL_XP_COST;
        const nyKnapper  = lagKnappeRad(user.id, nyHarNokXP, oppdatertMedlem.xp - nyResultat.xpCost);

        await btn.editReply({
          content:    `🔁 Rerollet! Ny sjeldenhet: **${nyResultat.card.rarity}** (-${REROLL_XP_COST} XP)`,
          embeds:     [nyEmbed],
          components: [nyKnapper],
        });
        return;
      }

      // ── Del i showcase ─────────────────────────────────────────────────────────
      if (btn.customId.startsWith('persona_share_')) {
        try {
          if (!SHOWCASE_KANAL_ID) {
            await btn.followUp({ content: '⚠️ Showcase-kanal er ikke satt opp (DISCORD_PERSONA_SHOWCASE_CHANNEL_ID).', ephemeral: true });
            return;
          }
          const guild   = btn.guild;
          const kanal   = guild?.channels.cache.get(SHOWCASE_KANAL_ID) as any;
          if (!kanal?.isTextBased?.()) {
            await btn.followUp({ content: '⚠️ Fant ikke showcase-kanalen.', ephemeral: true });
            return;
          }

          const sistePersona = await hentSistePersona(user.id);
          if (!sistePersona) return;

          const shareEmbed = byggPersonaEmbed(sistePersona.card, sistePersona.imageUrl, user.username, sistePersona.rerollCount);
          await kanal.send({
            content: `🎭 <@${user.id}> deler sin **${sistePersona.card.rarity}** Persona Card!`,
            embeds:  [shareEmbed],
          });

          await btn.followUp({ content: '✅ Persona delt i showcase-kanalen!', ephemeral: true });
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
