import { NextRequest, NextResponse } from 'next/server';
import { getCharacters, addCharacter, updateCharacter, deleteCharacter } from '@/lib/rpCharacters';
import { addContent } from '@/lib/contentLibrary';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

export async function GET() {
  return NextResponse.json(getCharacters());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const karakter = addCharacter({
    navn: body.navn ?? '',
    kallenavn: body.kallenavn,
    server: body.server ?? 'Future RP',
    rolle: body.rolle ?? '',
    beskrivelse: body.beskrivelse ?? '',
    backstory: body.backstory ?? '',
    fraksjon: body.fraksjon,
    bildeUrl: body.bildeUrl,
    status: 'aktiv',
    discordMsgId: body.discordMsgId,
    discordKanalId: body.discordKanalId,
    sisteStream: body.sisteStream,
  });

  // Lagre i content library
  addContent({
    tittel: `RP Karakter: ${karakter.navn}`,
    type: 'rp-karakter',
    status: body.discordMsgId ? 'publisert' : 'draft',
    tekst: body.karakterIntro ?? '',
    bildeUrl: body.bildeUrl,
    kanalId: body.discordKanalId,
    modul: 'RP Manager',
    opprettetAv: 'dashboard',
    discordMsgId: body.discordMsgId,
    publisert: body.discordMsgId ? new Date().toISOString() : undefined,
    tags: [karakter.server, karakter.rolle],
  });

  return NextResponse.json(karakter);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json();
  const karakter = updateCharacter(id, updates);
  if (!karakter) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  return NextResponse.json(karakter);
}

export async function DELETE(req: NextRequest) {
  const { id, slettDiscord } = await req.json() as { id: string; slettDiscord: boolean };
  const discordMsgId = deleteCharacter(id);

  if (slettDiscord && discordMsgId) {
    const chars = getCharacters();
    const kanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
    if (kanalId) {
      await fetch(`${DISCORD_API}/channels/${kanalId}/messages/${discordMsgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
