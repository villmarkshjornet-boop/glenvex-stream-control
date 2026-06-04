import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');
const DISCORD_API = 'https://discord.com/api/v10';

export interface KanalPreferanser {
  live: string;
  announce: string;
  chat: string;
  clips: string;
  partner: string;
  streamplan: string;
  events: string;
}

function load(): Partial<KanalPreferanser> {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

function save(data: Partial<KanalPreferanser>) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export async function GET() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) return NextResponse.json({ kanaler: [], preferanser: {} });

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
  });

  const alleKanaler = res.ok ? await res.json() as any[] : [];
  const tekstKanaler = alleKanaler
    .filter((k: any) => k.type === 0)
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    .map((k: any) => ({
      id: k.id,
      navn: k.name,
      kategori: alleKanaler.find((c: any) => c.id === k.parent_id)?.name ?? 'Ingen kategori',
    }));

  // Hent lagrede preferanser + env-fallbacks
  const lagret = load();
  const preferanser: Partial<KanalPreferanser> = {
    live: lagret.live ?? process.env.DISCORD_LIVE_CHANNEL_ID ?? '',
    announce: lagret.announce ?? process.env.DISCORD_LIVE_CHANNEL_ID ?? '',
    chat: lagret.chat ?? process.env.DISCORD_CHAT_CHANNEL_ID ?? '',
    clips: lagret.clips ?? '',
    partner: lagret.partner ?? '',
    streamplan: lagret.streamplan ?? '',
    events: lagret.events ?? '',
  };

  return NextResponse.json({ kanaler: tekstKanaler, preferanser });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<KanalPreferanser>;
  save(body);
  return NextResponse.json({ ok: true });
}
