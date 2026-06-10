import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getWorkspaceId } from '@/lib/workspace';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
}

// Creates a Supabase client authenticated as the current user.
// Uses req.cookies (from the request) so it works correctly in Next.js 14 Route Handlers.
// next/headers cookies() is read-only in Route Handlers and can cause issues with @supabase/ssr.
function makeSupabaseClient(req: NextRequest) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll() {
        // Route Handlers cannot set cookies here — no-op
      },
    },
  });
}

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

async function loadPrefs(req: NextRequest): Promise<Partial<KanalPreferanser>> {
  const wsId = getWorkspaceId();
  const supabase = makeSupabaseClient(req);

  if (supabase) {
    const { data } = await supabase
      .from('workspaces')
      .select('settings_json')
      .eq('id', wsId)
      .single();

    if (data?.settings_json?.kanalPreferanser) {
      return data.settings_json.kanalPreferanser as Partial<KanalPreferanser>;
    }
  }

  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

async function savePrefs(prefs: Partial<KanalPreferanser>, req: NextRequest): Promise<void> {
  const wsId = getWorkspaceId();
  if (!wsId) throw new Error('Workspace ID mangler');

  const url = supabaseUrl();
  const key = anonKey();
  console.log('[channel-settings] url set:', !!url, '| anonKey set:', !!key, '| wsId:', wsId);

  const supabase = makeSupabaseClient(req);
  if (!supabase) throw new Error('Supabase ikke konfigurert (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY mangler)');

  const { data: row, error: selectErr } = await supabase
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();

  console.log('[channel-settings] select result — row:', !!row, '| err:', selectErr?.code, selectErr?.message);

  if (selectErr && selectErr.code !== 'PGRST116') {
    throw new Error(`Les feilet: ${selectErr.message}`);
  }

  if (!row) {
    throw Object.assign(
      new Error('Workspace mangler. Fullfør onboarding først.'),
      { status: 404 }
    );
  }

  const current = (row.settings_json as Record<string, unknown>) ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };

  const { error: updateErr } = await supabase
    .from('workspaces')
    .update({ settings_json: nySettings, updated_at: new Date().toISOString() })
    .eq('id', wsId);

  console.log('[channel-settings] update error:', updateErr?.message ?? 'none');
  if (updateErr) throw new Error(`Lagring feilet: ${updateErr.message}`);
}

export async function GET(req: NextRequest) {
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

  const lagret = await loadPrefs(req);

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

  return NextResponse.json({ kanaler, preferanser });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<KanalPreferanser>;

  try {
    await savePrefs(body, req);
  } catch (err: any) {
    console.error('[channel-settings POST] Save failed:', err?.message);
    const status = (err as any)?.status === 404 ? 404 : 500;
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Ukjent feil' },
      { status }
    );
  }

  try {
    const { nullstillKanalCache } = await import('@/lib/discordChannel');
    nullstillKanalCache();
  } catch {}

  return NextResponse.json({ success: true, source: 'supabase', saved: true });
}
