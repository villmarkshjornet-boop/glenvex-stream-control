import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { prompt } = await req.json() as { prompt: string };

  // Prøv Railway bot API først (ingen timeout)
  const botApiUrl = process.env.BOT_API_URL;
  if (botApiUrl) {
    try {
      const res = await fetch(`${botApiUrl}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        const data = await res.json() as { bildeUrl: string };
        if (data.bildeUrl) return NextResponse.json({ bildeUrl: data.bildeUrl });
      }
    } catch {}
  }

  // Fallback: DALL-E 2 (raskere, ~3 sek, innenfor Vercel-grensen)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.images.generate({
      model: 'dall-e-2',
      prompt: `GTA RP character portrait, cinematic dark style. ${prompt}. Norwegian RP server. Dark neon green and black, dramatic lighting, no text.`.slice(0, 1000),
      n: 1,
      size: '512x512',
    });
    return NextResponse.json({ bildeUrl: response.data?.[0]?.url ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
