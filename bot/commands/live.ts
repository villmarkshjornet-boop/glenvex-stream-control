import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getStreamInfo } from '@/lib/twitch';

export const liveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Sjekker om GLENVEX er live på Twitch akkurat nå.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const stream = await getStreamInfo().catch(() => null);

    if (!stream) {
      return interaction.editReply({
        content: '⚠️ Kunne ikke hente Twitch-status. Prøv igjen.',
      });
    }

    if (!stream.isLive) {
      const embed = new EmbedBuilder()
        .setColor(0x333333)
        .setTitle('⚫ GLENVEX er ikke live')
        .setDescription('Ingen aktiv stream detektert.')
        .addFields({
          name: '🔗 Twitch',
          value: `[twitch.tv/glenvex](${stream.streamUrl})`,
        })
        .setFooter({ text: 'GLENVEX Stream Control' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    const startedTs = stream.startedAt
      ? Math.floor(new Date(stream.startedAt).getTime() / 1000)
      : null;

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🔴 GLENVEX ER LIVE!')
      .setDescription('Systemet er aktivert. Kaoset starter nå.')
      .addFields(
        { name: '🎮 Spill', value: stream.game || 'Ukjent', inline: true },
        { name: '👁️ Seere', value: stream.viewerCount?.toLocaleString() || '–', inline: true },
        { name: '📺 Tittel', value: stream.title || '–', inline: false },
        ...(startedTs ? [{ name: '⏱️ Startet', value: `<t:${startedTs}:R>`, inline: true }] : []),
        { name: '🔗 Se her', value: `[twitch.tv/glenvex](${stream.streamUrl})`, inline: true }
      );

    if (stream.thumbnailUrl) {
      embed.setImage(stream.thumbnailUrl);
    }

    embed.setFooter({ text: 'GLENVEX Stream Control' }).setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
