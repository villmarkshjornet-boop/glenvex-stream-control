import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getBroadcasterId, getTopClips } from '@/lib/twitch';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const broadcasterId = await getBroadcasterId();
    if (!broadcasterId) return NextResponse.json({ highlights: [] });

    const clips = await getTopClips(broadcasterId, 15);
    if (clips.length === 0) return NextResponse.json({ highlights: [] });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const highlights = clips.slice(0, 6).map(c => ({
        clip: c,
        type: c.duration < 60 ? 'tiktok' : c.duration < 180 ? 'instagram' : 'youtube',
        grunn: `${c.viewCount} visninger – god kandidat for deling`,
        prioritet: c.viewCount > 100 ? 'høy' : c.viewCount > 30 ? 'medium' : 'lav',
      }));
      return NextResponse.json({ highlights });
    }

    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Analyser disse Twitch-klippene og foreslå hvilke som passer best for TikTok, YouTube Shorts eller Instagram Reels. Returner KUN JSON:
{"highlights": [{"clipIndex": 0, "type": "tiktok", "grunn": "...", "prioritet": "høy"}]}

Klipp:
${clips.map((c, i) => `${i}. "${c.title}" – ${c.viewCount} visninger, ${Math.round(c.duration)}s`).join('\n')}

Regler: TikTok = under 60s og høy energi. Instagram = visuelt sterkt. YouTube = lengre, narrativt. Max 8 highlights.`,
      }],
      max_tokens: 400,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const data = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    const highlights = (data.highlights ?? []).map((h: any) => ({
      clip: clips[h.clipIndex],
      type: h.type,
      grunn: h.grunn,
      prioritet: h.prioritet,
    })).filter((h: any) => h.clip);

    return NextResponse.json({ highlights });
  } catch {
    return NextResponse.json({ highlights: [] });
  }
}
