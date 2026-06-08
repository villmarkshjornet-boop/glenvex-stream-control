import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Les fra Supabase stream_history (kilde for Railway bot-data)
    const db = getDb();
    let history: any[] = [];

    if (db) {
      const cutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
      const { data } = await db
        .from('stream_history')
        .select('*')
        .eq('workspace_id', getWorkspaceId())
        .gte('started_at', cutoff)
        .order('started_at', { ascending: false })
        .limit(20);
      history = data ?? [];
    }

    if (history.length === 0) return NextResponse.json({ history: [], analyse: null });

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
${siste5.map((s: any) => `- ${s.game ?? 'Ukjent'} (${s.title ?? ''}): ${s.avg_viewers ?? 0} snitt-seere, peak ${s.peak_viewers ?? 0}, ${s.duration_minutes ?? 0} min, ${s.chat_messages ?? 0} meldinger`).join('\n')}

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
