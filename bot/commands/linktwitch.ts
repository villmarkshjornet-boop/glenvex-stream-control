import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { createLinkRequest, getPendingLink } from '../lib/twitchLinkService';
import { logSystemEvent } from '../lib/systemEvents';

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
    // LINKTWITCH_START — console log BEFORE deferReply so Railway logs confirm execute is reached
    console.log(`[linktwitch] LINKTWITCH_START userId=${interaction.user.id} username=${interaction.user.username}`);

    await interaction.deferReply({ ephemeral: true });
    console.log(`[linktwitch] LINKTWITCH_DEFERRED userId=${interaction.user.id}`);

    try {
      const twitchUsername = interaction.options.getString('twitch_bruker', true).toLowerCase().replace(/^@/, '');
      const user           = interaction.user;
      console.log(`[linktwitch] LINKTWITCH_CHECKING_PENDING userId=${user.id} twitch=${twitchUsername}`);

      // Check for existing pending link
      const existing = await getPendingLink(user.id);
      if (existing) {
        console.log(`[linktwitch] LINKTWITCH_EXISTING_PENDING code=${existing.verify_code}`);
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
        console.log(`[linktwitch] LINKTWITCH_REPLY_SENT (existing pending)`);
        return;
      }

      console.log(`[linktwitch] LINKTWITCH_CREATING_REQUEST userId=${user.id} twitch=${twitchUsername}`);
      const result = await createLinkRequest(user.id, user.username, twitchUsername);
      console.log(`[linktwitch] LINKTWITCH_REQUEST_RESULT hasError=${'error' in result}`);

      if ('error' in result) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xff3333)
            .setTitle('❌ Feil')
            .setDescription(result.error)],
        });
        console.log(`[linktwitch] LINKTWITCH_REPLY_SENT (error: ${result.error})`);
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
      console.log(`[linktwitch] LINKTWITCH_REPLY_SENT code=${result.code}`);
      console.log(`[linktwitch] LINKTWITCH_FINISHED userId=${user.id}`);

    } catch (err: any) {
      const msg = err?.message ?? 'Ukjent feil';
      console.error(`[linktwitch] LINKTWITCH_EXCEPTION: ${msg}`, err?.stack?.slice(0, 500));
      try {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xff3333)
            .setTitle('❌ Kommandofeil')
            .setDescription('Noe gikk galt. Prøv igjen om litt.')],
        });
      } catch {}
      logSystemEvent({
        source:     'bot_command',
        event_type: 'LINKTWITCH_COMMAND_FAILED',
        title:      `/linktwitch feilet for ${interaction.user.username}: ${msg}`,
        severity:   'error',
        metadata:   { discordId: interaction.user.id, error: msg, stack: err?.stack?.slice(0, 500) },
      });
    }
  },
};
