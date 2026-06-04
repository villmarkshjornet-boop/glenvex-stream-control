import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb, isDbAvailable } from '@/lib/db';
import { getBroadcasterId, getTopClips, getStreamInfo } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import { getPartners } from '@/lib/partners';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface AICommandData {
  performanceScore: number;
  subScores: { community: number; growth: number; content: number; sponsor: number };
  prioriteter: { tekst: string; prioritet: 'kritisk' | 'høy' | 'middels' | 'lav'; kategori: string }[];
  communityInsights: { mvp?: string; mvpBeskrivelse?: string; vokserRaskt?: string; inaktive: number; totalAktive: number };
  streamIntelligence: { fungerteBra: string[]; fungerteIkke: string[]; børTestes: string[]; toppInsikt: string };
  contentIntelligence: { besteKlipp?: string; viralKandidat?: string; børRepubliseres?: string; innholdsgap: string };
  growthEngine: { discordPost: string; poll: string; tiktok: string; youtubeShortsIdé: string; streamIdé: string };
  viewerPrediction: { spill: string; tid: string; forventetØkning: string; begrunnelse: string };
  sponsorScore: number;
  sponsorInsikt: string;
  partnerAnbefaling: string;
  dagligHandlingsplan: string[];
  liveMode: boolean;
  liveData?: { viewers: number; spill: string; tittel: string; chatScore: string; hypeRekomendasjon: string };
  manglerData: string[];
  generertKl: string;
}

async function hentAlleData() {
  const db = isDbAvailable() ? getDb() : null;

  const [stream, guild, partners, broadcasterId] = await Promise.all([
    getStreamInfo().catch(() => null),
    getGuildInfo().catch(() => null),
    getPartners().catch(() => []),
    getBroadcasterId().catch(() => null),
  ]);

  const [clips, members, streamHistory, goals] = await Promise.all([
    broadcasterId ? getTopClips(broadcasterId, 10).catch(() => []) : Promise.resolve([]),
    db ? db.from('community_members').select('*').eq('workspace_id', 'glenvex-default')
      .order('xp', { ascending: false }).limit(20)
      .then(r => r.data ?? []) : Promise.resolve([]),
    db ? db.from('stream_history').select('*').eq('workspace_id', 'glenvex-default')
      .order('started_at', { ascending: false }).limit(10)
      .then(r => r.data ?? []) : Promise.resolve([]),
    (() => {
      try {
        const f = path.join(process.cwd(), 'data', 'goals.json');
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
      } catch {}
      return [];
    })(),
  ]);

  return { stream, guild, partners, clips, members, streamHistory, goals };
}

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const manglerData: string[] = [];

  const { stream, guild, partners, clips, members, streamHistory, goals } = await hentAlleData();

  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });
  }

  // Bygg datasammendrag for AI
  const isLive = stream?.isLive ?? false;
  const følgere = stream?.viewerCount ?? 0;
  const discordMedlemmer = guild?.approximate_member_count ?? guild?.member_count ?? 0;
  const aktiveMedlemmer = members.filter((m: any) => {
    const sist = new Date(m.last_seen ?? 0).getTime();
    return Date.now() - sist < 7 * 24 * 60 * 60 * 1000;
  }).length;

  if (members.length === 0) manglerData.push('Discord-membre (bot trenger tid for å samle data)');
  if (streamHistory.length === 0) manglerData.push('Streamhistorikk (data samles etter streams)');
  if (clips.length === 0) manglerData.push('Clips fra Twitch');

  const topMember = members[0] as any;
  const fastestGrowing = members.length > 1 ? [...members].sort((a: any, b: any) =>
    (b.messages ?? 0) - (a.messages ?? 0))[0] as any : null;

  const aktivPartnere = partners.filter(p => p.aktiv);
  const sistePromotert = aktivPartnere.find(p => p.sistePromotert);

  const streamSammendrag = streamHistory.slice(0, 5).map((s: any) =>
    `${s.game}: ${s.avg_viewers ?? 0} snitt-seere, peak ${s.peak_viewers ?? 0}, ${s.duration_minutes ?? 0} min`
  ).join('\n');

  const klippSammendrag = clips.slice(0, 5).map((c: any) =>
    `"${c.title}": ${c.viewCount} visninger, ${Math.round(c.duration)}s`
  ).join('\n');

  const goalSammendrag = goals.filter((g: any) => g.aktiv && g.mal > 0).map((g: any) => {
    const pct = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
    return `${g.label}: ${g.gjeldende}/${g.mal} (${pct}%)`;
  }).join(', ');

  const dagensDag = new Date().toLocaleDateString('no-NO', { weekday: 'long' });
  const klokken = new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

  const openai = new OpenAI({ apiKey });

  const prompt = `Du er AI-hjernen til GLENVEX Creator OS. Analyser all tilgjengelig data og generer et komplett intelligence-rapport. Returner KUN gyldig JSON uten kommentarer.

GLENVEX er en norsk Twitch-streamer (Future RP, Escape from Tarkov, FPS).
Idag: ${dagensDag} kl. ${klokken}
Live nå: ${isLive ? `JA – ${stream?.game} "${stream?.title}"` : 'NEI'}
${isLive ? `Seere nå: ${stream?.viewerCount ?? 0}` : ''}

TWITCH DATA:
- Discord-membres: ${discordMedlemmer}
- Aktive membres (7d): ${aktiveMedlemmer}
- Topp member: ${topMember ? `${topMember.display_name} (${topMember.xp} XP, ${topMember.messages} meldinger)` : 'Ingen data ennå'}
- Raskest voksende: ${fastestGrowing ? `${(fastestGrowing as any).display_name}` : 'Ingen data'}

STREAMHISTORIKK (siste streams):
${streamSammendrag || 'Ingen streamhistorikk ennå'}

BESTE CLIPS:
${klippSammendrag || 'Ingen clips funnet'}

VIEWER GOALS: ${goalSammendrag || 'Ingen mål satt'}

AKTIVE PARTNERE: ${aktivPartnere.map(p => `${p.navn} (sist promotert: ${p.sistePromotert ? new Date(p.sistePromotert).toLocaleDateString('no-NO') : 'aldri'})`).join(', ') || 'Ingen'}

Generer dette JSON-objektet (alle felt PÅKREVD, norsk tekst):
{
  "performanceScore": 0-100,
  "subScores": {
    "community": 0-100,
    "growth": 0-100,
    "content": 0-100,
    "sponsor": 0-100
  },
  "prioriteter": [
    {"tekst": "Konkret prioritet", "prioritet": "kritisk|høy|middels|lav", "kategori": "stream|discord|innhold|sponsor|community"}
  ],
  "communityInsights": {
    "mvp": "Navn eller null",
    "mvpBeskrivelse": "Konkret setning om MVP",
    "vokserRaskt": "Navn eller null",
    "inaktive": 0,
    "totalAktive": ${aktiveMedlemmer}
  },
  "streamIntelligence": {
    "fungerteBra": ["Konkret observasjon"],
    "fungerteIkke": ["Konkret observasjon"],
    "børTestes": ["Konkret forslag"],
    "toppInsikt": "Én konkret setning om viktigste funn"
  },
  "contentIntelligence": {
    "besteKlipp": "Navn på beste clip eller null",
    "viralKandidat": "Clip-tittel og grunn eller null",
    "børRepubliseres": "Clip-tittel eller null",
    "innholdsgap": "Konkret hva som mangler"
  },
  "growthEngine": {
    "discordPost": "Konkret Discord-postidé basert på data",
    "poll": "Konkret poll-spørsmål",
    "tiktok": "Konkret TikTok-idé fra eksisterende innhold",
    "youtubeShortsIdé": "Konkret YouTube Shorts-idé",
    "streamIdé": "Konkret stream-idé basert på historikk"
  },
  "viewerPrediction": {
    "spill": "Anbefalt spill basert på data",
    "tid": "Anbefalt tidspunkt",
    "forventetØkning": "+X%",
    "begrunnelse": "Konkret begrunnelse basert på historikk"
  },
  "sponsorScore": 0-100,
  "sponsorInsikt": "Konkret hva som mangler for å nå 80+",
  "partnerAnbefaling": "Konkret anbefaling om neste partner-promotering",
  "dagligHandlingsplan": [
    "Konkret handling 1 (med tidspunkt hvis mulig)",
    "Konkret handling 2",
    "Konkret handling 3",
    "Konkret handling 4",
    "Konkret handling 5"
  ]${isLive ? `,
  "liveHypeRekomendasjon": "Konkret live-anbefaling akkurat nå"` : ''}
}

Vær KONKRET. Ikke generisk. Bruk faktiske tall og navn fra dataene.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const aiData = JSON.parse(response.choices[0]?.message?.content ?? '{}');

  const result: AICommandData = {
    ...aiData,
    liveMode: isLive,
    liveData: isLive ? {
      viewers: stream?.viewerCount ?? 0,
      spill: stream?.game ?? '',
      tittel: stream?.title ?? '',
      chatScore: aktiveMedlemmer > 5 ? 'Høy' : aktiveMedlemmer > 2 ? 'Medium' : 'Lav',
      hypeRekomendasjon: aiData.liveHypeRekomendasjon ?? 'Engasjer chatten med et spørsmål',
    } : undefined,
    manglerData,
    generertKl: new Date().toISOString(),
  };

  return NextResponse.json(result);
}
