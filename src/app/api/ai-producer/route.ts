import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getStreamInfo } from '@/lib/twitch';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stream = await getStreamInfo();

    if (!stream.isLive) {
      return NextResponse.json({ isLive: false, stream: null, analyse: null, tiltak: [] });
    }

    const events = await hentBotData('events') ?? { raids: [], giftSubs: [] };
    const members = await hentBotData('members') ?? {};
    const activeMembers = Object.values(members).filter((m: any) => {
      const sist = new Date(m.lastSeen ?? 0).getTime();
      return Date.now() - sist < 60 * 60 * 1000;
    }).length;

    const apiKey = process.env.OPENAI_API_KEY;
    let analyse = '';
    let tiltak: { tekst: string; prioritet: 'lav' | 'medium' | 'høy' | 'kritisk' }[] = [];

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Du er AI-produsent for Twitch-streamer GLENVEX. Analyser situasjonen og gi konkrete forslag. Returner KUN JSON:
{
  "analyse": "2-3 setninger om nåværende stream-situasjon på norsk",
  "tiltak": [
    {"tekst": "Konkret handling", "prioritet": "høy"}
  ]
}

Nåværende data:
- Spill: ${stream.game}
- Tittel: ${stream.title}
- Seere: ${stream.viewerCount ?? 0}
- Aktive Discord-membres: ${activeMembers}
- Raids i dag: ${events.raids?.length ?? 0}
- Gift subs i dag: ${events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0}

Gi 3-4 konkrete tiltak med prioritet (lav/medium/høy/kritisk). Tilpass for spillet som spilles.`,
        }],
        max_tokens: 400,
        temperature: 0.8,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      analyse = parsed.analyse ?? '';
      tiltak = parsed.tiltak ?? [];
    }

    const viewerCount = stream.viewerCount ?? 0;
    const engagementScore = Math.min(100, Math.round(
      (Math.min(viewerCount, 100) / 100) * 60 +
      (Math.min(activeMembers, 20) / 20) * 40
    ));

    return NextResponse.json({
      isLive: true,
      stream,
      analyse,
      tiltak,
      metrics: {
        viewers: viewerCount,
        activeDiscord: activeMembers,
        raidsToday: events.raids?.length ?? 0,
        giftSubsToday: events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0,
        engagementScore,
      },
    });
  } catch (err) {
    return NextResponse.json({ isLive: false, stream: null, analyse: null, tiltak: [], error: (err as Error).message });
  }
}
