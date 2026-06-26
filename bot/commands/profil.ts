import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { getMember, getAllMembers } from '../lib/memberTracker';

function levelProgress(xp: number): { level: number; progress: number; xpInLevel: number; xpForNext: number } {
  const XP_PER_LEVEL = 500;
  const level      = Math.floor(xp / XP_PER_LEVEL);
  const xpInLevel  = xp % XP_PER_LEVEL;
  const xpForNext  = XP_PER_LEVEL;
  const progress   = Math.round((xpInLevel / XP_PER_LEVEL) * 100);
  return { level, progress, xpInLevel, xpForNext };
}

function progressBar(pct: number, len = 12): string {
  const filled = Math.round((pct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function rankOf(userId: string): number {
  const all = getAllMembers().sort((a, b) => b.xp - a.xp);
  const idx = all.findIndex(m => m.id === userId);
  return idx === -1 ? -1 : idx + 1;
}

export const profilCommand = {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Vis XP, level og statistikk for en community-bruker.')
    .addUserOption(opt =>
      opt.setName('bruker')
        .setDescription('Hvem vil du se profilen til? (tomt = deg selv)')
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: false });

    const target      = interaction.options.getUser('bruker') ?? interaction.user;
    const member      = getMember(target.id);

    if (!member) {
      return interaction.editReply(
        `❌ **${target.displayName}** har ingen profil ennå. Send en melding i kanalen for å starte!`,
      );
    }

    const { level, progress, xpInLevel, xpForNext } = levelProgress(member.xp);
    const rank = rankOf(member.id);

    const badgeStr = member.badges.length > 0
      ? member.badges.slice(0, 6).join(' · ')
      : 'Ingen badges ennå';

    const streakStr = member.streakDays >= 2
      ? `🔥 ${member.streakDays} dager på rad`
      : 'Ingen aktiv streak';

    const embed = new EmbedBuilder()
      .setColor(level >= 10 ? 0xffd700 : level >= 5 ? 0x00e676 : 0x4444ff)
      .setTitle(`👤 ${member.displayName}`)
      .setDescription(
        `**Level ${level}** · Rank #${rank > 0 ? rank : '?'} i communityet\n` +
        `\`${progressBar(progress)}\` ${progress}% til Level ${level + 1}`,
      )
      .addFields(
        { name: '💰 Total XP', value: `${member.xp.toLocaleString('no-NO')}`, inline: true },
        { name: '📈 XP til neste', value: `${xpForNext - xpInLevel} XP`, inline: true },
        { name: '🔥 Streak', value: streakStr, inline: true },
        { name: '💬 Meldinger', value: `${member.messages.toLocaleString('no-NO')}`, inline: true },
        { name: '⚡ Reaksjoner', value: `${member.reactions}`, inline: true },
        { name: '🎙️ Voice-min', value: `${member.voiceMinutes}`, inline: true },
        { name: '📺 Streams sett', value: `${member.streamsAttended}`, inline: true },
        { name: '🎁 Subs gitt', value: `${member.giftSubs}`, inline: true },
        { name: '🚀 Raids', value: `${member.raids}`, inline: true },
        { name: '🏅 Badges', value: badgeStr, inline: false },
      )
      .setFooter({ text: `Sist sett: ${new Date(member.lastSeen).toLocaleDateString('no-NO')}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
