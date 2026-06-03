import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function GET() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) {
    return NextResponse.json({ error: 'DISCORD_GUILD_ID eller DISCORD_BOT_TOKEN mangler' }, { status: 400 });
  }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
  if (!res.ok) {
    return NextResponse.json({ error: `Discord API feil: ${res.status}` }, { status: 500 });
  }

  const channels = await res.json() as any[];

  const sorted = channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ channels: sorted, suggestions: null });
  }

  const linjer = sorted.map((ch: any) => {
    if (ch.type === 4) return `[KATEGORI: ${ch.name}]`;
    if (ch.type === 0) return `  #${ch.name} (tekst)`;
    if (ch.type === 2) return `  🔊 ${ch.name} (tale)`;
    return `  ${ch.name} (type ${ch.type})`;
  });

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Du er Discord-administrator for GLENVEX, et norsk Twitch streaming community.

Nåværende kanalstruktur:
${linjer.join('\n')}

Gi forslag på norsk strukturert slik – IKKE mer enn dette:
**Bør slettes:** (list kanaler som er unødvendige eller duplikater)
**Bør opprettes:** (list 2-4 kanaler som mangler for et Twitch-community)
**Strukturforslag:** (én setning om organisering)

Vær konkret og kortfattet.`,
      },
    ],
    max_tokens: 400,
    temperature: 0.7,
  });

  const suggestions = response.choices[0]?.message?.content ?? null;

  return NextResponse.json({ channels: sorted, suggestions });
}
