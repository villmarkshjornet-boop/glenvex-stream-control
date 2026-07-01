import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ComponentType,
  AttachmentBuilder,
} from 'discord.js';
import {
  getMember,
  upsertMember,
} from '../lib/memberTracker';
import {
  genererPersona,
  hentSistePersona,
  byggPersonaEmbed,
  renderPersonaCard,
  REROLL_XP_COST,
  RARITY_COLOR,
  RARITY_BANNER,
} from '../lib/personaService';

const SHOWCASE_KANAL_ID = process.env.DISCORD_PERSONA_SHOWCASE_CHANNEL_ID ?? '';

// ── Knapper ───────────────────────────────────────────────────────────────────

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

// ── Hent og render eksisterende persona ───────────────────────────────────────

async function hentOgRenderEksisterende(userId: string, username: string, avatarUrl?: string | null) {
  const eksisterende = await hentSistePersona(userId);
  if (!eksisterende) return null;
  const member = getMember(userId);
  if (!member) return null;

  let png: Buffer | null = null;
  try {
    png = await renderPersonaCard(eksisterende.card, eksisterende.imageUrl, member, eksisterende.collectionNumber, avatarUrl);
  } catch {}

  return { eksisterende, member, png };
}

// ── Kortvisning — sendes alltid som direkte fil, ikke embed ──────────────────
// Discord viser direktefiler større enn embed-bilder i chat-visningen.

function kortTekst(rarity: string, title: string, klass: string, xp: number, level: number): string {
  return `🎴 ${RARITY_BANNER[rarity as keyof typeof RARITY_BANNER] ?? rarity}  **${title}**  ·  *${klass}*  ·  Lv ${level}  ·  ${xp} XP`;
}

// ── Kommando ──────────────────────────────────────────────────────────────────

export const personaCommand = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Generer ditt AI Persona Card — et unikt GLENVEX samlekort.')
    .addBooleanOption(opt =>
      opt.setName('reroll')
        .setDescription(`Reroll persona for ${REROLL_XP_COST} XP?`)
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const erReroll  = interaction.options.getBoolean('reroll') ?? false;
    const user      = interaction.user;
    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 512 } as any);

    let member = getMember(user.id);
    if (!member) {
      const dn = (user as any).displayName ?? user.username;
      member = upsertMember(user.id, user.username, dn);
    }

    await interaction.deferReply({ ephemeral: false });

    // ── Vis eksisterende kort (bare hvis det har et bilde) ────────────────────
    // Hvis imageUrl er null (forrige generering feilet) faller vi gjennom til
    // ny generering slik at brukeren får et ekte kort uten å måtte rerulle.
    if (!erReroll) {
      const res = await hentOgRenderEksisterende(user.id, user.username, avatarUrl);
      if (res && res.eksisterende.imageUrl) {
        const { eksisterende, member: m, png } = res;
        const harNokXP  = m.xp >= REROLL_XP_COST;
        const knappeRad = lagKnappeRad(user.id, harNokXP);
        const embed     = byggPersonaEmbed(eksisterende.card, null, user.username, eksisterende.rerollCount, m, eksisterende.collectionNumber);

        if (png) {
          const fil = new AttachmentBuilder(png, { name: 'persona-card.png' });
          await interaction.editReply({
            content:    kortTekst(eksisterende.card.rarity, eksisterende.card.title, eksisterende.card.class, m.xp, m.level),
            embeds:     [embed as any],
            files:      [fil],
            components: [knappeRad],
          });
        } else {
          await interaction.editReply({
            content:    `🎴 ${eksisterende.card.title} · ${eksisterende.card.rarity} · **${m.xp} XP**`,
            embeds:     [embed as any],
            components: [knappeRad],
          });
        }
        return;
      }
    }

    // ── Generer nytt kort ──────────────────────────────────────────────────────
    const venteEmbed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🎴 GLENVEX Persona Card Generator')
      .setDescription(
        erReroll
          ? `Regenererer samlekort — **${REROLL_XP_COST} XP** trekkes. Vennligst vent... ⏳\n*Ca. 20–40 sekunder*`
          : `Analyserer Discord-aktivitet og genererer ditt unike samlekort...\n\n*Ca. 20–40 sekunder — bildegenerering inkludert* ⏳`
      );
    await interaction.editReply({ embeds: [venteEmbed] });

    const resultat = await genererPersona(member!, erReroll, avatarUrl);

    if ('feil' in resultat) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xff3333).setTitle('❌ Feil').setDescription(resultat.feil)],
        components: [],
      });
      return;
    }

    const harNokXP  = (member!.xp - resultat.xpCost) >= REROLL_XP_COST;
    const knappeRad = lagKnappeRad(user.id, harNokXP);

    if (resultat.cardPng) {
      const fil = new AttachmentBuilder(resultat.cardPng, { name: 'persona-card.png' });
      const tekst = resultat.ersteGang
        ? `🎴 **${user.username}** — ditt første GLENVEX Persona Card!  Card #${String(resultat.collectionNumber).padStart(3, '0')}\n` +
          kortTekst(resultat.card.rarity, resultat.card.title, resultat.card.class, member!.xp - resultat.xpCost, member!.level)
        : erReroll
          ? `🔁 Rerollet!  Card #${String(resultat.collectionNumber).padStart(3, '0')}  (-${REROLL_XP_COST} XP)\n` +
            kortTekst(resultat.card.rarity, resultat.card.title, resultat.card.class, member!.xp - resultat.xpCost, member!.level)
          : kortTekst(resultat.card.rarity, resultat.card.title, resultat.card.class, member!.xp - resultat.xpCost, member!.level);

      const embed = byggPersonaEmbed(resultat.card, null, user.username, resultat.rerollCount, member!, resultat.collectionNumber);
      await interaction.editReply({
        content:    tekst,
        embeds:     [embed as any],
        files:      [fil],
        components: [knappeRad],
      });
    } else {
      // PNG-rendering feilet — vis embed-fallback med Supabase URL
      await interaction.editReply({
        content:    undefined,
        embeds:     [new EmbedBuilder()
          .setColor(RARITY_COLOR[resultat.card.rarity])
          .setTitle(resultat.card.title)
          .setDescription(`**${resultat.card.class}** · ${resultat.card.rarity}\n\n*${resultat.card.quote}*`)
          .setImage(resultat.imageUrl || null as any)],
        components: [knappeRad],
      });
    }

    // ── Button collector ──────────────────────────────────────────────────────
    const msg       = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (btn) => btn.user.id === user.id,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      // Reroll
      if (btn.customId.startsWith('persona_reroll_')) {
        const oppdatertMedlem = getMember(user.id) ?? member!;

        await btn.editReply({
          content: `🔁 Regenererer kort... **${REROLL_XP_COST} XP** trekkes ⏳`,
          embeds: [], files: [], components: [],
        });

        const ny = await genererPersona(oppdatertMedlem, true, avatarUrl);

        if ('feil' in ny) {
          await btn.editReply({ content: `❌ ${ny.feil}`, embeds: [], files: [], components: [] });
          return;
        }

        const nyHarNokXP = (oppdatertMedlem.xp - ny.xpCost) >= REROLL_XP_COST;

        if (ny.cardPng) {
          const fil      = new AttachmentBuilder(ny.cardPng, { name: 'persona-card.png' });
          const nyEmbed  = byggPersonaEmbed(ny.card, null, user.username, ny.rerollCount, oppdatertMedlem, ny.collectionNumber);
          await btn.editReply({
            content:    `🔁 Rerollet!  Card #${String(ny.collectionNumber).padStart(3, '0')}  (-${REROLL_XP_COST} XP)\n` +
              kortTekst(ny.card.rarity, ny.card.title, ny.card.class, oppdatertMedlem.xp - ny.xpCost, oppdatertMedlem.level),
            embeds:     [nyEmbed as any],
            files:      [fil],
            components: [lagKnappeRad(user.id, nyHarNokXP)],
          });
        } else {
          await btn.editReply({
            content:    `🔁 Rerollet! **${ny.card.rarity}** · Card #${String(ny.collectionNumber).padStart(3, '0')} (-${REROLL_XP_COST} XP)`,
            components: [lagKnappeRad(user.id, nyHarNokXP)],
          });
        }
        return;
      }

      // Del i showcase
      if (btn.customId.startsWith('persona_share_')) {
        try {
          if (!SHOWCASE_KANAL_ID) {
            await btn.followUp({ content: '⚠️ Showcase-kanal ikke satt opp (DISCORD_PERSONA_SHOWCASE_CHANNEL_ID).', ephemeral: true });
            return;
          }
          const kanal = btn.guild?.channels.cache.get(SHOWCASE_KANAL_ID) as any;
          if (!kanal?.isTextBased?.()) {
            await btn.followUp({ content: '⚠️ Fant ikke showcase-kanalen.', ephemeral: true });
            return;
          }

          const res2 = await hentOgRenderEksisterende(user.id, user.username, avatarUrl);
          if (!res2) return;

          const { eksisterende, member: m2, png } = res2;

          if (png) {
            const fil = new AttachmentBuilder(png, { name: 'persona-card.png' });
            await kanal.send({
              content: `🎴 <@${user.id}> deler sitt Persona Card!\n` +
                kortTekst(eksisterende.card.rarity, eksisterende.card.title, eksisterende.card.class, m2.xp, m2.level),
              files: [fil],
            });
          } else {
            await kanal.send(`🎴 <@${user.id}> — **${eksisterende.card.title}** (${eksisterende.card.rarity})`);
          }

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
