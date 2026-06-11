import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';

const CHANNELS_TO_CREATE = [
  { name: '📢・annonsering', type: ChannelType.GuildText, category: 'INFORMASJON' },
  { name: '🔴・live', type: ChannelType.GuildText, category: 'INFORMASJON' },
  { name: '🎬・clips', type: ChannelType.GuildText, category: 'INFORMASJON' },
  { name: '📰・nyheter', type: ChannelType.GuildText, category: 'INFORMASJON' },
  { name: '💬・chat', type: ChannelType.GuildText, category: 'COMMUNITY' },
  { name: '🎮・gaming', type: ChannelType.GuildText, category: 'COMMUNITY' },
  { name: '🧠・forslag', type: ChannelType.GuildText, category: 'COMMUNITY' },
  { name: '🛠・support', type: ChannelType.GuildText, category: 'SUPPORT' },
  { name: '👑・vip', type: ChannelType.GuildText, category: 'SUPPORT' },
  { name: '🤖・bot-logs', type: ChannelType.GuildText, category: 'SUPPORT' },
];

const ROLES_TO_CREATE = [
  { name: 'Admin', color: 0xff4444 as number },
  { name: 'Moderator', color: 0xff8800 as number },
  { name: 'VIP', color: 0xffd700 as number },
  { name: 'Live-varsler', color: 0x00ff41 as number },
  { name: 'Community', color: 0x00aaff as number },
];

export const setupCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Oppretter anbefalt Discord-struktur for streaming community.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply('⚠️ Kommandoen kan kun brukes i en server.');
    }

    const results: string[] = [];
    const skipped: string[] = [];

    // Create categories first
    const categoryNames = Array.from(new Set(CHANNELS_TO_CREATE.map(c => c.category)));
    const categoryMap: Record<string, string> = {};

    for (const catName of categoryNames) {
      const existing = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catName.toLowerCase()
      );
      if (existing) {
        categoryMap[catName] = existing.id;
      } else {
        try {
          const cat = await guild.channels.create({
            name: catName,
            type: ChannelType.GuildCategory,
          });
          categoryMap[catName] = cat.id;
          results.push(`✓ Kategori: ${catName}`);
        } catch {
          results.push(`⚠️ Kategori feil: ${catName}`);
        }
      }
    }

    // Create channels
    for (const ch of CHANNELS_TO_CREATE) {
      const cleanName = ch.name.replace(/[^\w\-]/g, '').toLowerCase();
      const exists = guild.channels.cache.some(c => c.name === ch.name || c.name === cleanName);

      if (exists) {
        skipped.push(ch.name);
        continue;
      }

      try {
        await guild.channels.create({
          name: ch.name,
          type: ch.type as ChannelType.GuildText,
          parent: categoryMap[ch.category],
        });
        results.push(`✓ Kanal: ${ch.name}`);
      } catch {
        results.push(`⚠️ Feil: ${ch.name}`);
      }
    }

    // Create roles
    const existingRoles = guild.roles.cache.map(r => r.name.toLowerCase());
    for (const role of ROLES_TO_CREATE) {
      if (existingRoles.includes(role.name.toLowerCase())) {
        skipped.push(`@${role.name}`);
        continue;
      }
      try {
        await guild.roles.create({ name: role.name, color: role.color });
        results.push(`✓ Rolle: @${role.name}`);
      } catch {
        results.push(`⚠️ Rolle feil: @${role.name}`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('⚙️ Setup fullført')
      .addFields(
        {
          name: `Opprettet (${results.length})`,
          value: results.length ? results.join('\n') : 'Ingen nye elementer',
        },
        {
          name: `Hoppet over – finnes allerede (${skipped.length})`,
          value: skipped.length ? skipped.slice(0, 10).join(', ') : 'Ingen',
        }
      )
      .setFooter({ text: 'Stream Control' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
