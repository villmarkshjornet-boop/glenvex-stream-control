import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { spinRoulette, BetType, RouletteColor } from '../lib/rouletteEngine';

const BET_TYPE_DESCRIPTIONS: Record<string, string> = {
  red:     '🔴 Rødt (1:1)',
  black:   '⚫ Sort (1:1)',
  green:   '🟢 Grønt/0 (35:1)',
  odd:     '🔢 Odde (1:1)',
  even:    '🔢 Like (1:1)',
  '1to18': '📊 1-18 (1:1)',
  '19to36':'📊 19-36 (1:1)',
  dozen1:  '1️⃣ Dusin 1-12 (2:1)',
  dozen2:  '2️⃣ Dusin 13-24 (2:1)',
  dozen3:  '3️⃣ Dusin 25-36 (2:1)',
  number:  '🎯 Spesifikt nummer (35:1)',
};

const COLOR_EMOJI: Record<RouletteColor, string> = {
  red:   '🔴',
  black: '⚫',
  green: '🟢',
};

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Spill Roulette med dine Coins!')
  .addIntegerOption(o => o.setName('innsats').setDescription('Antall coins å satse').setRequired(true).setMinValue(1))
  .addStringOption(o =>
    o.setName('type')
      .setDescription('Hva vil du satse på?')
      .setRequired(true)
      .addChoices(
        { name: '🔴 Rødt (1:1)',        value: 'red'    },
        { name: '⚫ Sort (1:1)',         value: 'black'  },
        { name: '🟢 Grønt/0 (35:1)',    value: 'green'  },
        { name: '🔢 Odde (1:1)',         value: 'odd'    },
        { name: '🔢 Like (1:1)',          value: 'even'   },
        { name: '📊 1-18 (1:1)',          value: '1to18'  },
        { name: '📊 19-36 (1:1)',         value: '19to36' },
        { name: '1️⃣ Dusin 1-12 (2:1)',   value: 'dozen1' },
        { name: '2️⃣ Dusin 13-24 (2:1)',  value: 'dozen2' },
        { name: '3️⃣ Dusin 25-36 (2:1)',  value: 'dozen3' },
        { name: '🎯 Spesifikt nummer',   value: 'number' },
      ),
  )
  .addIntegerOption(o =>
    o.setName('nummer')
      .setDescription('Kun hvis type=nummer: 0-36')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(36),
  );

export async function execute(interaction: ChatInputCommandInteraction, workspaceId: string): Promise<void> {
  const discordId = interaction.user.id;
  const bet       = interaction.options.getInteger('innsats', true);
  const betType   = interaction.options.getString('type', true) as BetType;
  const nummer    = interaction.options.getInteger('nummer', false);
  const betTarget = betType === 'number' ? String(nummer ?? 0) : null;

  await interaction.deferReply({ ephemeral: false });

  const result = await spinRoulette(workspaceId, discordId, bet, betType, betTarget);

  if (!result.ok) {
    const messages: Record<string, string> = {
      disabled:           '❌ Roulette er ikke aktivert for dette serveret.',
      cooldown:           `⏳ Vent **${result.remaining}** sekunder før du spiller igjen.`,
      bet_too_low:        '❌ Innsatsen er for lav.',
      bet_too_high:       '❌ Innsatsen er for høy.',
      insufficient_coins: '❌ Du har ikke nok coins.',
      invalid_bet:        '❌ Ugyldig nummer (0-36).',
    };
    await interaction.editReply(messages[result.error] ?? '❌ Ukjent feil.');
    return;
  }

  const { result: r } = result;
  const deltaStr      = r.coinsDelta >= 0 ? `+${r.coinsDelta}` : `${r.coinsDelta}`;
  const betDesc       = BET_TYPE_DESCRIPTIONS[betType] ?? betType;
  const targetStr     = betType === 'number' ? ` (nr. ${betTarget})` : '';

  const embed = new EmbedBuilder()
    .setColor(r.outcome === 'win' ? 0x00ff41 : 0xff4444)
    .setTitle(`🎡 Roulette — ${r.outcome === 'win' ? '✅ Gevinst!' : '❌ Tapte'}`)
    .addFields(
      { name: 'Resultat',  value: `${COLOR_EMOJI[r.color]} **${r.resultNumber}** (${r.color})`, inline: true },
      { name: 'Din sats',  value: `${betDesc}${targetStr}`,                                      inline: true },
      { name: 'Innsats',   value: `🪙 ${bet}`,                                                    inline: true },
      { name: 'Utbytte',   value: r.outcome === 'win' ? `${r.payoutRatio}:1` : '—',              inline: true },
      { name: 'Resultat',  value: `${deltaStr} coins`,                                            inline: true },
      { name: 'Ny saldo',  value: `🪙 ${r.newBalance}`,                                           inline: true },
    )
    .setFooter({ text: '🎡 Europeisk roulette · 37 tall (0-36) · Rettferdige odds' });

  await interaction.editReply({ embeds: [embed] });
}
