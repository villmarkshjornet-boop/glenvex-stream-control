import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

const DISCORD_API = 'https://discord.com/api/v10';

export const innsendCommand = {
  data: new SlashCommandBuilder()
    .setName('innsend')
    .setDescription('Send inn en clip for godkjenning.')
    .addStringOption(opt => opt.setName('url').setDescription('URL til clipsen').setRequired(true))
    .addStringOption(opt => opt.setName('beskrivelse').setDescription('Hva skjer i clipsen?').setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    const url = interaction.options.getString('url', true);
    const beskrivelse = interaction.options.getString('beskrivelse') ?? 'Ingen beskrivelse';
    const brukernavn = interaction.user.username;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || '';

    try {
      await fetch(`${appUrl}/api/clips-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, beskrivelse, brukernavn }),
      });

      await interaction.reply({
        content: `✓ Clipsen din er sendt inn og venter på godkjenning! Vi sjekker den snart. 🎬`,
        ephemeral: true,
      });
    } catch {
      await interaction.reply({ content: '⚠️ Kunne ikke sende inn clipsen. Prøv igjen.', ephemeral: true });
    }
  },
};
