import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { getMember, setXP, upsertMember, levelFromXP } from '../lib/memberTracker';

const XP_PER_LEVEL = 250;

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
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'boost-xp') {
      await interaction.deferReply({ ephemeral: true });

      const target  = interaction.options.getUser('bruker', true);
      const xpValue = interaction.options.getInteger('xp', true);

      // Ensure member exists in cache
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
          { name: 'Bruker',   value: `<@${target.id}>`,                   inline: true  },
          { name: 'XP',       value: `${oldXP} → **${xpValue}** (${diffStr})`, inline: true  },
          { name: 'Level',    value: `**${newLevel}**${levelDiff}`,        inline: true  },
          { name: 'Progress', value: `${curXP} / ${XP_PER_LEVEL} XP til neste level`, inline: false },
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
