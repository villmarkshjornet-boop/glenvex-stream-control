import { NextRequest, NextResponse } from 'next/server';
import { getChatKanalId } from '@/lib/discordChannel';
import { addContent } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

interface StreamDay {
  dag: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
}

export async function POST(req: NextRequest) {
  const { plan } = await req.json() as { plan: StreamDay[] };
  const kanalId = await getChatKanalId();

  if (!kanalId) {
    return NextResponse.json({ error: 'DISCORD_CHAT_CHANNEL_ID mangler i Vercel env vars' }, { status: 400 });
  }

  const aktive = plan.filter(d => d.aktiv);

  if (aktive.length === 0) {
    return NextResponse.json({ error: 'Ingen aktive stream-dager å poste' }, { status: 400 });
  }

  const planLinjer = aktive
    .map(d => `**${d.dag}** kl. ${d.tid}  ·  ${d.spill}${d.tittel ? `  –  *${d.tittel}*` : ''}`)
    .join('\n');

  const embed = {
    title: '📅 Streamplan denne uken',
    description: planLinjer,
    color: 0x00ff41,
    fields: [
      {
        name: '📺 Se streamen her',
        value: `[twitch.tv/glenvex](${process.env.TWITCH_URL || 'https://twitch.tv/glenvex'})`,
        inline: true,
      },
    ],
    footer: { text: 'GLENVEX Stream Control • Streamplan' },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Discord feil ${res.status}: ${err}` }, { status: 500 });
  }

  const msg = await res.json() as any;

  // Lagre til content library
  addContent({
    tittel: `Streamplan – uke ${getWeekNumber()}`,
    type: 'streamplan',
    status: 'publisert',
    tekst: planLinjer,
    kanalId,
    modul: 'Streamplan',
    opprettetAv: 'dashboard',
    discordMsgId: msg.id,
    publisert: new Date().toISOString(),
    tags: aktive.map(d => d.dag),
  });

  return NextResponse.json({ ok: true, msgId: msg.id, antallDager: aktive.length });
}

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}
