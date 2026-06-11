import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const twitchCommand = {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Sender Twitch-linken til streameren.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const url = process.env.TWITCH_URL || 'https://twitch.tv/glenvex';

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle('🎮 Twitch')
      .setDescription(`Følg og se live på:\n**${url}**`)
      .addFields({
        name: '🔗 Link',
        value: `[Åpne Twitch](${url})`,
      })
      .setFooter({ text: 'Stream Control' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
