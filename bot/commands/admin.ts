import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { getMember, setXP, upsertMember } from '../lib/memberTracker';
import { XP_PER_LEVEL, levelFromXP } from '@/lib/xp';
import { awardBadge, revokeBadge } from '../lib/badgeService';
import { syncBadgeRole, syncRankRole, repairAllRoles } from '../lib/roleSyncService';
import { getCommunitySettings } from '../lib/botKanalPreferanser';
import { WORKSPACE_ID, getBotDb } from '../lib/supabase';
import { generateSubCard } from '../lib/subCardService';
import { logSystemEvent } from '../lib/systemEvents';
import { getBroadcasterUserToken } from '../lib/twitchBot';
import { getBroadcasterId } from '@/lib/twitch';

const BADGE_CHOICES = [
  { name: '⚡ H4ckerman',    value: 'h4ckerman'   },
  { name: '🏅 OG',            value: 'og'           },
  { name: '📅 Veteran 1 år',  value: 'veteran_1yr'  },
  { name: '📆 Veteran 2 år',  value: 'veteran_2yr'  },
  { name: '💜 Sub Loyalist',  value: 'sub_loyalty'  },
  { name: '💬 Chatty',        value: 'chatty'       },
  { name: '⚔️ Raider',         value: 'raider'       },
];

// Badge keys that trigger a Discord role sync (must match BadgeRoles keys)
const BADGE_ROLE_KEYS = new Set(['h4ckerman']);

export const adminCommand = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin-verktøy for GLENVEX-botten.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub =>
      sub
        .setName('boost-xp')
        .setDescription('Sett XP for en bruker til en bestemt verdi.')
        .addUserOption(opt =>
          opt.setName('bruker').setDescription('Discord-brukeren som skal få XP').setRequired(true),
        )
        .addIntegerOption(opt =>
          opt.setName('xp').setDescription('XP-verdi å sette (ikke legge til)').setRequired(true).setMinValue(0).setMaxValue(999_999),
        ),
    )

    .addSubcommandGroup(group =>
      group
        .setName('badge')
        .setDescription('Administrer badges for community-medlemmer.')
        .addSubcommand(sub =>
          sub
            .setName('give')
            .setDescription('Gi et badge til en bruker (H4ckerman er admin-only).')
            .addUserOption(opt =>
              opt.setName('bruker').setDescription('Mottaker').setRequired(true),
            )
            .addStringOption(opt =>
              opt.setName('badge').setDescription('Badge å gi').setRequired(true)
                .addChoices(...BADGE_CHOICES),
            )
            .addStringOption(opt =>
              opt.setName('notat').setDescription('Valgfritt notat for audit log').setRequired(false),
            ),
        )
        .addSubcommand(sub =>
          sub
            .setName('revoke')
            .setDescription('Ta tilbake et badge fra en bruker.')
            .addUserOption(opt =>
              opt.setName('bruker').setDescription('Brukeren').setRequired(true),
            )
            .addStringOption(opt =>
              opt.setName('badge').setDescription('Badge å ta tilbake').setRequired(true)
                .addChoices(...BADGE_CHOICES),
            ),
        ),
    )

    .addSubcommand(sub =>
      sub
        .setName('sync-roles')
        .setDescription('Reparer alle Discord-roller basert på rank og badges i DB.'),
    )

    .addSubcommand(sub =>
      sub
        .setName('backfill-sub-cards')
        .setDescription('Hent Twitch-sub-liste og synkroniser sub-status + SUB-kort for alle linkede brukere.'),
    )

    .addSubcommand(sub =>
      sub
        .setName('repair-sub-status')
        .setDescription('Reparer twitch_sub_status for linkede brukere basert på historisk sub-data (uten Twitch API).'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Server-side permission guard — Discord enforces this at the UI level too,
    // but we double-check so misconfigured server permissions can't bypass it.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ Krever tillatelsen **Manage Server**.', ephemeral: true });
      return;
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── boost-xp ────────────────────────────────────────────────────────────────
    if (sub === 'boost-xp') {
      await interaction.deferReply({ ephemeral: true });

      const target  = interaction.options.getUser('bruker', true);
      const xpValue = interaction.options.getInteger('xp', true);

      let member = getMember(target.id);
      if (!member) {
        const dn = (target as any).displayName ?? target.username;
        member = upsertMember(target.id, target.username, dn);
      }

      const oldXP    = member.xp;
      const oldLevel = member.level;
      const updated  = setXP(target.id, xpValue);

      if (!updated) {
        await interaction.editReply({ content: `❌ Fant ikke ${target.username} i member-cachen. De må ha skrevet minst én melding i serveren.` });
        return;
      }

      const newLevel   = levelFromXP(xpValue);
      const levelXP    = (newLevel - 1) * XP_PER_LEVEL;
      const curXP      = xpValue - levelXP;
      const diff       = xpValue - oldXP;
      const diffStr    = diff >= 0 ? `+${diff}` : `${diff}`;
      const levelDiff  = newLevel !== oldLevel ? ` (${oldLevel} → **${newLevel}**)` : '';

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅ XP oppdatert')
        .addFields(
          { name: 'Bruker',   value: `<@${target.id}>`,                        inline: true },
          { name: 'XP',       value: `${oldXP} → **${xpValue}** (${diffStr})`, inline: true },
          { name: 'Level',    value: `**${newLevel}**${levelDiff}`,             inline: true },
          { name: 'Progress', value: `${curXP} / ${XP_PER_LEVEL} XP til neste level`, inline: false },
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── badge give ───────────────────────────────────────────────────────────────
    if (group === 'badge' && sub === 'give') {
      await interaction.deferReply({ ephemeral: true });

      const target   = interaction.options.getUser('bruker', true);
      const badgeKey = interaction.options.getString('badge', true);
      const notat    = interaction.options.getString('notat', false) ?? null;

      const result = await awardBadge(WORKSPACE_ID, target.id, badgeKey, interaction.user.id, notat);

      if (result.alreadyHas) {
        await interaction.editReply({ content: `ℹ️ **${target.username}** har allerede badgen **${badgeKey}**.` });
        return;
      }
      if (!result.ok) {
        await interaction.editReply({ content: `❌ Feil ved badge-tildeling: ${result.error ?? 'ukjent'}` });
        return;
      }

      // Sync Discord role if this badge has one configured
      if (BADGE_ROLE_KEYS.has(badgeKey) && interaction.guild) {
        const settings = await getCommunitySettings().catch(() => null);
        if (settings) {
          const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
          if (guildMember) {
            await syncBadgeRole(interaction.guild, guildMember, badgeKey as any, settings.badgeRoles, true, WORKSPACE_ID).catch(() => {});
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅ Badge gitt')
        .addFields(
          { name: 'Bruker',  value: `<@${target.id}>`, inline: true },
          { name: 'Badge',   value: badgeKey,           inline: true },
          { name: 'Tildelt', value: `av <@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: `${notat ?? ''}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── badge revoke ─────────────────────────────────────────────────────────────
    if (group === 'badge' && sub === 'revoke') {
      await interaction.deferReply({ ephemeral: true });

      const target   = interaction.options.getUser('bruker', true);
      const badgeKey = interaction.options.getString('badge', true);

      const result = await revokeBadge(WORKSPACE_ID, target.id, badgeKey, interaction.user.id);

      if (!result.ok) {
        await interaction.editReply({ content: `❌ Feil ved badge-tilbaketaking (kanskje brukeren ikke har badgen?).` });
        return;
      }

      // Remove Discord role if this badge has one configured
      if (BADGE_ROLE_KEYS.has(badgeKey) && interaction.guild) {
        const settings = await getCommunitySettings().catch(() => null);
        if (settings) {
          const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
          if (guildMember) {
            await syncBadgeRole(interaction.guild, guildMember, badgeKey as any, settings.badgeRoles, false, WORKSPACE_ID).catch(() => {});
          }
        }
      }

      await interaction.editReply({
        content: `✅ Badge **${badgeKey}** er tatt tilbake fra **${target.username}**.`,
      });
      return;
    }

    // ── sync-roles ───────────────────────────────────────────────────────────────
    if (sub === 'sync-roles') {
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: '❌ Kan bare kjøres i en server.' });
        return;
      }

      const settings = await getCommunitySettings().catch(() => null);
      if (!settings) {
        await interaction.editReply({ content: '❌ Kunne ikke hente community-innstillinger.' });
        return;
      }

      await interaction.editReply({ content: '⏳ Starter rolle-reparasjon for alle medlemmer...' });

      const { repaired, errors } = await repairAllRoles(
        WORKSPACE_ID,
        guild,
        settings.rankRoles,
        settings.badgeRoles,
      );

      const embed = new EmbedBuilder()
        .setColor(errors > 0 ? 0xff8800 : 0x00ff88)
        .setTitle('🔄 Rolle-sync ferdig')
        .addFields(
          { name: '✅ Synkronisert', value: `${repaired} medlemmer`, inline: true },
          { name: '❌ Feil',         value: `${errors}`,             inline: true },
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], content: '' });
      return;
    }

    // ── backfill-sub-cards ────────────────────────────────────────────────────────
    if (sub === 'backfill-sub-cards') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ content: '⏳ Henter broadcaster-ID og Twitch-abonnenter...' });

      const db = getBotDb();
      if (!db) {
        await interaction.editReply({ content: '❌ DB ikke tilgjengelig.' });
        return;
      }

      // 1. Hent broadcaster-ID og brukertoken
      const broadcasterId = await getBroadcasterId();
      if (!broadcasterId) {
        await interaction.editReply({ content: '❌ Kunne ikke hente broadcaster-ID. Er TWITCH_USERNAME satt?' });
        return;
      }

      const broadcasterToken = await getBroadcasterUserToken();
      if (!broadcasterToken) {
        await interaction.editReply({ content: '❌ Ingen broadcaster-token tilgjengelig. Koble til Twitch på nytt i innstillinger.' });
        return;
      }

      // 2. Hent alle Twitch-subscribers med paginering
      const twitchSubs: Array<{ user_id: string; user_login: string; tier: string }> = [];
      let cursor: string | undefined;

      try {
        do {
          const helixUrl = new URL('https://api.twitch.tv/helix/subscriptions');
          helixUrl.searchParams.set('broadcaster_id', broadcasterId);
          helixUrl.searchParams.set('first', '100');
          if (cursor) helixUrl.searchParams.set('after', cursor);

          const res = await fetch(helixUrl.toString(), {
            headers: {
              Authorization: `Bearer ${broadcasterToken}`,
              'Client-Id': process.env.TWITCH_CLIENT_ID ?? '',
            },
            signal: AbortSignal.timeout(15_000),
          });

          if (res.status === 401 || res.status === 403) {
            await interaction.editReply({
              content: `❌ Mangler Twitch-scope for subscribers (HTTP ${res.status}). Koble til Twitch på nytt i innstillinger.`,
            });
            return;
          }

          if (!res.ok) {
            await interaction.editReply({ content: `❌ Twitch API feil: HTTP ${res.status}` });
            return;
          }

          const body = await res.json() as {
            data?: Array<{ user_id: string; user_login: string; tier: string }>;
            pagination?: { cursor?: string };
          };
          twitchSubs.push(...(body.data ?? []));
          cursor = body.pagination?.cursor;
        } while (cursor);
      } catch (fetchErr: any) {
        await interaction.editReply({ content: `❌ Feil ved Twitch API: ${fetchErr?.message ?? 'ukjent'}` });
        return;
      }

      // 3. Hent alle linkede community_members
      const { data: linkedMembers, error: membersErr } = await db
        .from('community_members')
        .select('discord_id, twitch_id, twitch_username, display_name, twitch_sub_status, subs')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('twitch_linked', true)
        .not('twitch_id', 'is', null);

      if (membersErr || !linkedMembers) {
        await interaction.editReply({
          content: `❌ Feil ved henting av community_members: ${membersErr?.message ?? 'ukjent'}`,
        });
        return;
      }

      // 4. Bygg sub-maps for rask matching
      const subTierById    = new Map<string, string>(); // twitch_user_id -> tier
      const subTierByLogin = new Map<string, string>(); // login.toLowerCase() -> tier

      for (const s of twitchSubs) {
        subTierById.set(s.user_id, s.tier);
        subTierByLogin.set(s.user_login.toLowerCase(), s.tier);
      }

      logSystemEvent({
        workspaceId: WORKSPACE_ID,
        source:     'admin',
        event_type: 'SUB_CARD_BACKFILL_STARTED',
        title:      `backfill-sub-cards startet: ${twitchSubs.length} Twitch-subs, ${linkedMembers.length} linkede brukere`,
        severity:   'info',
        metadata:   {
          twitchSubsCount:    twitchSubs.length,
          linkedMembersCount: linkedMembers.length,
          initiatedBy:        interaction.user.id,
        },
      });

      // 5. Match og oppdater
      let matched        = 0;
      let subUpdated     = 0;
      let cardsGenerated = 0;
      let skippedAlready = 0;
      let errors         = 0;

      for (const m of linkedMembers) {
        const discordId      = m.discord_id      as string;
        const twitchId       = m.twitch_id       as string;
        const twitchLogin    = ((m.twitch_username as string | null) ?? '').toLowerCase();
        const twitchUsername = (m.twitch_username  as string | null) ?? twitchLogin;
        const displayName    = (m.display_name    as string | null) ?? discordId;
        const existingSubs   = (m.subs            as number | null) ?? 0;

        const subTier = subTierById.get(twitchId)
          ?? (twitchLogin ? subTierByLogin.get(twitchLogin) : undefined);

        if (!subTier) continue; // ikke i Twitch-sub-listen

        matched++;

        try {
          if (!m.twitch_sub_status) {
            const { error: updErr } = await db.from('community_members').update({
              twitch_sub_status: true,
              subs:              Math.max(existingSubs, 1),
              twitch_sub_tier:   subTier,
              updated_at:        new Date().toISOString(),
            })
            .eq('workspace_id', WORKSPACE_ID)
            .eq('discord_id', discordId);

            if (updErr) { errors++; continue; }
            subUpdated++;

            logSystemEvent({
              workspaceId: WORKSPACE_ID,
              source:     'admin',
              event_type: 'COMMUNITY_MEMBER_SUB_STATUS_UPDATED',
              title:      `twitch_sub_status=true satt for ${displayName} via backfill`,
              severity:   'info',
              metadata:   { discordId, twitchId, twitchUsername, subTier },
            });
          } else {
            skippedAlready++;
          }

          const cardResult = await generateSubCard({
            workspaceId:    WORKSPACE_ID,
            discordId,
            twitchUsername,
            displayName,
            subTier,
          }).catch(() => ({ ok: false, reason: 'db_error' as const }));

          if (cardResult.ok) cardsGenerated++;

        } catch {
          errors++;
        }
      }

      logSystemEvent({
        workspaceId: WORKSPACE_ID,
        source:     'admin',
        event_type: 'SUB_CARD_BACKFILL_DONE',
        title:      `backfill-sub-cards fullført: ${matched} matcher, ${subUpdated} oppdatert, ${cardsGenerated} kort`,
        severity:   'info',
        metadata:   {
          twitchSubsTotal: twitchSubs.length,
          linkedMembers:   linkedMembers.length,
          matched,
          subUpdated,
          cardsGenerated,
          skippedAlready,
          errors,
          initiatedBy: interaction.user.id,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle('💜 SUB-kort Backfill fullført')
        .addFields(
          { name: 'Twitch subs hentet',         value: `${twitchSubs.length}`,    inline: true },
          { name: 'Linkede Discord-kontoer',     value: `${linkedMembers.length}`, inline: true },
          { name: 'Matcher (linked → sub)',       value: `${matched}`,             inline: true },
          { name: 'Oppdatert sub-status',        value: `${subUpdated}`,           inline: true },
          { name: 'Genererte SUB-kort',          value: `${cardsGenerated}`,       inline: true },
          { name: 'Skipped (allerede sub)',      value: `${skippedAlready}`,       inline: true },
          ...(errors > 0 ? [{ name: '❌ Feil', value: `${errors}`, inline: true }] : []),
        )
        .setFooter({ text: `Utført av ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], content: '' });
      return;
    }

    // ── repair-sub-status ─────────────────────────────────────────────────────
    if (sub === 'repair-sub-status') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ content: '⏳ Henter alle linkede Twitch-brukere...' });

      const db = getBotDb();
      if (!db) {
        await interaction.editReply({ content: '❌ DB ikke tilgjengelig.' });
        return;
      }

      logSystemEvent({
        workspaceId: WORKSPACE_ID,
        source:     'admin',
        event_type: 'SUB_CARD_BACKFILL_STARTED',
        title:      `repair-sub-status startet av ${interaction.user.username}`,
        severity:   'info',
        metadata:   { initiatedBy: interaction.user.id },
      });

      const { data: members, error: fetchErr } = await db
        .from('community_members')
        .select('discord_id, display_name, twitch_id, twitch_username, twitch_sub_status, subs')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('twitch_linked', true)
        .not('twitch_id', 'is', null);

      if (fetchErr || !members) {
        await interaction.editReply({
          content: `❌ Feil ved henting av membres: ${fetchErr?.message ?? 'ukjent'}`,
        });
        return;
      }

      const totalLinked    = members.length;
      let subUpdated       = 0;
      let cardsGenerated   = 0;
      let errors           = 0;

      for (const m of members) {
        const discordId      = m.discord_id      as string;
        const displayName    = (m.display_name   as string | null) ?? discordId;
        const twitchId       = m.twitch_id       as string;
        const twitchUsername = (m.twitch_username as string | null) ?? discordId;
        const alreadySub     = !!(m.twitch_sub_status as boolean | null);
        const existingSubs   = (m.subs           as number | null) ?? 0;

        if (alreadySub) continue;

        try {
          const { data: unmatchedSub } = await db
            .from('community_twitch_unlinked_subs')
            .select('sub_tier, months')
            .eq('workspace_id', WORKSPACE_ID)
            .eq('twitch_user_id', twitchId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const hasStoredSub = !!unmatchedSub || existingSubs > 0;
          if (!hasStoredSub) continue;

          const { error: updErr } = await db.from('community_members').update({
            twitch_sub_status: true,
            subs:              Math.max(existingSubs, 1),
            updated_at:        new Date().toISOString(),
          })
          .eq('workspace_id', WORKSPACE_ID)
          .eq('discord_id', discordId);

          if (updErr) { errors++; continue; }
          subUpdated++;

          const cardResult = await generateSubCard({
            workspaceId:    WORKSPACE_ID,
            discordId,
            twitchUsername,
            displayName,
            subTier:        (unmatchedSub as any)?.sub_tier ?? '1000',
          }).catch(() => ({ ok: false, reason: 'db_error' as const }));

          if (cardResult.ok) cardsGenerated++;

        } catch {
          errors++;
        }
      }

      logSystemEvent({
        workspaceId: WORKSPACE_ID,
        source:     'admin',
        event_type: 'SUB_CARD_BACKFILL_DONE',
        title:      `repair-sub-status fullført: ${subUpdated} oppdatert, ${cardsGenerated} kort generert`,
        severity:   'info',
        metadata:   {
          totalLinked,
          subUpdated,
          cardsGenerated,
          errors,
          initiatedBy: interaction.user.id,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle('💜 repair-sub-status fullført')
        .addFields(
          { name: '🔗 Linkede brukere',    value: `${totalLinked}`,    inline: true },
          { name: '✅ Sub-status reparert', value: `${subUpdated}`,    inline: true },
          { name: '🃏 Kort generert',       value: `${cardsGenerated}`, inline: true },
          ...(errors > 0 ? [{ name: '❌ Feil', value: `${errors}`, inline: true }] : []),
        )
        .setFooter({ text: `Utført av ${interaction.user.username} • ${totalLinked} brukere behandlet` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], content: '' });
      return;
    }
  },
};
