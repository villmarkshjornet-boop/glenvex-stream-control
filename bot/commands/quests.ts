import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getMemberQuests, type QuestProgress } from '../lib/questService';

export const data = new SlashCommandBuilder()
  .setName('quests')
  .setDescription('Se dine daglige og ukentlige quests')
  .addStringOption(o =>
    o.setName('type')
      .setDescription('Velg quest-type')
      .setRequired(false)
      .addChoices(
        { name: '📅 Daglige',   value: 'daily'  },
        { name: '📆 Ukentlige', value: 'weekly' },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction, workspaceId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const type      = (interaction.options.getString('type') ?? 'all') as 'daily' | 'weekly' | 'all';
  const discordId = interaction.user.id;

  const quests = await getMemberQuests(workspaceId, discordId, type);

  if (quests.length === 0) {
    await interaction.editReply('Ingen aktive quests funnet.');
    return;
  }

  const daily  = quests.filter(q => q.questType === 'daily');
  const weekly = quests.filter(q => q.questType === 'weekly');

  const embed = new EmbedBuilder()
    .setColor(0x00ff41)
    .setTitle(`📋 Quests — ${interaction.user.displayName}`);

  function renderQuest(q: QuestProgress): string {
    const bar    = buildProgressBar(q.progress, q.objectiveTarget);
    const status = q.completed ? (q.rewardClaimed ? '✅' : '🎁') : '⏳';
    const rewards = `+${q.rewardXp}XP${q.rewardCoins > 0 ? ` +${q.rewardCoins}🪙` : ''}`;
    return `${status} **${q.questName}**\n${bar} ${q.progress}/${q.objectiveTarget}\n${q.description} *(${rewards})*`;
  }

  if (daily.length > 0 && (type === 'all' || type === 'daily')) {
    embed.addFields({
      name:   '📅 Daglige quests',
      value:  daily.map(renderQuest).join('\n\n'),
      inline: false,
    });
  }

  if (weekly.length > 0 && (type === 'all' || type === 'weekly')) {
    embed.addFields({
      name:   '📆 Ukentlige quests',
      value:  weekly.map(renderQuest).join('\n\n'),
      inline: false,
    });
  }

  const completed = quests.filter(q => q.completed).length;
  embed.setFooter({ text: `${completed}/${quests.length} quests fullført` });

  await interaction.editReply({ embeds: [embed] });
}

function buildProgressBar(progress: number, target: number, width = 10): string {
  const filled = Math.round((progress / target) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
