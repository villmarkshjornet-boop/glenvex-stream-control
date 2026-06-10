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
  subs: string;
  pre_hype: string;
  raid: string;
  ai_producer: string;
  content_factory: string;
  errors: string;
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

// Throws on any DB failure — caller must handle and return 500.
async function savePrefs(prefs: Partial<KanalPreferanser>): Promise<void> {
  if (!isDbAvailable()) throw new Error('Supabase ikke tilgjengelig');
  const db = getDb();
  if (!db) throw new Error('Supabase client mangler');

  const wsId = getWorkspaceId();

  const { data: existing, error: readErr } = await db
    .from('workspaces')
    .select('id, settings_json')
    .eq('id', wsId)
    .single();

  // PGRST116 = no row — treat as "needs insert". Any other error is a real failure.
  if (readErr && readErr.code !== 'PGRST116') {
    throw new Error(`Lesefeil: ${readErr.message}`);
  }

  const current = (existing?.settings_json as Record<string, any>) ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };

  if (!existing) {
    const { error: upsertErr } = await db.from('workspaces').upsert({
      id: wsId,
      owner_user_id: 'glenvex',
      streamer_name: process.env.TWITCH_USERNAME ?? 'glenvex',
      brand_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'GLENVEX Creator OS',
      twitch_channel_name: process.env.TWITCH_USERNAME ?? 'glenvex',
      discord_guild_id: process.env.DISCORD_GUILD_ID,
      bot_personality: 'dark_gaming',
      plan: 'creator',
      settings_json: nySettings,
    }, { onConflict: 'id' });
    if (upsertErr) throw new Error(`Upsert feilet: ${upsertErr.message}`);
  } else {
    const { error: updateErr } = await db
      .from('workspaces')
      .update({ settings_json: nySettings, updated_at: new Date().toISOString() })
      .eq('id', wsId);
    if (updateErr) throw new Error(`Update feilet: ${updateErr.message}`);
  }
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

  // DIAG-5: What loadPrefs returned
  console.log('[DIAG channel-settings GET] wsId:', getWorkspaceId());
  console.log('[DIAG channel-settings GET] loadPrefs result:', JSON.stringify(lagret));

  const preferanser: Partial<KanalPreferanser> = {
    live: lagret.live ?? process.env.DISCORD_LIVE_CHANNEL_ID ?? '',
    announce: lagret.announce ?? '',
    chat: lagret.chat ?? process.env.DISCORD_CHAT_CHANNEL_ID ?? '',
    clips: lagret.clips ?? '',
    partner: lagret.partner ?? '',
    streamplan: lagret.streamplan ?? '',
    events: lagret.events ?? '',
    subs: lagret.subs ?? '',
    pre_hype: lagret.pre_hype ?? '',
    raid: lagret.raid ?? '',
    ai_producer: lagret.ai_producer ?? '',
    content_factory: lagret.content_factory ?? '',
    errors: lagret.errors ?? '',
  };

  // DIAG-5 continued: exact response
  console.log('[DIAG channel-settings GET] response preferanser:', JSON.stringify(preferanser));

  return NextResponse.json({ kanaler, preferanser });
}

export async function POST(req: NextRequest) {
  const wsId = getWorkspaceId();
  const body = await req.json() as Partial<KanalPreferanser>;

  // DIAG-1: Incoming payload + workspaceId
  console.log('[DIAG channel-settings POST] wsId:', wsId);
  console.log('[DIAG channel-settings POST] incoming body:', JSON.stringify(body));

  // DIAG-2: Read DB before write
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data: before, error: beforeErr } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', wsId)
        .single();
      console.log('[DIAG channel-settings POST] DB before write - error:', beforeErr?.message ?? null);
      console.log('[DIAG channel-settings POST] DB before write - settings_json:', JSON.stringify(before?.settings_json ?? null));
    }
  }

  try {
    await savePrefs(body);
  } catch (err: any) {
    console.error('[channel-settings POST] Save failed:', err?.message);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Ukjent DB-feil' },
      { status: 500 }
    );
  }

  // DIAG-3: Read DB after write
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data: after, error: afterErr } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', wsId)
        .single();
      console.log('[DIAG channel-settings POST] DB after write - error:', afterErr?.message ?? null);
      console.log('[DIAG channel-settings POST] DB after write - kanalPreferanser:', JSON.stringify(after?.settings_json?.kanalPreferanser ?? null));
    }
  }

  // Nullstill cache i discordChannel
  try {
    const { nullstillKanalCache } = await import('@/lib/discordChannel');
    nullstillKanalCache();
  } catch {}
  return NextResponse.json({ success: true, source: 'supabase', saved: true });
}
