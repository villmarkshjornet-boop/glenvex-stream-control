import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'clips-queue.json');
const DISCORD_API = 'https://discord.com/api/v10';

export interface ClipSubmission {
  id: string;
  url: string;
  beskrivelse: string;
  brukernavn: string;
  timestamp: string;
  status: 'pending' | 'godkjent' | 'avvist';
}

function load(): ClipSubmission[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: ClipSubmission[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { url: string; beskrivelse: string; brukernavn: string };
  const clips = load();
  const ny: ClipSubmission = {
    id: randomUUID(),
    url: body.url,
    beskrivelse: body.beskrivelse,
    brukernavn: body.brukernavn,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };
  clips.unshift(ny);
  save(clips);
  return NextResponse.json(ny);
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json() as { id: string; status: 'godkjent' | 'avvist' };
  const clips = load();
  const clip = clips.find(c => c.id === id);
  if (!clip) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });

  clip.status = status;
  save(clips);

  // Publiser godkjent clip i Discord
  if (status === 'godkjent') {
    const kanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
    if (kanalId && process.env.DISCORD_BOT_TOKEN) {
      await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          embeds: [{
            title: '🎬 Ny clip godkjent!',
            description: `**${clip.brukernavn}** sendte inn en clip:\n\n${clip.beskrivelse}\n\n[Se clipsen](${clip.url})`,
            color: 0x00ff41,
            footer: { text: 'GLENVEX Stream Control • Clip-innsending' },
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
