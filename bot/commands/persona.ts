'use strict';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
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

import { getMember, upsertMember }            from '../lib/memberTracker';
import { genererPersona, hentSistePersona, renderPersonaCard, REROLL_COIN_COST, RARITY_COLOR } from '../lib/personaService';
import { getBalance }                          from '../lib/coinService';
import { publishCardDrop }                     from '../lib/cardDropPublisher';
import { logSystemEvent }                      from '../lib/systemEvents';
import { lagPersonaKnappeRad, byggMiniEmbed }  from '../lib/rerollService';

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

    const guildNick     = guildMember?.nickname ?? null;
    const guildJoinedAt = guildMember?.joinedAt?.toISOString() ?? undefined;
    const topRole       = guildMember ? detectTopRole(guildMember) : 'MEMBER';
    const bestName      = guildNick ?? (user as any).globalName ?? user.username;

    let member = getMember(user.id);
    if (!member) {
      member = upsertMember(user.id, user.username, bestName, { guildJoinedAt, topRole, nickname: guildNick });
    } else {
      member = upsertMember(user.id, user.username, bestName, { guildJoinedAt, topRole, nickname: guildNick });
    }

    // Acknowledge within 3 s — required before any async work
    await interaction.deferReply({ ephemeral: false });

    const coinBalance = await getBalance(user.id);
    const harNokCoins = coinBalance >= REROLL_COIN_COST;

    // ── Vis eksisterende kort (ingen reroll) ──────────────────────────────────
    // Buttons remain active indefinitely — the global interactionCreate handler
    // in index.ts picks up any click via handlePersonaReroll / handlePersonaShare.
    if (!erReroll) {
      const res = await hentOgRenderEksisterende(user.id, user.username, avatarUrl);
      if (res && res.eksisterende.imageUrl) {
        const { eksisterende, member: m, png } = res;
        const knappeRad = lagPersonaKnappeRad(user.id, harNokCoins);

        if (png) {
          const fil       = new AttachmentBuilder(png, { name: 'persona-card.png' });
          const miniEmbed = byggMiniEmbed(eksisterende.card, m, eksisterende.rerollCount, eksisterende.collectionNumber);
          await interaction.editReply({ files: [fil], embeds: [miniEmbed as any], components: [knappeRad] });
        } else {
          await interaction.editReply({
            content:    `🎴 ${eksisterende.card.title} · ${eksisterende.card.rarity} · **${m.xp} XP**`,
            components: [knappeRad],
          });
        }
        return;
      }
    }

    // ── Generer nytt kort ─────────────────────────────────────────────────────
    const venteEmbed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🎴 GLENVEX Persona Card Generator')
      .setDescription(
        erReroll
          ? `Regenererer samlekort — **${REROLL_COIN_COST} coins** trekkes. Vennligst vent... ⏳\n*Ca. 20–40 sekunder*`
          : `Analyserer Discord-aktivitet og genererer ditt unike samlekort...\n\n*Ca. 20–40 sekunder — bildegenerering inkludert* ⏳`,
      );
    await interaction.editReply({ embeds: [venteEmbed] });

    const resultat = await genererPersona(member!, erReroll, avatarUrl);

    if ('feil' in resultat) {
      await interaction.editReply({
        embeds:     [new EmbedBuilder().setColor(0xff3333).setTitle('❌ Feil').setDescription(resultat.feil)],
        components: [],
      });
      logSystemEvent({
        source: 'discord_command', event_type: 'CARD_REROLL_FAILED',
        title:    `Persona feilet for ${user.username}: ${resultat.feil}`,
        severity: 'error',
        metadata: { discordId: user.id, reason: resultat.feil },
      });
      return;
    }

    const nyBalance     = coinBalance - resultat.coinCost;
    const nyHarNokCoins = nyBalance >= REROLL_COIN_COST;
    const knappeRad     = lagPersonaKnappeRad(user.id, nyHarNokCoins);

    if (resultat.cardPng) {
      const fil       = new AttachmentBuilder(resultat.cardPng, { name: 'persona-card.png' });
      const miniEmbed = byggMiniEmbed(resultat.card, member!, resultat.rerollCount, resultat.collectionNumber);
      await interaction.editReply({ files: [fil], embeds: [miniEmbed as any], components: [knappeRad] });
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
      coinsBalance:    nyBalance,
      cardNumber:      resultat.collectionNumber,
      cardImageUrl:    resultat.imageUrl,
      cardImageBuffer: resultat.cardPng,
      source:          'persona_reroll',
    }).catch(() => {});
  },
};
