import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const { prompt } = await req.json() as { prompt: string };

  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt: `GTA RP character portrait, cinematic dark style. ${prompt}. Norwegian RP server. Dark neon green and black aesthetic, dramatic lighting, no text.`,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
  });

  return NextResponse.json({ bildeUrl: response.data?.[0]?.url ?? null });
}
