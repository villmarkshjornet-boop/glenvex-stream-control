import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

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

  const wsId = getWorkspaceId();
  const db = getDb();
  let brandName = 'streameren';
  if (db) {
    const { data: ws } = await db.from('workspaces').select('brand_name').eq('id', wsId).single();
    brandName = ws?.brand_name ?? 'streameren';
  }

  // Kjør Discord-henting og GPT parallelt
  const guildId = process.env.DISCORD_GUILD_ID;

  const [gptRes, kanalerRes] = await Promise.all([
    // Én enkelt GPT-call som genererer begge tekstene
    client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Lag innhold for GTA RP-karakteren ${data.karakterNavn} på serveren ${data.serverNavn}. Returner KUN gyldig JSON:
{
  "karakterkort": "Discord-karakterkort med bold/kursiv markdown, maks 200 ord. Start med navn, rolle, beskrivelse, backstory.",
  "servermelding": "Kort Discord-annonseringsmelding (maks 100 ord) om at ${brandName} nå spiller ${data.serverNavn} med ${data.karakterNavn}. Energisk og mørk gaming-vibe.${data.erstattNXT ? ' Nevn at vi går fra NXT.' : ''}"
}

Karakterinfo:
Rolle: ${data.karakterRolle}
Beskrivelse: ${data.karakterBeskrivelse}
Backstory: ${data.backstory}`,
      }],
      max_tokens: 600,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    }),

    // Discord-kanaler for NXT-søk
    (guildId && data.erstattNXT)
      ? fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() })
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // Parse GPT-svar
  let karakterIntro = '';
  let serverOppdatering = '';
  try {
    const parsed = JSON.parse(gptRes.choices[0]?.message?.content ?? '{}');
    karakterIntro = parsed.karakterkort ?? '';
    serverOppdatering = parsed.servermelding ?? '';
  } catch {
    karakterIntro = gptRes.choices[0]?.message?.content ?? '';
  }

  // NXT-kanalforslag
  const kanaler = Array.isArray(kanalerRes) ? kanalerRes : [];
  const kanalForslag = kanaler
    .filter((k: any) => k.name?.toLowerCase().includes('nxt') || k.topic?.toLowerCase().includes('nxt'))
    .map((k: any) => ({
      id: k.id,
      navn: k.name,
      nyttNavn: k.name.toLowerCase().replace(/nxt/g, data.serverNavn.toLowerCase().replace(/\s/g, '-')),
      type: 'rename' as const,
    }));

  const generert: RPGenerert = {
    karakterIntro,
    serverOppdatering,
    kanalForslag,
    bildePrompt: `${data.karakterNavn} – ${data.karakterRolle} – ${data.karakterBeskrivelse}`,
    bildeUrl: undefined,
  };

  return NextResponse.json(generert);
}

