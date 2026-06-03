import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const { partner, type, genererBilde } = await req.json() as {
    partner: { navn: string; beskrivelse: string; rabattkode: string; affiliateLink: string; kategori: string };
    type: 'discord' | 'twitch' | 'instagram' | 'twitter' | 'facebook' | 'giveaway';
    genererBilde?: boolean;
  };

  const client = new OpenAI({ apiKey });

  const typeInstruksjoner: Record<string, string> = {
    discord: 'Discord-post (embed-format, markdown, engasjerende, 3-4 setninger)',
    twitch: 'Twitch chat-melding (maks 1 setning, inkluder rabattkode og link)',
    instagram: 'Instagram caption (2-3 setninger + 10 hashtags)',
    twitter: 'Twitter/X-post (maks 240 tegn inkl. hashtags)',
    facebook: 'Facebook-post (2-4 setninger, vennlig tone)',
    giveaway: 'Giveaway-post (spennende, inkluder deltagelsesbetingelser)',
  };

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Lag en ${typeInstruksjoner[type]} for partner "${partner.navn}" på vegne av streameren GLENVEX. Norsk tekst.

Partner-info:
- Navn: ${partner.navn}
- Beskrivelse: ${partner.beskrivelse}
- Rabattkode: ${partner.rabattkode || 'Ingen kode'}
- Link: ${partner.affiliateLink}
- Kategori: ${partner.kategori}

Returner KUN JSON:
{
  "tekst": "...",
  "overskrift": "...",
  "cta": "..."
}`,
    }],
    max_tokens: 300,
    temperature: 0.85,
    response_format: { type: 'json_object' },
  });

  const innhold = JSON.parse(res.choices[0]?.message?.content ?? '{}');

  let bildeUrl: string | null = null;
  if (genererBilde) {
    try {
      const bildeRes = await client.images.generate({
        model: 'dall-e-3',
        prompt: `Premium gaming affiliate marketing banner for "${partner.navn}". Dark cinematic style, neon green accents, professional esports aesthetic. Norwegian streamer GLENVEX. Show product/brand prominently. No text overlays.`,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
      bildeUrl = bildeRes.data?.[0]?.url ?? null;
    } catch {}
  }

  return NextResponse.json({ ...innhold, bildeUrl });
}
