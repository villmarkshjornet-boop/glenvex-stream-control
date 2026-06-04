import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAllContent } from '@/lib/contentLibrary';
import { getPartners } from '@/lib/partners';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;

  const [innhold, partners, events] = await Promise.all([
    Promise.resolve(getAllContent().slice(0, 20)),
    getPartners(),
    hentBotData('events').catch(() => ({ raids: [], giftSubs: [] })),
  ]);

  const historikk = innhold
    .filter(i => i.status === 'publisert')
    .map(i => `${i.type}: "${i.tittel}" (${new Date(i.publisert ?? i.opprettet).toLocaleDateString('no-NO')})`);

  const aktivePartnere = partners.filter(p => p.aktiv).map(p => p.navn);

  let plan: { dato: string; type: string; tittel: string; beskrivelse: string; prioritet: string }[] = [];
  let analyse = '';

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const now = new Date();
      const dagNavn = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Du er innholdsplanlegger for GLENVEX (Twitch-streamer, Future RP, Tarkov). Lag en innholdsplan for de neste 7 dagene basert på historikk og aktive partnere. Returner KUN JSON:
{
  "analyse": "2-3 setninger om hva som har fungert og hva som mangler",
  "plan": [
    {"dato": "2026-06-05", "type": "partner-post", "tittel": "...", "beskrivelse": "...", "prioritet": "høy"}
  ]
}

Historikk (siste publiseringer): ${historikk.slice(0, 8).join(', ') || 'Ingen ennå'}
Aktive partnere: ${aktivePartnere.join(', ') || 'Ingen'}
Raids denne uken: ${(events as any)?.raids?.length ?? 0}
Idag: ${dagNavn[now.getDay()]} ${now.toLocaleDateString('no-NO')}

Typer innhold: partner-post, streamplan, event, poll, clip-post, promo, velkomst
Lag 5-7 innlegg fordelt over uken. Norsk. Vær konkret.`,
        }],
        max_tokens: 600,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      plan = parsed.plan ?? [];
      analyse = parsed.analyse ?? '';
    } catch {}
  }

  return NextResponse.json({ plan, analyse, historikk: innhold.slice(0, 10) });
}
