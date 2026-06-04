import { NextRequest, NextResponse } from 'next/server';
import { addLog as addRoleLog } from '@/lib/roleRules';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

export async function POST(req: NextRequest) {
  const { userId, rolleId, rolleNavn, handling, brukerNavn } = await req.json() as {
    userId: string;
    rolleId: string;
    rolleNavn: string;
    handling: 'legg_til' | 'fjern';
    brukerNavn: string;
  };

  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return NextResponse.json({ error: 'DISCORD_GUILD_ID mangler' }, { status: 400 });

  const url = `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${rolleId}`;
  const res = await fetch(url, {
    method: handling === 'legg_til' ? 'PUT' : 'DELETE',
    headers: botHeaders(),
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    return NextResponse.json({ error: `Discord feil ${res.status}: ${err}` }, { status: 500 });
  }

  // Logg rolleendringen
  addRoleLog({
    brukerNavn,
    brukerId: userId,
    rolle: rolleNavn,
    handling: handling === 'legg_til' ? 'lagt_til' : 'fjernet',
    aarsak: 'Manuell endring fra dashboard',
    utfortAv: 'admin',
  });

  return NextResponse.json({ ok: true });
}
