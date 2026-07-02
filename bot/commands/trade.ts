import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  createTradeOffer,
  acceptTradeOffer,
  declineTradeOffer,
  findUserCardByTitle,
  getPendingOffers,
} from '../lib/tradeService';
import { logSystemEvent } from '../lib/systemEvents';

const DISCORD_API = 'https://discord.com/api/v10';

function botToken() { return process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN ?? ''; }

async function sendDM(userId: string, content: string, embeds?: object[], components?: object[]): Promise<void> {
  const token = botToken();
  if (!token) return;
  try {
    const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!dmRes.ok) return;
    const { id: channelId } = await dmRes.json() as { id: string };
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: embeds ?? [], components: components ?? [] }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {}
}

// ── /trade command ────────────────────────────────────────────────────────────

export const tradeCommand = {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Handle GLENVEX samlekort med andre brukere.')
    .addSubcommand(sub =>
      sub.setName('tilby')
        .setDescription('Tilby et kort til en annen bruker.')
        .addUserOption(opt => opt.setName('bruker').setDescription('Hvem vil du handle med?').setRequired(true))
        .addStringOption(opt => opt.setName('kort').setDescription('Kortets navn (del av tittelen er nok)').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub.setName('mine')
        .setDescription('Se dine aktive handelstilbud.'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === 'mine') {
        const offers = await getPendingOffers(interaction.user.id);
        if (offers.length === 0) {
          await interaction.editReply({ content: '📦 Du har ingen aktive handelstilbud.' });
          return;
        }
        const lines = offers.map(o => {
          const dir = o.from_user_id === interaction.user.id ? `→ <@${o.to_user_id}>` : `← <@${o.from_user_id}>`;
          const exp = o.expires_at ? `<t:${Math.floor(new Date(o.expires_at).getTime() / 1000)}:R>` : '–';
          return `\`${o.id.slice(0, 8)}\` ${dir}  |  Status: ${o.status}  |  Utløper: ${exp}`;
        });
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xf9a825)
            .setTitle('🤝 Dine handelstilbud')
            .setDescription(lines.join('\n'))],
        });
        return;
      }

      if (sub === 'tilby') {
        const targetUser  = interaction.options.getUser('bruker', true);
        const kortQuery   = interaction.options.getString('kort', true);
        const fromId      = interaction.user.id;
        const toId        = targetUser.id;

        if (fromId === toId) {
          await interaction.editReply({ content: '❌ Du kan ikke handle med deg selv.' });
          return;
        }

        // Find card by title for the sender
        const card = await findUserCardByTitle(fromId, kortQuery);
        if (!card) {
          await interaction.editReply({
            content: `❌ Fant ikke noe handlebart kort med tittelen "${kortQuery}" i din samling.`,
          });
          return;
        }

        const result = await createTradeOffer({
          fromUserId:    fromId,
          toUserId:      toId,
          offeredCardId: card.id,
        });

        if (!result.ok) {
          if (result.error === 'table_missing') {
            await interaction.editReply({ content: '⚠️ Handelsystemet er ikke aktivert ennå. Kontakt admin.' });
          } else {
            await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setColor(0xff3333)
                .setTitle('❌ Handel feilet')
                .setDescription(result.reason ?? 'Ukjent feil')],
            });
          }
          logSystemEvent({
            source: 'trade', event_type: 'TRADE_FAILED',
            title: `/trade tilby feilet: ${result.reason}`,
            severity: 'warning',
            metadata: { from_user: fromId, to_user: toId, card_id: card.id, reason: result.reason },
          });
          return;
        }

        const tradeId  = result.trade!.id;
        const expiresTs = result.trade!.expires_at
          ? Math.floor(new Date(result.trade!.expires_at).getTime() / 1000)
          : null;

        // Confirm to sender
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x00ff41)
            .setTitle('🤝 Handelstilbud sendt!')
            .setDescription(
              `Du tilbyr **${card.title}** (${card.rarity}) til <@${toId}>.\n` +
              (expiresTs ? `Tilbudet utløper <t:${expiresTs}:R>.` : ''),
            )],
        });

        // DM receiver with accept/decline buttons
        const acceptBtn = new ButtonBuilder()
          .setCustomId(`trade_accept:${tradeId}:${toId}`)
          .setLabel('✅ Aksepter')
          .setStyle(ButtonStyle.Success);
        const declineBtn = new ButtonBuilder()
          .setCustomId(`trade_decline:${tradeId}:${toId}`)
          .setLabel('❌ Avslå')
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, declineBtn);

        await sendDM(
          toId,
          '',
          [new EmbedBuilder()
            .setColor(0x9146ff)
            .setTitle('🤝 Du har mottatt et handelstilbud!')
            .setDescription(
              `**<@${fromId}>** vil gi deg kortet:\n` +
              `**${card.title}** (${card.rarity})\n\n` +
              (expiresTs ? `Tilbudet utløper <t:${expiresTs}:R>.` : '') +
              `\n\nGå til Discord-serveren for å akseptere eller avslå.`,
            ).toJSON()],
          [row.toJSON()],
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Ukjent feil';
      try { await interaction.editReply({ content: '⚠️ Handel feilet. Prøv igjen.' }); } catch {}
      logSystemEvent({
        source: 'trade', event_type: 'TRADE_FAILED',
        title: `/trade kastet feil: ${msg}`,
        severity: 'error',
        metadata: { discordId: interaction.user.id, error: msg, stack: err?.stack?.slice(0, 500) },
      });
    }
  },
};

// ── Button handler ────────────────────────────────────────────────────────────

export async function handleTradeButton(interaction: ButtonInteraction): Promise<void> {
  const parts    = interaction.customId.split(':');
  const action   = parts[0];
  const tradeId  = parts[1];
  const ownerId  = parts[2];

  await interaction.deferReply({ ephemeral: true });
  try {
    const userId = interaction.user.id;

    if (ownerId && ownerId !== userId) {
      await interaction.editReply({ content: '❌ Denne handelen gjelder ikke deg.' });
      return;
    }

    if (action === 'trade_accept') {
      const result = await acceptTradeOffer(tradeId, userId);
      if (!result.ok) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xff3333).setTitle('❌ Aksept feilet').setDescription(result.reason ?? 'Ukjent feil')],
        });
        return;
      }

      const trade = result.trade!;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x00ff41).setTitle('✅ Handel fullført!').setDescription('Kortet er overført til deg.')],
      });

      // Notify sender
      await sendDM(trade.from_user_id, '', [
        new EmbedBuilder()
          .setColor(0x00ff41)
          .setTitle('✅ Handelstilbud akseptert!')
          .setDescription(`<@${userId}> aksepterte tilbudet. Kortet er overført.`)
          .toJSON(),
      ]);

    } else if (action === 'trade_decline') {
      const result = await declineTradeOffer(tradeId, userId);
      await interaction.editReply({
        content: result.ok ? '❌ Tilbud avslått.' : (result.reason ?? 'Feil ved avslag.'),
      });

      if (result.ok) {
        const trade = result.trade!;
        await sendDM(trade.from_user_id, '', [
          new EmbedBuilder()
            .setColor(0xff3333)
            .setTitle('❌ Handelstilbud avslått')
            .setDescription(`<@${userId}> avslo handelstilbudet ditt.`)
            .toJSON(),
        ]);
      }
    }
  } catch (err: any) {
    const msg = err?.message ?? 'Ukjent feil';
    try { await interaction.editReply({ content: '⚠️ Noe gikk galt. Prøv igjen.' }); } catch {}
    logSystemEvent({
      source: 'trade', event_type: 'TRADE_FAILED',
      title: `Trade-knapp feilet: ${msg}`,
      severity: 'error',
      metadata: { discordId: interaction.user.id, action, tradeId, error: msg },
    });
  }
}
