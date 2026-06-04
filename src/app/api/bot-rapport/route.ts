import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { hentBotData } from '@/lib/botData';
import { getPartners } from '@/lib/partners';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Hent logg-data
  const logFil = path.join(process.cwd(), 'data', 'logs.json');
  const loggData: any[] = fs.existsSync(logFil)
    ? JSON.parse(fs.readFileSync(logFil, 'utf-8')).slice(0, 50)
    : [];

  // Hent members og events
  const members = await hentBotData('members') ?? {};
  const events = await hentBotData('events') ?? { raids: [], giftSubs: [] };
  const partners = await getPartners();

  // Grupper logg-hendelser
  const sisteLive = loggData.find(l => l.message?.includes('live-varsel'));
  const sisteRaids = events.raids?.slice(-3) ?? [];
  const sisteGiftSubs = events.giftSubs?.slice(-3) ?? [];
  const aktiveMedlemmer = Object.values(members).filter((m: any) => {
    const sist = new Date(m.lastSeen ?? 0).getTime();
    return Date.now() - sist < 7 * 24 * 60 * 60 * 1000;
  }).length;

  // Bot-handlinger siste 24t
  const siste24t = loggData.filter(l => {
    const alder = Date.now() - new Date(l.timestamp).getTime();
    return alder < 24 * 60 * 60 * 1000;
  });

  const handlinger = siste24t.map(l => ({
    type: l.type,
    melding: l.message,
    tid: l.timestamp,
  }));

  // Aktiv featured partner
  const featuredPartner = partners.find(p => p.featured && p.aktiv);

  // AI-analyse og anbefalinger
  const apiKey = process.env.OPENAI_API_KEY;
  let analyse = '';
  let anbefalinger: { tekst: string; prioritet: 'lav' | 'medium' | 'høy'; kategori: string }[] = [];

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Du er AI-assistent for streameren GLENVEX. Analyser situasjonen og gi konkrete anbefalinger. Returner KUN JSON:
{
  "analyse": "2 setninger om nåværende tilstand",
  "anbefalinger": [
    {"tekst": "...", "prioritet": "høy", "kategori": "stream"},
    {"tekst": "...", "prioritet": "medium", "kategori": "community"},
    {"tekst": "...", "prioritet": "lav", "kategori": "partner"}
  ]
}

Data siste 24 timer:
- Bot-hendelser: ${siste24t.length} (${siste24t.filter(l => l.type === 'success').length} vellykkede)
- Raids mottatt: ${sisteRaids.length}
- Gift subs: ${sisteGiftSubs.length}
- Aktive Discord-membres (7 dager): ${aktiveMedlemmer}
- Featured partner: ${featuredPartner?.navn ?? 'Ingen'}
- Siste live-varsel: ${sisteLive ? new Date(sisteLive.timestamp).toLocaleDateString('no-NO') : 'Ingen'}

Gi 3-4 konkrete, handlingsrettede anbefalinger.`,
        }],
        max_tokens: 400,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      analyse = parsed.analyse ?? '';
      anbefalinger = parsed.anbefalinger ?? [];
    } catch {}
  }

  return NextResponse.json({
    handlinger: handlinger.slice(0, 8),
    analyse,
    anbefalinger,
    stats: {
      hendelser24t: siste24t.length,
      aktiveMedlemmer,
      raids: sisteRaids.length,
      featuredPartner: featuredPartner?.navn ?? null,
    },
  });
}
