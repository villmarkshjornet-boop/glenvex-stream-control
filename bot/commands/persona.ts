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
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';

// ── Role detection ────────────────────────────────────────────────────────────

function detectTopRole(gm: GuildMember): string {
  if (gm.guild.ownerId === gm.id) return 'OWNER';
  if (gm.permissions.has(PermissionFlagsBits.Administrator)) return 'ADMIN';
  if (
    gm.permissions.has(PermissionFlagsBits.ManageGuild) ||
    gm.permissions.has(PermissionFlagsBits.ManageMessages)
  ) return 'MODERATOR';

  // Role name matching — check highest-position roles first
  const roleNames = gm.roles.cache
    .filter(r => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map(r => r.name.toLowerCase());

  for (const name of roleNames) {
    if (name.includes('owner') || name.includes('founder')) return 'FOUNDER';
    if (name.includes('admin'))                              return 'ADMIN';
    if (name.includes('mod'))                                return 'MODERATOR';
    if (name.includes('vip'))                                return 'VIP';
    if (name.includes('subscriber') || name === 'sub')       return 'SUBSCRIBER';
    if (name.includes('booster') || name.includes('boost'))  return 'BOOSTER';
    if (name.includes('supporter'))                          return 'SUPPORTER';
  }
  return 'MEMBER';
}
import {
  getMember,
  upsertMember,
} from '../lib/memberTracker';
import {
  genererPersona,
  hentSistePersona,
  renderPersonaCard,
  REROLL_COIN_COST,
  RARITY_COLOR,
  RARITY_BANNER,
} from '../lib/personaService';
import { getBalance } from '../lib/coinService';
import { publishCardDrop } from '../lib/cardDropPublisher';

const SHOWCASE_KANAL_ID = process.env.DISCORD_PERSONA_SHOWCASE_CHANNEL_ID ?? '';

// ── Knapper ───────────────────────────────────────────────────────────────────

function lagKnappeRad(kortId: string, harNokCoins: boolean): ActionRowBuilder<ButtonBuilder> {
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

function byggMiniEmbed(card: any, member: any, rerollCount: number, collectionNumber: number): EmbedBuilder {
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

// ── Kommando ──────────────────────────────────────────────────────────────────

export const personaCommand = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Generer ditt AI Persona Card — et unikt GLENVEX samlekort.')
    .addBooleanOption(opt =>
      opt.setName('reroll')
        .setDescription(`Reroll persona for ${REROLL_COIN_COST} coins?`)
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const erReroll    = interaction.options.getBoolean('reroll') ?? false;
    const user        = interaction.user;
    const guildMember = interaction.member instanceof GuildMember ? interaction.member : null;
    const avatarUrl   = user.displayAvatarURL({ extension: 'png', size: 512 } as any);

    // Extract guild-specific data (nickname, join date, role)
    const guildNick      = guildMember?.nickname ?? null;
    const guildJoinedAt  = guildMember?.joinedAt?.toISOString() ?? undefined;
    const topRole        = guildMember ? detectTopRole(guildMember) : 'MEMBER';
    // Name priority: server nickname > Discord global displayName > username
    const bestName       = guildNick ?? (user as any).globalName ?? user.username;

    let member = getMember(user.id);
    if (!member) {
      member = upsertMember(user.id, user.username, bestName, { guildJoinedAt, topRole, nickname: guildNick });
    } else {
      // Always refresh live Discord data on every interaction
      member = upsertMember(user.id, user.username, bestName, { guildJoinedAt, topRole, nickname: guildNick });
    }

    await interaction.deferReply({ ephemeral: false });

    // Fetch coin balance once — used for button state throughout
    const coinBalance = await getBalance(user.id);

    // ── Vis eksisterende kort (bare hvis det har et bilde) ────────────────────
    // Hvis imageUrl er null (forrige generering feilet) faller vi gjennom til
    // ny generering slik at brukeren får et ekte kort uten å måtte rerulle.
    if (!erReroll) {
      const res = await hentOgRenderEksisterende(user.id, user.username, avatarUrl);
      if (res && res.eksisterende.imageUrl) {
        const { eksisterende, member: m, png } = res;
        const harNokCoins = coinBalance >= REROLL_COIN_COST;
        const knappeRad   = lagKnappeRad(user.id, harNokCoins);

        if (png) {
          const fil       = new AttachmentBuilder(png, { name: 'persona-card.png' });
          const miniEmbed = byggMiniEmbed(eksisterende.card, m, eksisterende.rerollCount, eksisterende.collectionNumber);
          await interaction.editReply({
            files:      [fil],
            embeds:     [miniEmbed as any],
            components: [knappeRad],
          });
        } else {
          await interaction.editReply({
            content:    `🎴 ${eksisterende.card.title} · ${eksisterende.card.rarity} · **${m.xp} XP**`,
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
          ? `Regenererer samlekort — **${REROLL_COIN_COST} coins** trekkes. Vennligst vent... ⏳\n*Ca. 20–40 sekunder*`
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

    const harNokCoins = (coinBalance - resultat.coinCost) >= REROLL_COIN_COST;
    const knappeRad   = lagKnappeRad(user.id, harNokCoins);

    if (resultat.cardPng) {
      const fil       = new AttachmentBuilder(resultat.cardPng, { name: 'persona-card.png' });
      const miniEmbed = byggMiniEmbed(resultat.card, member!, resultat.rerollCount, resultat.collectionNumber);
      await interaction.editReply({
        files:      [fil],
        embeds:     [miniEmbed as any],
        components: [knappeRad],
      });
    } else {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(RARITY_COLOR[resultat.card.rarity])
          .setTitle(resultat.card.title)
          .setDescription(`**${resultat.card.class}** · ${resultat.card.rarity}\n\n*${resultat.card.quote}*`)
          .setImage(resultat.imageUrl || null as any)],
        components: [knappeRad],
      });
    }

    // Publiser card drop (fire-and-forget — ikke kall ved cache hit)
    publishCardDrop({
      userId:          user.id,
      discordUsername: bestName,
      twitchUsername:  member!.twitchUsername ?? null,
      cardType:        'persona',
      rarity:          resultat.card.rarity,
      title:           resultat.card.title,
      klass:           resultat.card.class,
      archetype:       resultat.card.archetype,
      level:           member!.level,
      xp:              member!.xp,
      coinsBalance:    coinBalance - resultat.coinCost,
      cardNumber:      resultat.collectionNumber,
      cardImageUrl:    resultat.imageUrl,
      cardImageBuffer: resultat.cardPng,
      source:          'persona_reroll',
    }).catch(() => {});

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
          content: `🔁 Regenererer kort... **${REROLL_COIN_COST} coins** trekkes ⏳`,
          embeds: [], files: [], components: [],
        });

        const ny = await genererPersona(oppdatertMedlem, true, avatarUrl);

        if ('feil' in ny) {
          await btn.editReply({ content: `❌ ${ny.feil}`, embeds: [], files: [], components: [] });
          return;
        }

        const nyBalance     = await getBalance(user.id);
        const nyHarNokCoins = nyBalance >= REROLL_COIN_COST;

        if (ny.cardPng) {
          const fil     = new AttachmentBuilder(ny.cardPng, { name: 'persona-card.png' });
          const nyEmbed = byggMiniEmbed(ny.card, oppdatertMedlem, ny.rerollCount, ny.collectionNumber);
          await btn.editReply({
            files:      [fil],
            embeds:     [nyEmbed as any],
            components: [lagKnappeRad(user.id, nyHarNokCoins)],
          });
        } else {
          await btn.editReply({
            content:    `🔁 Rerollet! **${ny.card.rarity}** · Card #${String(ny.collectionNumber).padStart(3, '0')} (-${REROLL_COIN_COST} coins)`,
            components: [lagKnappeRad(user.id, nyHarNokCoins)],
          });
        }

        publishCardDrop({
          userId:          user.id,
          discordUsername: oppdatertMedlem.displayName,
          twitchUsername:  oppdatertMedlem.twitchUsername ?? null,
          cardType:        'persona',
          rarity:          ny.card.rarity,
          title:           ny.card.title,
          klass:           ny.card.class,
          archetype:       ny.card.archetype,
          level:           oppdatertMedlem.level,
          xp:              oppdatertMedlem.xp,
          coinsBalance:    nyBalance,
          cardNumber:      ny.collectionNumber,
          cardImageUrl:    ny.imageUrl,
          cardImageBuffer: ny.cardPng,
          source:          'persona_reroll',
        }).catch(() => {});
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
