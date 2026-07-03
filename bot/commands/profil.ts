import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { getMember, getAllMembers, upsertMember } from '../lib/memberTracker';
import { XP_PER_LEVEL, levelFromXP, xpIntoCurrentLevel, levelProgress } from '@/lib/xp';
import { getBalance } from '../lib/coinService';
import { logSystemEvent } from '../lib/systemEvents';
import { WORKSPACE_ID, getBotDb } from '../lib/supabase';
import { getRankForLevel, prestigeDisplay } from '../lib/rankService';
import { getMemberBadges, MemberBadge } from '../lib/badgeService';
import { getAchievementCounts } from '../lib/achievementService';
import { getShowcaseCard } from '../lib/cardService';

function progressBar(pct: number, len = 14): string {
  const filled = Math.max(0, Math.round((pct / 100) * len));
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, len - filled));
}

function tidSiden(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 2)  return 'nettopp';
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  return `${d}d siden`;
}

function leaderboardPos(userId: string): { rank: number; total: number } | null {
  const all = getAllMembers().filter(m => m.xp > 0).sort((a, b) => b.xp - a.xp);
  const idx  = all.findIndex(m => m.id === userId);
  if (idx === -1) return null; // user has no XP yet — don't show a misleading rank
  return { rank: idx + 1, total: all.length };
}

// communityScore is capped at 100 in memberTracker.computeScores()
function reputationTitle(communityScore: number): string {
  if (communityScore >= 90) return '🌟 Legend';
  if (communityScore >= 60) return '🏛 Community Pillar';
  if (communityScore >= 30) return '🤝 Trusted';
  if (communityScore >= 10) return '😊 Friendly';
  return '🆕 Newcomer';
}

function parseColor(hex: string | null | undefined): number {
  if (!hex) return 0x5865F2;
  return parseInt(hex.replace('#', ''), 16) || 0x5865F2;
}

function rarityEmoji(rarity: string): string {
  const map: Record<string, string> = {
    Mythic: '🔴', Legendary: '⚜️', Epic: '💜', Rare: '💙', Uncommon: '💚', Common: '⬜',
  };
  return map[rarity] ?? '⬜';
}

export const profilCommand = {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Se community-identiteten din — rank, badges, achievements og mer.')
    .addUserOption(opt =>
      opt.setName('bruker')
        .setDescription('Hvem vil du se profilen til? (tomt = deg selv)')
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: false });
    try {
      const target = interaction.options.getUser('bruker') ?? interaction.user;
      let member   = getMember(target.id);

      if (!member) {
        const dn = (target as any).globalName ?? target.username;
        member = upsertMember(target.id, target.username, dn);
      }

      // ── XP sanitization (rawXp vs discordXp mismatch guard) ─────────────────
      const rawXp      = member.xp;
      const discordXp  = member.discordXp;
      const suspicious = rawXp > 100_000;
      const displayXp  = (suspicious && discordXp < rawXp) ? discordXp : rawXp;

      console.log(`[profil] PROFILE_XP_DEBUG userId=${target.id} rawXp=${rawXp} discordXp=${discordXp} displayXp=${displayXp} dbLevel=${member.level} computedLevel=${levelFromXP(displayXp)}`);
      if (suspicious) {
        logSystemEvent({
          source:     'bot_command',
          event_type: 'PROFILE_XP_SUSPICIOUS',
          title:      `Mistenkelig høy XP for ${target.username}: rawXp=${rawXp} discordXp=${discordXp}`,
          severity:   'warning',
          metadata:   { discordId: target.id, rawXp, discordXp, displayXp, dbLevel: member.level },
        });
      }

      const level     = levelFromXP(displayXp);
      const xpInLevel = xpIntoCurrentLevel(displayXp);
      const levelPct  = levelProgress(displayXp);

      // ── Workspace + community_members DB queries ─────────────────────────────
      const db = getBotDb();
      const workspaceNamePromise: Promise<string | null> = db
        ? Promise.resolve(
            db.from('workspaces').select('brand_name').eq('id', WORKSPACE_ID).maybeSingle()
          ).then(r => (r.data?.brand_name as string | null) ?? null, () => null)
        : Promise.resolve(null);

      interface CommunityRow { prestige_level?: number; twitch_sub_months?: number; hero_count?: number }
      const communityRowPromise: Promise<CommunityRow | null> = db
        ? Promise.resolve(
            db.from('community_members')
              .select('prestige_level,twitch_sub_months,hero_count')
              .eq('workspace_id', WORKSPACE_ID)
              .eq('discord_id', target.id)
              .maybeSingle()
          ).then(r => (r.data as CommunityRow | null) ?? null, () => null)
        : Promise.resolve(null);

      // ── Parallel data fetch ──────────────────────────────────────────────────
      const [coins, rankData, dbBadges, achCounts, showcaseCard, workspaceName, communityRow] = await Promise.all([
        getBalance(target.id),
        getRankForLevel(WORKSPACE_ID, member.level).catch(() => null),
        getMemberBadges(WORKSPACE_ID, target.id).catch(() => [] as MemberBadge[]),
        getAchievementCounts(WORKSPACE_ID, target.id).catch(() => ({ unlocked: 0, total: 0 })),
        getShowcaseCard(WORKSPACE_ID, target.id).catch(() => null),
        workspaceNamePromise,
        communityRowPromise,
      ]);

      // ── Derived values ───────────────────────────────────────────────────────
      const rankName        = rankData?.rankName ?? 'Ukjent';
      const rankIcon        = rankData?.rankIcon ?? '❓';
      const prestigeLevel   = communityRow?.prestige_level   ?? 0;
      const twitchSubMonths = communityRow?.twitch_sub_months ?? 0;
      const heroCount       = communityRow?.hero_count        ?? 0;
      const communityScore  = member.communityScore;
      const lbPos           = leaderboardPos(member.id);

      const streakTekst = member.streakDays >= 30 ? `${member.streakDays} dager ⚡`
        : member.streakDays >= 7  ? `${member.streakDays} dager 🔥`
        : member.streakDays >= 2  ? `${member.streakDays} dager`
        : member.streakDays === 1 ? '1 dag — start!'
        : '—';

      // ── Description: identity signals ────────────────────────────────────────
      // Prestige (if earned), then badges (max 6), then hero count
      const descLines: string[] = [];

      if (prestigeLevel > 0) {
        descLines.push(prestigeDisplay(prestigeLevel));
        descLines.push('');
      }

      if (twitchSubMonths > 0) {
        descLines.push(`💜 Subscriber${twitchSubMonths >= 3 ? ` ×${twitchSubMonths}` : ''}`);
      }
      for (const b of dbBadges.slice(0, 6)) {
        descLines.push(`${b.badgeIcon} ${b.badgeName}`);
      }
      if (heroCount > 0) {
        descLines.push(`🏆 Hero${heroCount > 1 ? ` ×${heroCount}` : ''}`);
      }

      if (descLines.filter(l => l !== '').length === 0) {
        descLines.push('*Ingen badges ennå — vær aktiv og tjen dem!*');
      }

      // ── Build embed ──────────────────────────────────────────────────────────
      const embed = new EmbedBuilder()
        .setColor(parseColor(rankData?.color))
        .setTitle(`${rankIcon} ${rankName.toUpperCase()}`)
        .setDescription(descLines.join('\n'))
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          {
            name:   '🪙 Coins',
            value:  coins.toLocaleString('no-NO'),
            inline: true,
          },
          {
            name:   '🔥 Streak',
            value:  streakTekst,
            inline: true,
          },
          {
            name:   '📊 Level',
            value:  `Level ${level}\n\`${progressBar(levelPct)}\` ${xpInLevel.toLocaleString('no-NO')}/${XP_PER_LEVEL.toLocaleString('no-NO')} XP`,
            inline: true,
          },
          {
            name:   '🏅 Omdømme',
            value:  reputationTitle(communityScore),
            inline: true,
          },
          {
            name:   '🏆 Prestasjoner',
            value:  achCounts.total > 0
              ? `${achCounts.unlocked} / ${achCounts.total}`
              : `${achCounts.unlocked} opptjent`,
            inline: true,
          },
          {
            name:   '📈 Leaderboard',
            value:  lbPos ? `#${lbPos.rank} av ${lbPos.total}` : '—',
            inline: true,
          },
          ...(showcaseCard ? [{
            name:   '✨ Showcase Card',
            value:  `${rarityEmoji(showcaseCard.rarity)} **${showcaseCard.rarity.toUpperCase()}** — ${showcaseCard.title.slice(0, 950)}`,
            inline: false,
          }] : []),
        )
        .setFooter({
          text: `Sist aktiv: ${tidSiden(member.lastSeen)}  ·  Medlem siden: ${new Date(member.joinedAt).toLocaleDateString('no-NO')}`,
        })
        .setTimestamp();

      if (workspaceName) {
        embed.setAuthor({ name: workspaceName });
      }

      if (showcaseCard?.cardImageUrl) {
        embed.setImage(showcaseCard.cardImageUrl);
      }

      return interaction.editReply({ embeds: [embed] });

    } catch (err: any) {
      const msg = err?.message ?? 'Ukjent feil';
      console.error(`[profil] PROFILE_COMMAND_FAILED userId=${interaction.user.id}: ${msg}`);
      try {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('❌ Profil utilgjengelig')
            .setDescription('Kunne ikke laste profil akkurat nå. Prøv igjen.')],
        });
      } catch {}
      logSystemEvent({
        source:     'bot_command',
        event_type: 'PROFILE_COMMAND_FAILED',
        title:      `/profil feilet for ${interaction.user.username}: ${msg}`,
        severity:   'error',
        metadata:   { discordId: interaction.user.id, error: msg, stack: err?.stack?.slice(0, 500) },
      });
    }
  },
};
