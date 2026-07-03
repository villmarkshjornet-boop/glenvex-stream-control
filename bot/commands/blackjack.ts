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

// In-memory active games: gameId → game state
const activeGames = new Map<string, {
  workspaceId: string;
  discordId:   string;
  bet:         number;
  playerCards: Card[];
  dealerCards: Card[];
  deck:        Card[];
}>();

function generateGameId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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
  const gameId = generateGameId();
  const embed  = buildGameEmbed(state.playerCards, state.dealerCards, state.playerScore, bet);
  const row    = buildActionRow(gameId, discordId);
  await interaction.editReply({ embeds: [embed], components: [row] });

  activeGames.set(gameId, {
    workspaceId,
    discordId,
    bet,
    playerCards: state.playerCards,
    dealerCards: state.dealerCards,
    deck:        state.remainingDeck,
  });

  // Auto-expire after 5 minutes
  setTimeout(() => activeGames.delete(gameId), 300_000);
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

// custom_id format: bj_hit_{gameId}_{ownerUserId}  /  bj_stand_{gameId}_{ownerUserId}
// Ownership is encoded in the button so the handler never needs a message-ID lookup.
function buildActionRow(gameId: string, ownerUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bj_hit_${gameId}_${ownerUserId}`).setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj_stand_${gameId}_${ownerUserId}`).setLabel('Stand ✋').setStyle(ButtonStyle.Secondary),
  );
}

export async function handleBlackjackButton(btn: ButtonInteraction, workspaceId: string): Promise<void> {
  // custom_id: bj_hit_{gameId}_{ownerUserId}  or  bj_stand_{gameId}_{ownerUserId}
  const isHit     = btn.customId.startsWith('bj_hit_');
  const withoutPrefix = btn.customId.replace(/^bj_(hit|stand)_/, '');
  // ownerUserId is the last segment; gameId is everything before the final underscore
  const lastUnderscore = withoutPrefix.lastIndexOf('_');
  const gameId      = withoutPrefix.slice(0, lastUnderscore);
  const ownerUserId = withoutPrefix.slice(lastUnderscore + 1);

  const allowed = btn.user.id === ownerUserId;
  const action  = isHit ? 'hit' : 'stand';
  console.log(`[BLACKJACK] buttonUserId=${btn.user.id} ownerUserId=${ownerUserId} gameId=${gameId} action=${action} allowed=${allowed}`);

  if (!allowed) {
    await btn.reply({ content: '❌ Dette er ikke ditt spill.', ephemeral: true });
    return;
  }

  const game = activeGames.get(gameId);

  if (!game) {
    await btn.reply({ content: '❌ Dette spillet er utløpt. Start et nytt med `/blackjack`.', ephemeral: true });
    return;
  }

  // Sanity: double-check against stored discordId
  if (game.discordId !== btn.user.id) {
    await btn.reply({ content: '❌ Feil spill-ID. Start et nytt med `/blackjack`.', ephemeral: true });
    return;
  }

  await btn.deferUpdate();

  if (isHit) {
    const state = await hitBlackjack(workspaceId, game.discordId, game.bet, game.playerCards, game.dealerCards, game.deck);
    game.playerCards = state.playerCards;
    game.deck        = state.remainingDeck;

    if (state.outcome) {
      activeGames.delete(gameId);
      const embed = buildResultEmbed(state.playerCards, state.dealerCards, state.playerScore, state.dealerScore, state.outcome, state.coinsDelta, state.newBalance, true);
      await btn.editReply({ embeds: [embed], components: [] });
    } else {
      const embed = buildGameEmbed(state.playerCards, state.dealerCards, state.playerScore, game.bet);
      await btn.editReply({ embeds: [embed], components: [buildActionRow(gameId, ownerUserId)] });
    }
  } else {
    const state = await standBlackjack(workspaceId, game.discordId, game.bet, game.playerCards, game.dealerCards, game.deck);
    activeGames.delete(gameId);
    const embed = buildResultEmbed(state.playerCards, state.dealerCards, state.playerScore, state.dealerScore, state.outcome!, state.coinsDelta, state.newBalance, true);
    await btn.editReply({ embeds: [embed], components: [] });
  }
}
