import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { createLinkRequest, getPendingLink } from '../lib/twitchLinkService';

export const linktwitchCommand = {
  data: new SlashCommandBuilder()
    .setName('linktwitch')
    .setDescription('Koble din Twitch-konto til Discord for å få sub-rolle og felles XP.')
    .addStringOption(opt =>
      opt.setName('twitch_bruker')
        .setDescription('Ditt Twitch-brukernavn (uten @)')
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const twitchUsername = interaction.options.getString('twitch_bruker', true).toLowerCase().replace(/^@/, '');
    const user           = interaction.user;

    await interaction.deferReply({ ephemeral: true });

    // Check for existing pending link
    const existing = await getPendingLink(user.id);
    if (existing) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xf9a825)
          .setTitle('⏳ Verifisering pågår')
          .setDescription(
            `Du har allerede en aktiv forespørsel for **${existing.twitch_username}**.\n\n` +
            `Skriv dette i **Twitch-chatten** til strømmeren:\n` +
            `\`\`\`!verify ${existing.verify_code}\`\`\`` +
            `\n\nUtløper: <t:${Math.floor(new Date(existing.expires_at).getTime() / 1000)}:R>`,
          )],
      });
      return;
    }

    const result = await createLinkRequest(user.id, user.username, twitchUsername);

    if ('error' in result) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xff3333)
          .setTitle('❌ Feil')
          .setDescription(result.error)],
      });
      return;
    }

    const expiresUnix = Math.floor(new Date(result.expiresAt).getTime() / 1000);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x9146FF)
        .setTitle('🔗 Koble Discord til Twitch')
        .setDescription(
          `**Steg 1:** Gå til Twitch-chatten til strømmeren\n` +
          `**Steg 2:** Skriv følgende melding:\n\n` +
          `\`\`\`!verify ${result.code}\`\`\`` +
          `\n\n` +
          `Twitch-konto: **${twitchUsername}**\n` +
          `Koden er gyldig i **15 minutter** — utløper <t:${expiresUnix}:R>`,
        )
        .setFooter({ text: 'Kun du kan se denne meldingen.' })],
    });
  },
};
