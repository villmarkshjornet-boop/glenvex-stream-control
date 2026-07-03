import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { getMember, getAllMembers, upsertMember, ALLE_BADGES, nesteBadge } from '../lib/memberTracker';
import { XP_PER_LEVEL, levelFromXP, xpIntoCurrentLevel, levelProgress } from '@/lib/xp';
import { getBalance } from '../lib/coinService';
import { logSystemEvent } from '../lib/systemEvents';
import { WORKSPACE_ID } from '../lib/supabase';
import { getRankForLevel, formatPrestige } from '../lib/rankService';
import { getMemberBadges } from '../lib/badgeService';
import { getPerksForRank } from '../lib/perkService';

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

function rankOf(userId: string): { rank: number; total: number; pct: number } {
  const all   = getAllMembers().filter(m => m.xp > 0).sort((a, b) => b.xp - a.xp);
  const idx   = all.findIndex(m => m.id === userId);
  const total = all.length;
  if (idx === -1) return { rank: total + 1, total, pct: 0 };
  return { rank: idx + 1, total, pct: total > 1 ? Math.round(((total - idx - 1) / (total - 1)) * 100) : 100 };
}

function xpFargeKode(xp: number): number {
  if (xp >= 25000) return 0xffd700; // champion — gull
  if (xp >= 10000) return 0xe8d44d; // legend
  if (xp >=  5000) return 0x00e676; // elite — grønn
  if (xp >=  1000) return 0x42a5f5; // veteran — blå
  return 0x4444cc;                   // ny spiller
}

function xpRangTittel(xp: number): string {
  if (xp >= 25000) return '👑 Champion';
  if (xp >= 10000) return '🥇 Legend';
  if (xp >=  5000) return '🥈 Elite';
  if (xp >=  1000) return '🥉 Veteran';
  if (xp >=    50) return '🌱 Member';
  return '🆕 Ny';
}

export const profilCommand = {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Vis XP, level, badges og statistikk.')
    .addUserOption(opt =>
      opt.setName('bruker')
        .setDescription('Hvem vil du se profilen til? (tomt = deg selv)')
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: false });
    try {
    const target  = interaction.options.getUser('bruker') ?? interaction.user;
    let member    = getMember(target.id);

    // Opprett stub om personen ikke finnes ennå
    if (!member) {
      const dn = (target as any).displayName ?? target.username;
      member = upsertMember(target.id, target.username, dn);
    }

    // Coins + Community OS data — hent parallelt
    const [coins, rankData, dbBadges] = await Promise.all([
      getBalance(target.id),
      getRankForLevel(WORKSPACE_ID, member.level).catch(() => null),
      getMemberBadges(WORKSPACE_ID, target.id).catch(() => [] as { name: string; emoji: string }[]),
    ]);

    // ── XP og level ──────────────────────────────────────────────────────────
    // If raw xp is suspiciously large, fall back to discordXp (Discord-specific column)
    const rawXp       = member.xp;
    const discordXp   = member.discordXp;
    const suspicious  = rawXp > 100_000;
    const displayXp   = (suspicious && discordXp < rawXp) ? discordXp : rawXp;

    const level     = levelFromXP(displayXp);
    const xpInLevel = xpIntoCurrentLevel(displayXp);
    const xpForNext = XP_PER_LEVEL;
    const levelPct  = levelProgress(displayXp);

    // PROFILE_XP_DEBUG — logg alltid, kritisk for feilsøking
    console.log(`[profil] PROFILE_XP_DEBUG userId=${target.id} rawXp=${rawXp} discordXp=${discordXp} displayXp=${displayXp} dbLevel=${member.level} computedLevel=${level} coins=${coins}`);
    if (suspicious) {
      logSystemEvent({
        source:     'bot_command',
        event_type: 'PROFILE_XP_SUSPICIOUS',
        title:      `Mistenkelig høy XP for ${target.username}: rawXp=${rawXp} discordXp=${discordXp} displayXp=${displayXp}`,
        severity:   'warning',
        metadata:   { discordId: target.id, rawXp, discordXp, displayXp, dbLevel: member.level, computedLevel: level, coins },
      });
    }

    // ── Rang ─────────────────────────────────────────────────────────────────
    const { rank, total, pct: rankPct } = rankOf(member.id);
    const rangTittel = xpRangTittel(displayXp);
    const farge      = xpFargeKode(displayXp);

    // ── Community OS: rank, prestige, perks ──────────────────────────────────
    const rankName      = rankData?.name ?? null;
    const rankIcon      = rankData?.icon ?? null;
    const prestigeLevel = (member as any).prestige_level ?? 0;
    const prestigeText  = prestigeLevel > 0 ? formatPrestige(prestigeLevel) : null;
    const rankPerks     = rankName
      ? await getPerksForRank(WORKSPACE_ID, rankName).catch(() => [] as { description: string }[])
      : [];
    const perksText = rankPerks.length > 0
      ? rankPerks.slice(0, 3).map(p => p.description).join(' · ')
      : null;

    // ── Badges ───────────────────────────────────────────────────────────────
    const opptjentBadges = ALLE_BADGES.filter(b => member!.badges.includes(b.navn));
    const nesteMål       = nesteBadge(member);

    // Prefer DB badges (Community OS) if available, fall back to memberTracker
    const alleBadgeEmojis: string[] = dbBadges.length > 0
      ? dbBadges.slice(-8).map(b => b.emoji)
      : opptjentBadges.slice(-8).map(b => b.emoji);

    // Vis emojis for opptjente badges
    const badgeRad = alleBadgeEmojis.length > 0
      ? alleBadgeEmojis.join(' ')
      : '—';

    // ── Streak-tekst ─────────────────────────────────────────────────────────
    const streakTekst = member.streakDays >= 30 ? `⚡ ${member.streakDays} dager — USTOPPELIG`
      : member.streakDays >= 7  ? `🔥 ${member.streakDays} dager — på rekke!`
      : member.streakDays >= 2  ? `🔥 ${member.streakDays} dager`
      : member.streakDays === 1 ? '🌱 Startet i dag'
      : '—';

    // ── XP-bidrag-tekst ──────────────────────────────────────────────────────
    const xpFordeling = [
      member.messages      > 0 ? `💬 ${member.messages} meldinger (+${member.messages * 5} XP)` : '',
      member.voiceMinutes  > 0 ? `🎙️ ${member.voiceMinutes} min voice (+${member.voiceMinutes} XP)` : '',
      member.streamsAttended>0 ? `📺 ${member.streamsAttended} streams (+${member.streamsAttended * 50} XP)` : '',
      member.subs          > 0 ? `💜 ${member.subs} sub (+${member.subs * 200} XP)` : '',
      member.giftSubs      > 0 ? `🎁 ${member.giftSubs} gifted (+${member.giftSubs * 100} XP)` : '',
      member.raids         > 0 ? `🚀 ${member.raids} raid (+${member.raids * 500} XP)` : '',
      member.reactions     > 0 ? `⚡ ${member.reactions} reaksjoner (+${member.reactions * 2} XP)` : '',
    ].filter(Boolean).slice(0, 4).join('\n') || '— Ingen aktivitet registrert ennå';

    const coinsTekst = `${coins.toLocaleString('no-NO')} coins`;

    // ── Neste badge-fremgang ──────────────────────────────────────────────────
    const nesteBadgeTekst = nesteMål
      ? `${nesteMål.badge.emoji} **${nesteMål.badge.navn}** — ${nesteMål.mangler}\n${progressBar(nesteMål.pct)} ${Math.round(nesteMål.pct)}%\n*${nesteMål.badge.beskrivelse}*`
      : '✅ Alle badges opptjent!';

    // ── Community OS: sub and hero display ───────────────────────────────────
    const twitchSubMonths = (member as any).twitch_sub_months as number | undefined ?? 0;
    const heroCount       = (member as any).hero_count as number | undefined ?? 0;

    // ── Embed ─────────────────────────────────────────────────────────────────
    const displayTitle = prestigeText
      ? `${rangTittel}  ·  ${member.displayName} ${prestigeText}`
      : `${rangTittel}  ·  ${member.displayName}`;

    const embed = new EmbedBuilder()
      .setColor(farge)
      .setTitle(displayTitle)
      .setDescription(
        `**Level ${level}** · Rank **#${rank}** av ${total}${total > 1 ? ` · Topp **${100 - rankPct}%**` : ''}\n` +
        `\`${progressBar(levelPct)}\` ${xpInLevel}/${xpForNext} XP til neste level`
      )
      .addFields(
        {
          name: '📊 Total XP',
          value: `**${displayXp.toLocaleString('no-NO')} XP**\n${xpForNext - xpInLevel} XP til Level ${level + 1}`,
          inline: true,
        },
        {
          name: '🪙 Coins',
          value: coinsTekst,
          inline: true,
        },
        {
          name: '🔥 Streak',
          value: streakTekst,
          inline: true,
        },
        {
          name: '🏅 Badges',
          value: `${badgeRad}\n${dbBadges.length > 0 ? dbBadges.length : opptjentBadges.length}/${ALLE_BADGES.length} opptjent`,
          inline: true,
        },
        {
          name: '📈 XP-kilde',
          value: xpFordeling,
          inline: false,
        },
        {
          name: '🎯 Neste badge',
          value: nesteBadgeTekst,
          inline: false,
        },
        ...(rankName ? [{
          name: '🏆 Rank',
          value: `${rankIcon ?? ''} ${rankName}${perksText ? `\n${perksText}` : ''}`.trim(),
          inline: true,
        }] : []),
        ...(twitchSubMonths > 0 ? [{
          name: '💜 Twitch Sub',
          value: `×${twitchSubMonths} måneder`,
          inline: true,
        }] : []),
        ...(heroCount > 0 ? [{
          name: '🦸 Hero',
          value: `×${heroCount} ganger`,
          inline: true,
        }] : []),
      )
      .setFooter({
        text: `Sist aktiv: ${tidSiden(member.lastSeen)}  ·  Medlem siden: ${new Date(member.joinedAt).toLocaleDateString('no-NO')}`,
      })
      .setTimestamp();

    // Vis alle badge-navn hvis brukeren ser sin egen profil
    if (target.id === interaction.user.id && opptjentBadges.length > 0) {
      embed.addFields({
        name: `🏆 Alle dine badges (${opptjentBadges.length})`,
        value: opptjentBadges.map(b => `${b.emoji} ${b.navn}`).join(' · ') || '—',
        inline: false,
      });
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
