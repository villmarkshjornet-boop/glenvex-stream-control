import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const { title, duration, viewCount } = await req.json();
  const client = new OpenAI({ apiKey });

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Lag innholdstekster for denne Twitch-clipsen fra streameren GLENVEX. Returner KUN JSON:
{
  "tiktok": { "tittel": "...", "beskrivelse": "...", "hashtags": "#..." },
  "youtube": { "tittel": "...", "beskrivelse": "..." },
  "instagram": { "caption": "...", "hashtags": "#..." }
}

Clip-info:
- Tittel: ${title}
- Varighet: ${Math.round(duration)} sekunder
- Visninger: ${viewCount}

Regler:
- Norsk tekst
- Energisk og fengende
- TikTok: maks 150 tegn tittel, snappy beskrivelse, 5-8 hashtags
- YouTube: SEO-optimalisert tittel, 2-3 setninger beskrivelse
- Instagram: engasjerende caption, 10-12 hashtags inkl. #GLENVEX #Twitch`,
    }],
    max_tokens: 500,
    temperature: 0.85,
    response_format: { type: 'json_object' },
  });

  const data = JSON.parse(res.choices[0]?.message?.content ?? '{}');
  return NextResponse.json(data);
}
