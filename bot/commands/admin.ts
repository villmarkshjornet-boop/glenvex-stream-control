import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { getMember, setXP, upsertMember } from '../lib/memberTracker';
import { XP_PER_LEVEL, levelFromXP } from '@/lib/xp';
import { awardBadge, revokeBadge } from '../lib/badgeService';
import { syncBadgeRole, syncRankRole, repairAllRoles } from '../lib/roleSyncService';
import { getCommunitySettings } from '../lib/botKanalPreferanser';
import { WORKSPACE_ID } from '../lib/supabase';

const BADGE_CHOICES = [
  { name: '⚡ H4ckerman',    value: 'h4ckerman'   },
  { name: '🏅 OG',            value: 'og'           },
  { name: '📅 Veteran 1 år',  value: 'veteran_1yr'  },
  { name: '📆 Veteran 2 år',  value: 'veteran_2yr'  },
  { name: '💜 Sub Loyalist',  value: 'sub_loyalty'  },
  { name: '💬 Chatty',        value: 'chatty'       },
  { name: '⚔️ Raider',         value: 'raider'       },
];

// Badge keys that trigger a Discord role sync (must match BadgeRoles keys)
const BADGE_ROLE_KEYS = new Set(['h4ckerman']);

export const adminCommand = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin-verktøy for GLENVEX-botten.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub =>
      sub
        .setName('boost-xp')
        .setDescription('Sett XP for en bruker til en bestemt verdi.')
        .addUserOption(opt =>
          opt.setName('bruker').setDescription('Discord-brukeren som skal få XP').setRequired(true),
        )
        .addIntegerOption(opt =>
          opt.setName('xp').setDescription('XP-verdi å sette (ikke legge til)').setRequired(true).setMinValue(0).setMaxValue(999_999),
        ),
    )

    .addSubcommandGroup(group =>
      group
        .setName('badge')
        .setDescription('Administrer badges for community-medlemmer.')
        .addSubcommand(sub =>
          sub
            .setName('give')
            .setDescription('Gi et badge til en bruker (H4ckerman er admin-only).')
            .addUserOption(opt =>
              opt.setName('bruker').setDescription('Mottaker').setRequired(true),
            )
            .addStringOption(opt =>
              opt.setName('badge').setDescription('Badge å gi').setRequired(true)
                .addChoices(...BADGE_CHOICES),
            )
            .addStringOption(opt =>
              opt.setName('notat').setDescription('Valgfritt notat for audit log').setRequired(false),
            ),
        )
        .addSubcommand(sub =>
          sub
            .setName('revoke')
            .setDescription('Ta tilbake et badge fra en bruker.')
            .addUserOption(opt =>
              opt.setName('bruker').setDescription('Brukeren').setRequired(true),
            )
            .addStringOption(opt =>
              opt.setName('badge').setDescription('Badge å ta tilbake').setRequired(true)
                .addChoices(...BADGE_CHOICES),
            ),
        ),
    )

    .addSubcommand(sub =>
      sub
        .setName('sync-roles')
        .setDescription('Reparer alle Discord-roller basert på rank og badges i DB.'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── boost-xp ────────────────────────────────────────────────────────────────
    if (sub === 'boost-xp') {
      await interaction.deferReply({ ephemeral: true });

      const target  = interaction.options.getUser('bruker', true);
      const xpValue = interaction.options.getInteger('xp', true);

      let member = getMember(target.id);
      if (!member) {
        const dn = (target as any).displayName ?? target.username;
        member = upsertMember(target.id, target.username, dn);
      }

      const oldXP    = member.xp;
      const oldLevel = member.level;
      const updated  = setXP(target.id, xpValue);

      if (!updated) {
        await interaction.editReply({ content: `❌ Fant ikke ${target.username} i member-cachen. De må ha skrevet minst én melding i serveren.` });
        return;
      }

      const newLevel   = levelFromXP(xpValue);
      const levelXP    = (newLevel - 1) * XP_PER_LEVEL;
      const curXP      = xpValue - levelXP;
      const diff       = xpValue - oldXP;
      const diffStr    = diff >= 0 ? `+${diff}` : `${diff}`;
      const levelDiff  = newLevel !== oldLevel ? ` (${oldLevel} → **${newLevel}**)` : '';

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅ XP oppdatert')
        .addFields(
          { name: 'Bruker',   value: `<@${target.id}>`,                        inline: true },
          { name: 'XP',       value: `${oldXP} → **${xpValue}** (${diffStr})`, inline: true },
          { name: 'Level',    value: `**${newLevel}**${levelDiff}`,             inline: true },
          { name: 'Progress', value: `${curXP} / ${XP_PER_LEVEL} XP til neste level`, inline: false },
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── badge give ───────────────────────────────────────────────────────────────
    if (group === 'badge' && sub === 'give') {
      await interaction.deferReply({ ephemeral: true });

      const target   = interaction.options.getUser('bruker', true);
      const badgeKey = interaction.options.getString('badge', true);
      const notat    = interaction.options.getString('notat', false) ?? null;

      const result = await awardBadge(WORKSPACE_ID, target.id, badgeKey, interaction.user.id, notat);

      if (result.alreadyHas) {
        await interaction.editReply({ content: `ℹ️ **${target.username}** har allerede badgen **${badgeKey}**.` });
        return;
      }
      if (!result.ok) {
        await interaction.editReply({ content: `❌ Feil ved badge-tildeling: ${result.error ?? 'ukjent'}` });
        return;
      }

      // Sync Discord role if this badge has one configured
      if (BADGE_ROLE_KEYS.has(badgeKey) && interaction.guild) {
        const settings = await getCommunitySettings().catch(() => null);
        if (settings) {
          const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
          if (guildMember) {
            await syncBadgeRole(interaction.guild, guildMember, badgeKey as any, settings.badgeRoles, true);
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅ Badge gitt')
        .addFields(
          { name: 'Bruker',  value: `<@${target.id}>`, inline: true },
          { name: 'Badge',   value: badgeKey,           inline: true },
          { name: 'Tildelt', value: `av <@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: `${notat ?? ''}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── badge revoke ─────────────────────────────────────────────────────────────
    if (group === 'badge' && sub === 'revoke') {
      await interaction.deferReply({ ephemeral: true });

      const target   = interaction.options.getUser('bruker', true);
      const badgeKey = interaction.options.getString('badge', true);

      const result = await revokeBadge(WORKSPACE_ID, target.id, badgeKey, interaction.user.id);

      if (!result.ok) {
        await interaction.editReply({ content: `❌ Feil ved badge-tilbaketaking (kanskje brukeren ikke har badgen?).` });
        return;
      }

      // Remove Discord role if this badge has one configured
      if (BADGE_ROLE_KEYS.has(badgeKey) && interaction.guild) {
        const settings = await getCommunitySettings().catch(() => null);
        if (settings) {
          const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
          if (guildMember) {
            await syncBadgeRole(interaction.guild, guildMember, badgeKey as any, settings.badgeRoles, false);
          }
        }
      }

      await interaction.editReply({
        content: `✅ Badge **${badgeKey}** er tatt tilbake fra **${target.username}**.`,
      });
      return;
    }

    // ── sync-roles ───────────────────────────────────────────────────────────────
    if (sub === 'sync-roles') {
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: '❌ Kan bare kjøres i en server.' });
        return;
      }

      const settings = await getCommunitySettings().catch(() => null);
      if (!settings) {
        await interaction.editReply({ content: '❌ Kunne ikke hente community-innstillinger.' });
        return;
      }

      await interaction.editReply({ content: '⏳ Starter rolle-reparasjon for alle medlemmer...' });

      const { repaired, errors } = await repairAllRoles(
        WORKSPACE_ID,
        guild,
        settings.rankRoles,
        settings.badgeRoles,
      );

      const embed = new EmbedBuilder()
        .setColor(errors > 0 ? 0xff8800 : 0x00ff88)
        .setTitle('🔄 Rolle-sync ferdig')
        .addFields(
          { name: '✅ Synkronisert', value: `${repaired} medlemmer`, inline: true },
          { name: '❌ Feil',         value: `${errors}`,             inline: true },
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], content: '' });
      return;
    }
  },
};
