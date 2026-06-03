import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: NextRequest) {
  const { type, publiser } = await req.json() as { type: string; publiser: boolean };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Lag et Discord-community-event for GLENVEX. Type: ${type}. Svar KUN med gyldig JSON:
{
  "tittel": "...",
  "beskrivelse": "...",
  "instruksjoner": "...",
  "premie": "...",
  "varighet": "..."
}
Norsk, engasjerende, gaming-fokusert. Tilpass for ${type === 'quiz' ? 'quiz-event' : type === 'giveaway' ? 'giveaway med klar vinnerbetingelse' : type === 'tarkov' ? 'Escape from Tarkov community-challenge' : type === 'rp' ? 'GTA RP / Future RP event' : 'community-event'}.`,
    }],
    max_tokens: 400,
    temperature: 0.8,
    response_format: { type: 'json_object' },
  });

  const event = JSON.parse(res.choices[0]?.message?.content ?? '{}');

  if (publiser) {
    const kanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
    if (kanalId) {
      await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({
          embeds: [{
            title: `🎉 ${event.tittel}`,
            description: `${event.beskrivelse}\n\n**Instruksjoner:** ${event.instruksjoner}\n\n🏆 **Premie:** ${event.premie}\n⏱️ **Varighet:** ${event.varighet}`,
            color: 0x00ff41,
            footer: { text: 'GLENVEX Community Event' },
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json(event);
}
