import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { getMember, getAllMembers, upsertMember, ALLE_BADGES, nesteBadge, levelFromXP } from '../lib/memberTracker';

const XP_PER_LEVEL = 500;

function progressBar(pct: number, len = 14): string {
  const filled = Math.round((pct / 100) * len);
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

    const target  = interaction.options.getUser('bruker') ?? interaction.user;
    let member    = getMember(target.id);

    // Opprett stub om personen ikke finnes ennå
    if (!member) {
      const dn = (target as any).displayName ?? target.username;
      member = upsertMember(target.id, target.username, dn);
    }

    // ── XP og level ──────────────────────────────────────────────────────────
    const level       = levelFromXP(member.xp);
    const currentBase = (level - 1) * XP_PER_LEVEL;
    const xpInLevel   = member.xp - currentBase;
    const xpForNext   = XP_PER_LEVEL;
    const levelPct    = Math.round((xpInLevel / xpForNext) * 100);

    // ── Rang ─────────────────────────────────────────────────────────────────
    const { rank, total, pct: rankPct } = rankOf(member.id);
    const rangTittel = xpRangTittel(member.xp);
    const farge      = xpFargeKode(member.xp);

    // ── Badges ───────────────────────────────────────────────────────────────
    const opptjentBadges = ALLE_BADGES.filter(b => member!.badges.includes(b.navn));
    const nesteMål       = nesteBadge(member);

    // Vis emojis for opptjente badges
    const badgeRad = opptjentBadges.length > 0
      ? opptjentBadges.slice(-8).map(b => b.emoji).join(' ')
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

    // ── Neste badge-fremgang ──────────────────────────────────────────────────
    const nesteBadgeTekst = nesteMål
      ? `${nesteMål.badge.emoji} **${nesteMål.badge.navn}** — ${nesteMål.mangler}\n${progressBar(nesteMål.pct)} ${Math.round(nesteMål.pct)}%\n*${nesteMål.badge.beskrivelse}*`
      : '✅ Alle badges opptjent!';

    // ── Embed ─────────────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(farge)
      .setTitle(`${rangTittel}  ·  ${member.displayName}`)
      .setDescription(
        `**Level ${level}** · Rank **#${rank}** av ${total}${total > 1 ? ` · Topp **${100 - rankPct}%**` : ''}\n` +
        `\`${progressBar(levelPct)}\` ${xpInLevel}/${xpForNext} XP til neste level`
      )
      .addFields(
        {
          name: '📊 Total XP',
          value: `**${member.xp.toLocaleString('no-NO')} XP**\n${xpForNext - xpInLevel} XP til Level ${level + 1}`,
          inline: true,
        },
        {
          name: '🔥 Streak',
          value: streakTekst,
          inline: true,
        },
        {
          name: '🏅 Badges',
          value: `${badgeRad}\n${opptjentBadges.length}/${ALLE_BADGES.length} opptjent`,
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
  },
};
