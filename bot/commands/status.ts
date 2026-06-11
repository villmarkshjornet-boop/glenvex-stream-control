import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getStreamInfo, checkTwitchApiHealth } from '@/lib/twitch';
import { checkDiscordBotHealth } from '@/lib/discord';

export const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Viser Twitch API, Discord Bot og systemstatus.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const [twitchOk, discordOk, stream] = await Promise.allSettled([
      checkTwitchApiHealth(),
      checkDiscordBotHealth(),
      getStreamInfo(),
    ]);

    const twitchStatus = twitchOk.status === 'fulfilled' && twitchOk.value ? '🟢 Online' : '🔴 Feil';
    const discordStatus = discordOk.status === 'fulfilled' && discordOk.value ? '🟢 Online' : '🟡 Sjekk bot-token';
    const streamData = stream.status === 'fulfilled' ? stream.value : null;
    const liveStatus = streamData?.isLive ? '🔴 LIVE' : '⚫ Offline';

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('⊛ Systemstatus')
      .addFields(
        { name: 'Twitch API', value: twitchStatus, inline: true },
        { name: 'Discord Bot', value: discordStatus, inline: true },
        { name: 'Stream', value: liveStatus, inline: true },
        ...(streamData?.isLive ? [
          { name: '🎮 Spill', value: streamData.game || '–', inline: true },
          { name: '👁️ Seere', value: streamData.viewerCount?.toLocaleString() || '–', inline: true },
        ] : [])
      )
      .setFooter({ text: 'Stream Control' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
