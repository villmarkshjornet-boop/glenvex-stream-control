import { NextResponse } from 'next/server';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
}

export async function GET() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return NextResponse.json({ error: 'DISCORD_GUILD_ID mangler' }, { status: 400 });

  const [rolesRes, membersRes, botMemberRes] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${guildId}/roles`, { headers: botHeaders() }),
    fetch(`${DISCORD_API}/guilds/${guildId}/members?limit=100`, { headers: botHeaders() }),
    fetch(`${DISCORD_API}/guilds/${guildId}/members/${process.env.DISCORD_CLIENT_ID}`, { headers: botHeaders() }),
  ]);

  const roller = rolesRes.ok ? await rolesRes.json() as any[] : [];
  const discordMedlemmer = membersRes.ok ? await membersRes.json() as any[] : [];

  // Finn botens høyeste rolle-posisjon
  const botMember = botMemberRes.ok ? await botMemberRes.json() as any : null;
  const botRollePosisjoner = (botMember?.roles ?? [])
    .map((rid: string) => roller.find((r: any) => r.id === rid)?.position ?? 0);
  const botMaxPos = Math.max(0, ...botRollePosisjoner);

  // Hent XP-data fra bot
  const xpData = await hentBotData('members') ?? {};

  // Bygg rollestatistikk – merk roller boten ikke kan tildele
  const rolleStats = roller.map((r: any) => ({
    id: r.id,
    navn: r.name,
    farge: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
    fargeInt: r.color,
    antallBrukere: discordMedlemmer.filter(m => m.roles?.includes(r.id)).length,
    managed: r.managed,
    permissions: r.permissions,
    position: r.position,
    kanTildeles: !r.managed && r.position < botMaxPos,
  })).sort((a: any, b: any) => b.position - a.position);

  // Bygg membres-oversikt
  const membres = discordMedlemmer.map(m => {
    const xp = xpData[m.user?.id] ?? null;
    return {
      id: m.user?.id,
      brukernavn: m.user?.username,
      displayNavn: m.nick ?? m.user?.username,
      avatar: m.user?.avatar,
      roller: m.roles ?? [],
      rolleNavn: m.roles?.map((rid: string) => roller.find((r: any) => r.id === rid)?.name).filter(Boolean) ?? [],
      bliMedDato: m.joined_at,
      sisteAktiv: xp?.lastSeen ?? null,
      level: xp?.level ?? null,
      xp: xp?.xp ?? null,
      meldinger: xp?.messages ?? null,
    };
  });

  return NextResponse.json({ roller: rolleStats, membres, totalt: membres.length, botMaxPos });
}
