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

interface OpprettAction {
  navn: string;
  kategori?: string;
  emne?: string;
  publiser?: boolean;
  karakterInfo?: string;
}

interface SlettAction {
  id: string;
  navn: string;
}

interface RenameAction {
  id: string;
  fra: string;
  til: string;
}

export interface ChannelSuggestions {
  tekst: string;
  slett: SlettAction[];
  opprett: OpprettAction[];
  rename: RenameAction[];
}

// ─── GET – hent kanaler + AI-forslag ────────────────────────────────────────

export async function GET() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) {
    return NextResponse.json({ error: 'Mangler Discord-konfig' }, { status: 400 });
  }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
  if (!res.ok) {
    return NextResponse.json({ error: `Discord API feil: ${res.status}` }, { status: 500 });
  }

  const channels = await res.json() as any[];
  const sorted = channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ channels: sorted, suggestions: null });
  }

  const linjer = sorted.map((ch: any) => {
    if (ch.type === 4) return `[KATEGORI id:${ch.id}]: ${ch.name}`;
    if (ch.type === 0) return `  #${ch.name} (tekst, id:${ch.id})`;
    if (ch.type === 2) return `  🔊 ${ch.name} (tale, id:${ch.id})`;
    return `  ${ch.name} (type:${ch.type}, id:${ch.id})`;
  });

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Du er Discord-administrator for GLENVEX, et norsk Twitch streaming community som også spiller GTA RP på Future RP.

Nåværende kanalstruktur:
${linjer.join('\n')}

Returner KUN gyldig JSON (ingen markdown, ingen forklaring):
{
  "tekst": "Kort norsk oppsummering av analysen (2-3 setninger)",
  "slett": [
    { "id": "kanal-id", "navn": "kanal-navn" }
  ],
  "opprett": [
    { "navn": "kanal-navn", "kategori": "KATEGORI-NAVN", "emne": "Kanal-beskrivelse", "publiser": true, "karakterInfo": "Valgfri info om karakter hvis relevant" }
  ],
  "rename": [
    { "id": "kanal-id", "fra": "gammelt-navn", "til": "nytt-navn" }
  ]
}

Regler:
- Foreslå kun kanaler som faktisk mangler for et Twitch + GTA RP community
- Foreslå kanaler som #karakterer, #mats-haugland, #future-rp, #klipp, #highlights etc hvis de mangler
- Sett publiser: true for karakterkanaler og viktige informasjonskanaler
- karakterInfo fylles ut KUN for karakterspesifikke kanaler`,
    }],
    max_tokens: 800,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  try {
    const suggestions = JSON.parse(response.choices[0]?.message?.content ?? '{}') as ChannelSuggestions;
    return NextResponse.json({ channels: sorted, suggestions });
  } catch {
    return NextResponse.json({ channels: sorted, suggestions: null });
  }
}

// ─── POST – utfør endringer ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) {
    return NextResponse.json({ error: 'Mangler Discord-konfig' }, { status: 400 });
  }

  const body = await req.json() as {
    slett?: SlettAction[];
    opprett?: OpprettAction[];
    rename?: RenameAction[];
  };

  const resultater: string[] = [];

  // Hent eksisterende kanaler for å finne kategori-IDer
  const channelsRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
  const eksisterende = channelsRes.ok ? await channelsRes.json() as any[] : [];

  // ── Slett ────────────────────────────────────────────────────────────────
  for (const ch of body.slett ?? []) {
    const r = await fetch(`${DISCORD_API}/channels/${ch.id}`, {
      method: 'DELETE',
      headers: botHeaders(),
    });
    resultater.push(r.ok ? `✓ Slettet #${ch.navn}` : `✗ Feil ved sletting av #${ch.navn}`);
  }

  // ── Rename ───────────────────────────────────────────────────────────────
  for (const ch of body.rename ?? []) {
    const r = await fetch(`${DISCORD_API}/channels/${ch.id}`, {
      method: 'PATCH',
      headers: botHeaders(),
      body: JSON.stringify({ name: ch.til }),
    });
    resultater.push(r.ok ? `✓ Omdøpt #${ch.fra} → #${ch.til}` : `✗ Feil ved omdøping av #${ch.fra}`);
  }

  // ── Opprett ──────────────────────────────────────────────────────────────
  for (const ch of body.opprett ?? []) {
    let parentId: string | undefined;

    if (ch.kategori) {
      const eksKat = eksisterende.find(
        (c: any) => c.type === 4 && c.name.toLowerCase() === ch.kategori!.toLowerCase()
      );
      if (eksKat) {
        parentId = eksKat.id;
      } else {
        // Opprett kategori først
        const katRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          method: 'POST',
          headers: botHeaders(),
          body: JSON.stringify({ name: ch.kategori, type: 4 }),
        });
        if (katRes.ok) {
          const kat = await katRes.json() as any;
          parentId = kat.id;
          eksisterende.push(kat);
        }
      }
    }

    const channelBody: any = { name: ch.navn, type: 0 };
    if (parentId) channelBody.parent_id = parentId;
    if (ch.emne) channelBody.topic = ch.emne;

    const createRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify(channelBody),
    });

    if (createRes.ok) {
      const nyKanal = await createRes.json() as any;
      resultater.push(`✓ Opprettet #${ch.navn}`);

      // Publiser innhold hvis flagget
      if (ch.publiser) {
        await publiserKanalInnhold(nyKanal.id, ch, guildId);
        resultater.push(`  ↳ Innhold publisert i #${ch.navn}`);
      }
    } else {
      resultater.push(`✗ Feil ved opprettelse av #${ch.navn}`);
    }
  }

  return NextResponse.json({ resultater });
}

// ─── Publiser innhold i ny kanal ──────────────────────────────────────────────

async function publiserKanalInnhold(
  channelId: string,
  ch: OpprettAction,
  guildId: string
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const client = new OpenAI({ apiKey });
  const erKarakter = ch.karakterInfo || ch.navn.includes('karakter') ||
    ch.emne?.toLowerCase().includes('karakter') ||
    ch.navn.includes('mats') || ch.navn.includes('rp');

  if (erKarakter && ch.karakterInfo) {
    // Generer karakterkort med bilde
    const [tekstRes, bildeRes] = await Promise.all([
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Lag et Discord-karakterkort på norsk for denne GTA RP-karakteren. Bruk Discord markdown (bold, kursiv). Maks 200 ord.
Karakterinfo: ${ch.karakterInfo}
Kanal: #${ch.navn}`,
        }],
        max_tokens: 300,
        temperature: 0.8,
      }),
      client.images.generate({
        model: 'dall-e-3',
        prompt: `GTA RP character card art, cinematic dark style. Character: ${ch.karakterInfo}. Norwegian RP server aesthetic, dramatic lighting, neon accents. No text overlay.`,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    ]);

    const tekst = tekstRes.choices[0]?.message?.content ?? '';
    const bildeUrl = bildeRes.data?.[0]?.url;

    const embed: any = {
      title: `◆ ${ch.navn.toUpperCase().replace(/-/g, ' ')}`,
      description: tekst,
      color: 0x00ff41,
      footer: { text: 'GLENVEX Stream Control • Karakter' },
      timestamp: new Date().toISOString(),
    };
    if (bildeUrl) embed.image = { url: bildeUrl };

    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } else {
    // Generer generisk velkomstmelding for kanalen
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Lag en kort velkomstmelding på norsk for Discord-kanalen #${ch.navn} (${ch.emne ?? ''}). Maks 2 setninger. Ingen emojier.`,
      }],
      max_tokens: 100,
      temperature: 0.8,
    });

    const tekst = res.choices[0]?.message?.content ?? '';
    if (tekst) {
      await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: tekst }),
      });
    }
  }
}
