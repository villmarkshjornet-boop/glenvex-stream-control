import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { performPrestige, getPrestigeHistory, isPrestigeEnabled } from '../lib/prestigeService';
import { formatPrestige } from '../lib/rankService';

export const data = new SlashCommandBuilder()
  .setName('prestige')
  .setDescription('Reset til level 1 og bli en legende (krever level 100)');

export async function execute(interaction: ChatInputCommandInteraction, workspaceId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const enabled = await isPrestigeEnabled(workspaceId);
  if (!enabled) {
    await interaction.editReply('❌ Prestige er ikke aktivert for dette serveret.');
    return;
  }

  const discordId = interaction.user.id;
  const result    = await performPrestige(workspaceId, discordId);

  if (!result.ok) {
    if (result.error === 'not_level_100') {
      await interaction.editReply('❌ Du må være level **100** for å bruke Prestige. Fortsett å grinde!');
      return;
    }
    if (result.error === 'member_not_found') {
      await interaction.editReply('❌ Fant ikke profilen din. Skriv en melding i en kanal først.');
      return;
    }
    await interaction.editReply(`❌ Prestige feilet: ${result.error}`);
    return;
  }

  const history     = await getPrestigeHistory(workspaceId, discordId);
  const prestigeStr = formatPrestige(result.prestigeLevel);

  const embed = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle(`⭐ PRESTIGE ${result.prestigeLevel}! ${prestigeStr}`)
    .setDescription(
      `**${interaction.user.displayName}** har nå prestiget til **${prestigeStr}**!\n\n` +
      `Level er tilbakestilt til 1, men coins, badges og reputation er beholdt.\n` +
      `Du bærer nå tittelen **${prestigeStr}** — synlig for alle i community!`,
    )
    .addFields(
      { name: 'Prestige-nivå',    value: prestigeStr,         inline: true },
      { name: 'Totale prestiges', value: `${history.length}`, inline: true },
      { name: 'Ny level',         value: '1',                 inline: true },
    )
    .setFooter({ text: 'Grind videre til level 100 for Prestige II!' });

  await interaction.editReply({ embeds: [embed] });
}
