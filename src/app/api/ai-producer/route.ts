import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getStreamInfo } from '@/lib/twitch';
import { hentBotData } from '@/lib/botData';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

    // ─── Stream Coach historikk ────────────────────────────────────────────
    let streamHistorikk: any[] = [];
    const db = getDb();
    if (db) {
      try {
        const { data } = await db
          .from('stream_history')
          .select('title,game,peak_viewers,avg_viewers,duration_minutes,followers_gained,chat_messages,subs_gained')
          .eq('workspace_id', 'glenvex-default')
          .order('started_at', { ascending: false })
          .limit(10);
        streamHistorikk = data ?? [];
      } catch {}
    }
    if (streamHistorikk.length === 0) {
      const raw = await hentBotData('stream-history') as any[] | null;
      streamHistorikk = (raw ?? []).slice(0, 10);
    }

    // Analyser historikken
    const bestSpill: Record<string, { peak: number; antall: number; followers: number }> = {};
    for (const s of streamHistorikk) {
      const g = s.game ?? s.spill ?? 'Ukjent';
      if (!bestSpill[g]) bestSpill[g] = { peak: 0, antall: 0, followers: 0 };
      bestSpill[g].peak = Math.max(bestSpill[g].peak, s.peak_viewers ?? s.peakViewers ?? 0);
      bestSpill[g].antall++;
      bestSpill[g].followers += s.followers_gained ?? s.followerGain ?? 0;
    }
    const spillRanking = Object.entries(bestSpill)
      .sort((a, b) => b[1].peak - a[1].peak)
      .slice(0, 3)
      .map(([spill, d]) => `${spill}: topp ${d.peak} seere, ${d.followers} følgere totalt`)
      .join(' | ');

    const avgPeak = streamHistorikk.length > 0
      ? Math.round(streamHistorikk.reduce((s, h) => s + (h.peak_viewers ?? h.peakViewers ?? 0), 0) / streamHistorikk.length)
      : 0;

    const apiKey = process.env.OPENAI_API_KEY;
    let analyse = '';
    let tiltak: any[] = [];

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `Du er AI-produsent for GLENVEX, en norsk Twitch-streamer. Du kjenner kanalen godt og hjelper med å maksimere vekst og engasjement under stream.
Kanalens tone: energisk, litt edgy norsk gaming-humor, autentisk, ikke overdrevent corporat.
Kanalen streamer primært Future RP (GTA RP-server) og andre spill.
Du skal ALLTID generere faktisk klar-til-bruk innhold for hvert tiltak som involverer en tekst/post – ikke bare si "post noe", men LAG selve teksten.`,
        }, {
          role: 'user',
          content: `Analyser nåværende stream og gi handlingsrettede forslag med ferdig innhold.

NÅVÆRENDE STREAM:
- Spill: ${stream.game}
- Tittel: ${stream.title}
- Seere nå: ${stream.viewerCount ?? 0}
- Aktive Discord-membres: ${activeMembers}
- Raids i dag: ${events.raids?.length ?? 0}
- Gift subs: ${events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0}

STREAM COACH HISTORIKK (siste ${streamHistorikk.length} streams):
- Snitt peak-seere: ${avgPeak}
- Beste spill: ${spillRanking || 'ikke nok data ennå'}

Returner KUN gyldig JSON:
{
  "analyse": "2-3 setninger om situasjonen og hva som funker for kanalen basert på historikken",
  "tiltak": [
    {
      "tekst": "Kort beskrivelse av tiltaket",
      "prioritet": "høy",
      "type": "sosial_media",
      "innhold": {
        "tiktok": "Ferdig TikTok-tekst med emojier og hashtags",
        "instagram": "Ferdig Instagram-caption",
        "twitter": "Ferdig tweet under 280 tegn"
      }
    },
    {
      "tekst": "Post i Discord",
      "prioritet": "medium",
      "type": "discord",
      "innhold": {
        "discord": "Ferdig Discord-melding med @mentions og embeds"
      }
    },
    {
      "tekst": "Si noe i chat",
      "prioritet": "lav",
      "type": "chat",
      "innhold": {
        "chat": "Ferdig chat-melding"
      }
    }
  ]
}

Gi 3-5 tiltak. Alltid generer faktisk innhold for tiltak som krever en tekst. Tilpass til nåværende spill og kanalens tone.`,
        }],
        max_tokens: 900,
        temperature: 0.85,
        response_format: { type: 'json_object' },
      });

      try {
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        analyse = parsed.analyse ?? '';
        tiltak = parsed.tiltak ?? [];
      } catch {}
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
      harHistorikk: streamHistorikk.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ isLive: false, stream: null, analyse: null, tiltak: [], error: (err as Error).message });
  }
}
