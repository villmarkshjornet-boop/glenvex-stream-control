import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getSettings } from '@/lib/settings';

export const socialsCommand = {
  data: new SlashCommandBuilder()
    .setName('socials')
    .setDescription('Viser alle sosiale medier for GLENVEX.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const settings = getSettings();
    const s = settings.socials;

    const links: string[] = [];

    if (s.twitch || settings.twitchUrl) {
      links.push(`🎮 **Twitch**: ${s.twitch || settings.twitchUrl}`);
    }
    if (s.tiktok) links.push(`📱 **TikTok**: ${s.tiktok}`);
    if (s.instagram) links.push(`📸 **Instagram**: ${s.instagram}`);
    if (s.twitter) links.push(`🐦 **Twitter/X**: ${s.twitter}`);
    if (s.youtube) links.push(`▶️ **YouTube**: ${s.youtube}`);
    if (s.discord) links.push(`💬 **Discord**: ${s.discord}`);

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🔗 GLENVEX – Sosiale medier')
      .setDescription(
        links.length
          ? links.join('\n\n')
          : 'Ingen sosiale medier konfigurert ennå.\nBruk dashboardet for å legge til linker.'
      )
      .setFooter({ text: 'GLENVEX Stream Control' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
