import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
}

const MELDINGER = {
  '30min': (spill: string) => `🔔 **GLENVEX går live om 30 minutter!** ${spill ? `Vi kjører **${spill}** i kveld.` : ''} Gjør klar chatten og kom innom! 👀`,
  '15min': (spill: string) => `⚡ **15 minutter igjen!** ${spill ? `${spill} starter snart.` : 'Stream starter snart.'} Ikke gå glipp av starten! 🔴`,
  'live': (spill: string) => `🔴 **GLENVEX ER LIVE!** ${spill ? `Vi spiller **${spill}** nå!` : ''} Kom inn: twitch.tv/glenvex`,
};

export async function POST(req: NextRequest) {
  const { type, spill } = await req.json() as { type: '30min' | '15min' | 'live'; spill: string };
  const kanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!kanalId) return NextResponse.json({ error: 'DISCORD_CHAT_CHANNEL_ID mangler' }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  let melding = MELDINGER[type]?.(spill) ?? '';

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const kontekst = type === '30min' ? `30 minutter til stream` : type === '15min' ? `15 minutter til stream` : `Live nå`;
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Lag en unik, energisk norsk hype-melding for Discord (1-2 setninger). Kontekst: ${kontekst}${spill ? `, spill: ${spill}` : ''}. Streamer: GLENVEX. Linken er twitch.tv/glenvex. Variasjon er viktig.` }],
        max_tokens: 80,
        temperature: 0.95,
      });
      melding = res.choices[0]?.message?.content ?? melding;
    } catch {}
  }

  const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ content: melding }),
  });

  return NextResponse.json({ ok: res.ok });
}
