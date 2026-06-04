import { NextRequest, NextResponse } from 'next/server';
import { getChatKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    navn: string;
    beskrivelse: string;
    pris: string;
    lenke: string;
    bildeUrl?: string;
  };

  const kanalId = await getChatKanalId();
  if (!kanalId) return NextResponse.json({ error: 'DISCORD_CHAT_CHANNEL_ID mangler' }, { status: 400 });

  const embed: any = {
    title: `🛍️ ${body.navn}`,
    description: `${body.beskrivelse}\n\n**Pris:** ${body.pris}\n\n[Kjøp her](${body.lenke})`,
    color: 0x00ff41,
    footer: { text: 'GLENVEX • Merch' },
    timestamp: new Date().toISOString(),
  };
  if (body.bildeUrl) embed.image = { url: body.bildeUrl };

  const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ content: '🔥 Nytt fra GLENVEX!', embeds: [embed] }),
  });

  if (!res.ok) return NextResponse.json({ error: 'Discord feil' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
