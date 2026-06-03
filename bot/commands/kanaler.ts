import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  TextChannel,
} from 'discord.js';
import OpenAI from 'openai';

async function lastAktivitet(channel: TextChannel): Promise<string> {
  try {
    const msgs = await channel.messages.fetch({ limit: 1 });
    const last = msgs.first();
    if (!last) return 'aldri';
    const days = Math.floor((Date.now() - last.createdTimestamp) / 86_400_000);
    if (days === 0) return 'i dag';
    if (days === 1) return 'i går';
    return `${days} dager siden`;
  } catch {
    return 'ukjent';
  }
}

async function inaktiveDager(channel: TextChannel): Promise<number> {
  try {
    const msgs = await channel.messages.fetch({ limit: 1 });
    const last = msgs.first();
    if (!last) return 999;
    return Math.floor((Date.now() - last.createdTimestamp) / 86_400_000);
  } catch {
    return 999;
  }
}

export const kanalerCommand = {
  data: new SlashCommandBuilder()
    .setName('kanaler')
    .setDescription('Administrer Discord-kanaler med AI-hjelp.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('analyse').setDescription('AI analyserer kanalene og foreslår endringer.')
    )
    .addSubcommand(sub =>
      sub
        .setName('opprett')
        .setDescription('Opprett en ny tekstkanal.')
        .addStringOption(opt =>
          opt.setName('navn').setDescription('Navn på kanalen').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('kategori').setDescription('Kategori å plassere kanalen i').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('rydd').setDescription('Vis inaktive kanaler og slett dem.')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'analyse') return handleAnalyse(interaction);
    if (sub === 'opprett') return handleOpprett(interaction);
    if (sub === 'rydd') return handleRydd(interaction);
  },
};

async function handleAnalyse(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild!;

  const linjer: string[] = [];
  for (const [, ch] of guild.channels.cache.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (ch.type === ChannelType.GuildCategory) {
      linjer.push(`[KATEGORI: ${ch.name}]`);
    } else if (ch.type === ChannelType.GuildText) {
      const akt = await lastAktivitet(ch as TextChannel);
      linjer.push(`  #${ch.name} — siste aktivitet: ${akt}`);
    } else if (ch.type === ChannelType.GuildVoice) {
      linjer.push(`  🔊 ${ch.name} (tale)`);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return interaction.editReply('⚠️ OPENAI_API_KEY mangler.');

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Du er Discord-administrator for GLENVEX, et norsk Twitch streaming community.

Nåværende serverstruktur:
${linjer.join('\n')}

Gi en analyse på norsk med disse tre punktene:
1. **Bør slettes** – kanaler som er inaktive eller unødvendige (med begrunnelse)
2. **Mangler** – kanaler som ville gitt verdi for et aktivt Twitch-community
3. **Struktur** – er organiseringen logisk? Noe som bør flyttes eller renames?

Vær konkret. Maks 350 ord.`,
      },
    ],
    max_tokens: 600,
    temperature: 0.7,
  });

  const analyse = response.choices[0]?.message?.content ?? 'Ingen analyse tilgjengelig.';

  const embed = new EmbedBuilder()
    .setColor(0x00ff41)
    .setTitle('◆ Kanal-analyse')
    .setDescription(analyse)
    .setFooter({ text: `${guild.channels.cache.size} kanaler analysert • GLENVEX Stream Control` })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleOpprett(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild!;
  const navn = interaction.options.getString('navn', true);
  const kategoriNavn = interaction.options.getString('kategori');

  let parentId: string | undefined;
  if (kategoriNavn) {
    const cat = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory &&
           c.name.toLowerCase() === kategoriNavn.toLowerCase()
    );
    if (cat) parentId = cat.id;
  }

  try {
    const channel = await guild.channels.create({
      name: navn,
      type: ChannelType.GuildText,
      parent: parentId,
    });
    const plassering = kategoriNavn ? ` under **${kategoriNavn}**` : '';
    return interaction.editReply(`✓ Kanal **#${channel.name}** opprettet${plassering}.`);
  } catch (error) {
    return interaction.editReply(`⚠️ Kunne ikke opprette kanal: ${(error as Error).message}`);
  }
}

async function handleRydd(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild!;

  const GRENSE_DAGER = 30;
  const inaktive: { id: string; name: string; days: number }[] = [];

  for (const [, ch] of guild.channels.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    const days = await inaktiveDager(ch as TextChannel);
    if (days >= GRENSE_DAGER) {
      inaktive.push({ id: ch.id, name: ch.name, days });
    }
  }

  if (inaktive.length === 0) {
    return interaction.editReply(`✓ Ingen inaktive kanaler – alle har aktivitet siste ${GRENSE_DAGER} dager.`);
  }

  const embed = new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle('◆ Inaktive kanaler')
    .setDescription(`Kanaler uten aktivitet de siste **${GRENSE_DAGER} dagene**. Trykk for å slette.`)
    .addFields(
      inaktive.slice(0, 25).map(c => ({
        name: `#${c.name}`,
        value: c.days === 999 ? 'Aldri brukt' : `${c.days} dager siden`,
        inline: true,
      }))
    )
    .setFooter({ text: 'GLENVEX Stream Control' })
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const batch = inaktive.slice(0, 25);
  for (let i = 0; i < batch.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      batch.slice(i, i + 5).map(c =>
        new ButtonBuilder()
          .setCustomId(`slett_kanal_${c.id}`)
          .setLabel(`Slett #${c.name}`)
          .setStyle(ButtonStyle.Danger)
      )
    );
    rows.push(row);
  }

  return interaction.editReply({ embeds: [embed], components: rows });
}

export async function handleSlettKanalKnapp(interaction: ButtonInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '⛔ Kun administratorer kan slette kanaler.', ephemeral: true });
  }

  const channelId = interaction.customId.replace('slett_kanal_', '');
  const channel = interaction.guild?.channels.cache.get(channelId);

  if (!channel) {
    return interaction.update({ content: '⚠️ Kanalen finnes ikke lenger.', embeds: [], components: [] });
  }

  try {
    const name = channel.name;
    await channel.delete('Slettet via /kanaler rydd');
    return interaction.update({ content: `✓ **#${name}** er slettet.`, embeds: [], components: [] });
  } catch (error) {
    return interaction.reply({ content: `⚠️ Feil: ${(error as Error).message}`, ephemeral: true });
  }
}
