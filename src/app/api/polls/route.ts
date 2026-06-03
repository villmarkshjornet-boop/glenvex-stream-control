import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const EMOTES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    spørsmål: string;
    alternativer: string[];
    kanalId?: string;
  };

  const kanalId = body.kanalId || process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!kanalId) return NextResponse.json({ error: 'Ingen kanal' }, { status: 400 });

  const alternativTekst = body.alternativer
    .slice(0, 4)
    .map((a, i) => `${EMOTES[i]} ${a}`)
    .join('\n');

  const embed = {
    title: `📊 ${body.spørsmål}`,
    description: alternativTekst,
    color: 0x00ff41,
    footer: { text: 'Stem med reaksjonene under! • GLENVEX' },
    timestamp: new Date().toISOString(),
  };

  const msgRes = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!msgRes.ok) return NextResponse.json({ error: 'Discord feil' }, { status: 500 });

  const msg = await msgRes.json() as any;

  // Legg til reaksjoner
  for (let i = 0; i < Math.min(body.alternativer.length, 4); i++) {
    await fetch(`${DISCORD_API}/channels/${kanalId}/messages/${msg.id}/reactions/${encodeURIComponent(EMOTES[i])}/@me`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    await new Promise(r => setTimeout(r, 300));
  }

  return NextResponse.json({ ok: true, messageId: msg.id });
}
