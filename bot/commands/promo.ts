import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getStreamInfo } from '@/lib/twitch';
import { generatePromo } from '@/lib/openai';

export const promoCommand = {
  data: new SlashCommandBuilder()
    .setName('promo')
    .setDescription('Genererer AI promo-tekst for aktiv stream.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const stream = await getStreamInfo().catch(() => ({
      isLive: false,
      game: 'Gaming',
      streamUrl: process.env.TWITCH_URL || 'https://twitch.tv',
      userName: process.env.TWITCH_USERNAME || 'streameren',
    }));

    const promo = await generatePromo(stream).catch(() => null);

    if (!promo) {
      return interaction.editReply({
        content: '⚠️ Kunne ikke generere promo. Sjekk OPENAI_API_KEY.',
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('◆ AI Promo Forslag')
      .setDescription('Klar til å kopieres og deles!')
      .addFields(
        { name: '📱 TikTok', value: promo.tiktok.slice(0, 200), inline: false },
        { name: '📸 Instagram', value: promo.instagram.slice(0, 200), inline: false },
        { name: '🐦 Twitter/X', value: promo.twitter.slice(0, 200), inline: false },
        { name: '🎬 YouTube', value: promo.youtube.slice(0, 200), inline: false }
      )
      .setFooter({ text: 'Stream Control • AI Generert' })
      .setTimestamp();

    if (promo.imageUrl) {
      embed.setImage(promo.imageUrl);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
