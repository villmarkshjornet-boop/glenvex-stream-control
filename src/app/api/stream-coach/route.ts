import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'stream-history.json');

export async function GET() {
  try {
    if (!fs.existsSync(FILE)) return NextResponse.json({ history: [], analyse: null });
    const history = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as any[];
    if (history.length === 0) return NextResponse.json({ history, analyse: null });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ history, analyse: null });

    const openai = new OpenAI({ apiKey });
    const siste5 = history.slice(0, 5);

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Du er AI stream-coach for GLENVEX. Analyser disse stream-dataene og gi konkrete tilbakemeldinger på norsk.

Siste streams:
${siste5.map((s: any) => `- ${s.game} (${s.title}): ${s.avgViewers} snitt-seere, peak ${s.peakViewers}, ${s.durationMinutes} min, ${s.chatMessages} meldinger`).join('\n')}

Returner KUN gyldig JSON:
{
  "fungerteBra": ["...", "..."],
  "fungerteIkke": ["...", "..."],
  "børGjentas": ["...", "..."],
  "børUnngås": ["...", "..."],
  "toppInsikt": "En setning om det viktigste funnet"
}`,
      }],
      max_tokens: 400,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const analyse = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    return NextResponse.json({ history, analyse });
  } catch {
    return NextResponse.json({ history: [], analyse: null });
  }
}
