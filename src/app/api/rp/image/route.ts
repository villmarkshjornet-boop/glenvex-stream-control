import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const { prompt } = await req.json() as { prompt: string };
  if (!prompt) return NextResponse.json({ error: 'Ingen prompt' }, { status: 400 });

  const client = new OpenAI({ apiKey });

  const fullPrompt = `GTA RP character portrait. ${prompt}. Cinematic dark style, neon green and black, dramatic lighting. No text.`.slice(0, 900);

  try {
    const response = await client.images.generate({
      model: 'dall-e-2',
      prompt: fullPrompt,
      n: 1,
      size: '512x512',
    });

    const url = response.data?.[0]?.url;
    if (!url) return NextResponse.json({ error: 'Ingen bilde-URL returnert' }, { status: 500 });

    return NextResponse.json({ bildeUrl: url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'DALL-E feil' }, { status: 500 });
  }
}
