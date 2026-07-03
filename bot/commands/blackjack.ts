import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from 'discord.js';
import { playBlackjack, hitBlackjack, standBlackjack, formatHand, Card } from '../lib/blackjackEngine';

// In-memory active games: messageId → game state
const activeGames = new Map<string, {
  workspaceId: string;
  discordId:   string;
  bet:         number;
  playerCards: Card[];
  dealerCards: Card[];
  deck:        Card[];
}>();

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Spill Blackjack med dine Coins!')
  .addIntegerOption(o => o.setName('innsats').setDescription('Antall coins å satse').setRequired(true).setMinValue(1));

export async function execute(interaction: ChatInputCommandInteraction, workspaceId: string): Promise<void> {
  const discordId = interaction.user.id;
  const bet       = interaction.options.getInteger('innsats', true);

  await interaction.deferReply({ ephemeral: false });

  const result = await playBlackjack(workspaceId, discordId, bet);

  if (!result.ok) {
    const messages: Record<string, string> = {
      disabled:           '❌ Blackjack er ikke aktivert for dette serveret.',
      cooldown:           `⏳ Vent **${result.remaining}** sekunder før du spiller igjen.`,
      bet_too_low:        '❌ Innsatsen er for lav.',
      bet_too_high:       '❌ Innsatsen er for høy.',
      insufficient_coins: '❌ Du har ikke nok coins.',
    };
    await interaction.editReply(messages[result.error] ?? '❌ Ukjent feil.');
    return;
  }

  const { state } = result;

  if (state.outcome) {
    // Instant blackjack
    const embed = buildResultEmbed(state.playerCards, state.dealerCards, state.playerScore, state.dealerScore, state.outcome, state.coinsDelta, state.newBalance, false);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Game in progress
  const embed = buildGameEmbed(state.playerCards, state.dealerCards, state.playerScore, bet);
  const row   = buildActionRow(interaction.id);
  const msg   = await interaction.editReply({ embeds: [embed], components: [row] });

  activeGames.set(msg.id, {
    workspaceId,
    discordId,
    bet,
    playerCards: state.playerCards,
    dealerCards: state.dealerCards,
    deck:        [], // Deck state managed in memory via shuffle in engine; pass remaining cards
  });

  // Auto-expire after 5 minutes
  setTimeout(() => activeGames.delete(msg.id), 300_000);
}

function buildGameEmbed(playerCards: Card[], dealerCards: Card[], playerScore: number, bet: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x00ff41)
    .setTitle('🃏 Blackjack')
    .addFields(
      { name: 'Din hånd',       value: `${formatHand(playerCards)} **(${playerScore})**`, inline: true },
      { name: "Dealer's hånd",  value: `${formatHand(dealerCards, true)} **(?)**`,        inline: true },
      { name: 'Innsats',        value: `🪙 ${bet}`,                                        inline: false },
    )
    .setFooter({ text: 'Trykk Hit for å ta et kort, Stand for å stå.' });
}

function buildResultEmbed(
  playerCards: Card[], dealerCards: Card[],
  playerScore: number, dealerScore: number,
  outcome: string, coinsDelta: number, newBalance: number,
  showDealer: boolean,
): EmbedBuilder {
  const outcomeText: Record<string, string> = {
    blackjack: '🎉 BLACKJACK! +150%',
    win:       '✅ Du vant!',
    push:      '🤝 Uavgjort — innsats tilbake.',
    loss:      '❌ Du tapte.',
  };

  const deltaStr = coinsDelta >= 0 ? `+${coinsDelta}` : `${coinsDelta}`;

  return new EmbedBuilder()
    .setColor(outcome === 'loss' ? 0xff4444 : 0x00ff41)
    .setTitle(`🃏 Blackjack — ${outcomeText[outcome] ?? outcome}`)
    .addFields(
      { name: 'Din hånd',      value: `${formatHand(playerCards)} **(${playerScore})**`,                                                        inline: true },
      { name: "Dealer's hånd", value: `${showDealer ? formatHand(dealerCards) : formatHand(dealerCards, false)} **(${dealerScore})**`, inline: true },
      { name: 'Resultat',      value: `${deltaStr} coins — Saldo: 🪙 ${newBalance}`,                                                            inline: false },
    );
}

function buildActionRow(interactionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bj_hit_${interactionId}`).setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj_stand_${interactionId}`).setLabel('Stand ✋').setStyle(ButtonStyle.Secondary),
  );
}

export async function handleBlackjackButton(btn: ButtonInteraction, workspaceId: string): Promise<void> {
  const msgId = btn.message.id;
  const game  = activeGames.get(msgId);

  if (!game) {
    await btn.reply({ content: '❌ Dette spillet er utløpt. Start et nytt med `/blackjack`.', ephemeral: true });
    return;
  }

  if (game.discordId !== btn.user.id) {
    await btn.reply({ content: '❌ Dette er ikke ditt spill.', ephemeral: true });
    return;
  }

  await btn.deferUpdate();

  const isHit = btn.customId.startsWith('bj_hit_');

  if (isHit) {
    const state = await hitBlackjack(workspaceId, game.discordId, game.bet, game.playerCards, game.dealerCards, game.deck);
    game.playerCards = state.playerCards;

    if (state.outcome) {
      activeGames.delete(msgId);
      const embed = buildResultEmbed(state.playerCards, state.dealerCards, state.playerScore, state.dealerScore, state.outcome, state.coinsDelta, state.newBalance, true);
      await btn.editReply({ embeds: [embed], components: [] });
    } else {
      const embed = buildGameEmbed(state.playerCards, state.dealerCards, state.playerScore, game.bet);
      await btn.editReply({ embeds: [embed], components: [buildActionRow(btn.message.id)] });
    }
  } else {
    const state = await standBlackjack(workspaceId, game.discordId, game.bet, game.playerCards, game.dealerCards, game.deck);
    activeGames.delete(msgId);
    const embed = buildResultEmbed(state.playerCards, state.dealerCards, state.playerScore, state.dealerScore, state.outcome!, state.coinsDelta, state.newBalance, true);
    await btn.editReply({ embeds: [embed], components: [] });
  }
}
