import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const clipCommand = {
  data: new SlashCommandBuilder()
    .setName('clip')
    .setDescription('Forklarer hvordan du kan lage clips fra streamen.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const twitchUrl = process.env.TWITCH_URL || '';

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🎬 Lag en clip!')
      .setDescription(
        'Vil du fange et episk øyeblikk fra streamen? Slik gjør du det:'
      )
      .addFields(
        {
          name: '📱 Metode 1 – Twitch-knappen',
          value:
            'Klikk på **klipp**-ikonet (✂️) nede til høyre på stream-siden.\nDu kan da trimme og lagre 30–60 sekunder.',
          inline: false,
        },
        {
          name: '⌨️ Metode 2 – Hurtigtast',
          value:
            'Trykk **Alt + X** mens du ser på streamen i nettleseren.\nTwitch oppretter automatisk en 30 sekunders clip.',
          inline: false,
        },
        {
          name: '📋 Del clipen',
          value:
            `Gå til [${twitchUrl}](${twitchUrl}/clips) og del linken i **🎬・clips** kanalen!`,
          inline: false,
        },
        {
          name: '💡 Tips',
          value: 'Beste clips blir kanskje fremhevet på sosiale medier!',
          inline: false,
        }
      )
      .setFooter({ text: 'Stream Control' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
