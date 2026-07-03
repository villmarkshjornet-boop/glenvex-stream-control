import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getMemberAchievements, markAchievementsNotified } from '../lib/achievementService';

export const data = new SlashCommandBuilder()
  .setName('achievements')
  .setDescription('Se dine achievements og fremgang');

export async function execute(interaction: ChatInputCommandInteraction, workspaceId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const discordId   = interaction.user.id;
  const achievements = await getMemberAchievements(workspaceId, discordId);

  if (achievements.length === 0) {
    await interaction.editReply('Du har ikke låst opp noen achievements ennå. Vær aktiv i communityet!');
    return;
  }

  // Group by category
  const grouped: Record<string, typeof achievements> = {};
  for (const a of achievements) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }

  const categoryLabels: Record<string, string> = {
    social:  '🤝 Sosiale',
    games:   '🎮 Spill',
    economy: '💰 Økonomi',
    loyalty: '🎖️ Lojalitet',
    general: '⭐ Generelle',
  };

  const embed = new EmbedBuilder()
    .setColor(0x00ff41)
    .setTitle(`🏆 Achievements — ${interaction.user.displayName}`)
    .setDescription(`Du har låst opp **${achievements.length}** achievements!`);

  for (const [cat, list] of Object.entries(grouped)) {
    const lines = list.map(a => `${a.icon} **${a.achievementName}** — ${a.description}`);
    embed.addFields({ name: categoryLabels[cat] ?? cat, value: lines.slice(0, 5).join('\n'), inline: false });
  }

  await markAchievementsNotified(workspaceId, discordId);
  await interaction.editReply({ embeds: [embed] });
}
