import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

export interface KanalPreferanser {
  live: string;
  announce: string;
  chat: string;
  clips: string;
  partner: string;
  streamplan: string;
  events: string;
}

async function loadPrefs(): Promise<Partial<KanalPreferanser>> {
  // Supabase først
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', getWorkspaceId())
        .single();
      if (data?.settings_json?.kanalPreferanser) {
        return data.settings_json.kanalPreferanser;
      }
    }
  }
  // Fallback fil
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

async function savePrefs(prefs: Partial<KanalPreferanser>): Promise<boolean> {
  // Lagre i fil (Railway fallback)
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch {}

  if (!isDbAvailable()) return false;
  const db = getDb();
  if (!db) return false;

  const wsId = getWorkspaceId();

  // Hent eksisterende settings_json
  const { data: existing } = await db
    .from('workspaces')
    .select('id, settings_json')
    .eq('id', wsId)
    .single();

  const current = existing?.settings_json ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };

  if (!existing) {
    // Opprett workspace med preferansene inkludert
    const { error } = await db.from('workspaces').insert({
      id: wsId,
      owner_user_id: 'glenvex',
      streamer_name: process.env.TWITCH_USERNAME ?? 'glenvex',
      brand_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'GLENVEX Creator OS',
      twitch_channel_name: process.env.TWITCH_USERNAME ?? 'glenvex',
      discord_guild_id: process.env.DISCORD_GUILD_ID,
      bot_personality: 'dark_gaming',
      plan: 'creator',
      settings_json: nySettings,
    });
    return !error;
  }

  // Oppdater eksisterende workspace
  const { error } = await db
    .from('workspaces')
    .update({ settings_json: nySettings, updated_at: new Date().toISOString() })
    .eq('id', wsId);

  return !error;
}

export async function GET() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;

  const kanaler: any[] = [];
  if (guildId && token) {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      const alle = await res.json() as any[];
      kanaler.push(...alle
        .filter((k: any) => k.type === 0)
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
        .map((k: any) => ({
          id: k.id,
          navn: k.name,
          kategori: alle.find((c: any) => c.id === k.parent_id)?.name ?? 'Ingen kategori',
        }))
      );
    }
  }

  const lagret = await loadPrefs();
  const preferanser: Partial<KanalPreferanser> = {
    live: lagret.live ?? process.env.DISCORD_LIVE_CHANNEL_ID ?? '',
    announce: lagret.announce ?? '',
    chat: lagret.chat ?? process.env.DISCORD_CHAT_CHANNEL_ID ?? '',
    clips: lagret.clips ?? '',
    partner: lagret.partner ?? '',
    streamplan: lagret.streamplan ?? '',
    events: lagret.events ?? '',
  };

  return NextResponse.json({ kanaler, preferanser });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<KanalPreferanser>;
  const ok = await savePrefs(body);
  // Nullstill cache i discordChannel
  try {
    const { nullstillKanalCache } = await import('@/lib/discordChannel');
    nullstillKanalCache();
  } catch {}
  return NextResponse.json({ ok: true, lagret: ok ? 'supabase' : 'fil' });
}
