import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ innsikt: '' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ innsikt: 'Ingen OpenAI-nøkkel.' });

  // Hent notater for brukeren
  const minnerFile = path.join(process.cwd(), 'data', 'community-memory.json');
  const minner = fs.existsSync(minnerFile) ? JSON.parse(fs.readFileSync(minnerFile, 'utf-8')).filter((m: any) => m.userId === userId) : [];

  // Hent member-profil
  const membersFile = path.join(process.cwd(), 'data', 'members.json');
  const members = fs.existsSync(membersFile) ? JSON.parse(fs.readFileSync(membersFile, 'utf-8')) : {};
  const member = members[userId];

  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Du er AI-assistent for streamer GLENVEX. Generer ett konkret, naturlig forslag på norsk til hva GLENVEX kan si til denne seeren neste gang de møtes. Maks 2 setninger. Ikke robotaktig.

Seerprofil:
- Navn: ${member?.displayName ?? 'Ukjent'}
- Meldinger: ${member?.messages ?? 0}
- Level: ${member?.level ?? 1}
- Subs: ${member?.subs ?? 0}
- Notater: ${minner.map((m: any) => m.notat).join(', ') || 'Ingen notater ennå'}`,
    }],
    max_tokens: 100,
    temperature: 0.85,
  });

  return NextResponse.json({ innsikt: res.choices[0]?.message?.content ?? '' });
}
