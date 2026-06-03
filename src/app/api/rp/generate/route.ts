import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export interface RPData {
  serverNavn: string;
  karakterNavn: string;
  karakterRolle: string;
  karakterBeskrivelse: string;
  backstory: string;
  erstattNXT: boolean;
}

export interface RPGenerert {
  karakterIntro: string;
  serverOppdatering: string;
  kanalForslag: { id: string; navn: string; nyttNavn: string; type: 'rename' | 'topic' }[];
  bildePrompt: string;
  bildeUrl?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY mangler' }, { status: 400 });

  const data = await req.json() as RPData;
  const client = new OpenAI({ apiKey });

  // Hent Discord-kanaler for NXT-søk
  const guildId = process.env.DISCORD_GUILD_ID;
  let kanaler: any[] = [];
  if (guildId && data.erstattNXT) {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
    if (res.ok) kanaler = await res.json() as any[];
  }

  const nxtKanaler = kanaler.filter((k: any) =>
    k.name?.toLowerCase().includes('nxt') || k.topic?.toLowerCase().includes('nxt')
  );

  const kanalForslag = nxtKanaler.map((k: any) => ({
    id: k.id,
    navn: k.name,
    nyttNavn: k.name.toLowerCase().replace(/nxt/g, data.serverNavn.toLowerCase().replace(/\s/g, '-')),
    type: 'rename' as const,
  }));

  // Generer kun tekst (raskt) – bilde genereres separat for å unngå Vercel-timeout
  const [karakterRes, serverRes] = await Promise.all([
    client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Lag et Discord-karakterkort på norsk for denne GTA RP-karakteren. Bruk Discord markdown (bold, kursiv, overskrifter). Maks 250 ord.

Server: ${data.serverNavn}
Karakter: ${data.karakterNavn}
Rolle: ${data.karakterRolle}
Beskrivelse: ${data.karakterBeskrivelse}
Backstory: ${data.backstory}

Format: Start med karakterens navn som tittel, deretter rolle, så en engasjerende beskrivelse og backstory. Avslutt med en linje om hva folk kan forvente av denne karakteren på stream.`,
      }],
      max_tokens: 400,
      temperature: 0.8,
    }),
    client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Lag en kort Discord-serveroppdateringsmelding på norsk (maks 150 ord) som annonserer at GLENVEX nå streamer ${data.serverNavn} med karakteren ${data.karakterNavn} (${data.karakterRolle}). Energisk, mørk gaming-vibe. ${data.erstattNXT ? `Nevn at vi går fra NXT til ${data.serverNavn}.` : ''}`,
      }],
      max_tokens: 200,
      temperature: 0.8,
    }),
  ]);

  const generert: RPGenerert = {
    karakterIntro: karakterRes.choices[0]?.message?.content ?? '',
    serverOppdatering: serverRes.choices[0]?.message?.content ?? '',
    kanalForslag,
    bildePrompt: `${data.karakterNavn} – ${data.karakterRolle} – ${data.karakterBeskrivelse}`,
    bildeUrl: undefined,
  };

  return NextResponse.json(generert);
}
