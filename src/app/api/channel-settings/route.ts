import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

// ── Direct Supabase REST helpers (bypasses JS-client auth state / RLS issues) ──

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function sbUrl(): string {
  return (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
}

async function sbGet(table: string, filter: string): Promise<any[]> {
  const base = sbUrl();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const res = await fetch(`${base}/rest/v1/${table}?${filter}&select=*`, {
    headers: { ...sbHeaders(), Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  return res.json();
}

async function sbPatch(table: string, filter: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const base = sbUrl();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: 'Supabase ikke konfigurert' };
  const res = await fetch(`${base}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
  }
  return { ok: true };
}

async function sbInsert(table: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const base = sbUrl();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: 'Supabase ikke konfigurert' };
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
  }
  return { ok: true };
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

async function loadPrefs(): Promise<Partial<KanalPreferanser>> {
  const wsId = getWorkspaceId();
  const rows = await sbGet('workspaces', `id=eq.${encodeURIComponent(wsId)}`);
  if (rows.length > 0 && rows[0].settings_json?.kanalPreferanser) {
    return rows[0].settings_json.kanalPreferanser;
  }
  // Fallback fil
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

// Throws on any failure — caller must handle and return 500.
async function savePrefs(prefs: Partial<KanalPreferanser>): Promise<void> {
  const wsId = getWorkspaceId();
  if (!wsId) throw new Error('Workspace ID mangler');

  const base = sbUrl();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase ikke konfigurert');

  // Read existing row (direct REST — bypasses JS-client auth / RLS issues)
  const rows = await sbGet('workspaces', `id=eq.${encodeURIComponent(wsId)}`);
  const current = (rows[0]?.settings_json as Record<string, unknown>) ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };
  const now = new Date().toISOString();

  if (rows.length > 0) {
    // Row exists — PATCH it
    const { ok, error } = await sbPatch(
      'workspaces',
      `id=eq.${encodeURIComponent(wsId)}`,
      { settings_json: nySettings, updated_at: now }
    );
    if (!ok) throw new Error(`Lagring feilet: ${error}`);
  } else {
    // Row missing — INSERT (service role key bypasses RLS)
    const { ok, error } = await sbInsert('workspaces', {
      id: wsId,
      owner_user_id: wsId,
      brand_name: process.env.NEXT_PUBLIC_APP_NAME ?? wsId,
      streamer_name: wsId,
      twitch_channel_name: wsId,
      bot_personality: 'dark_gaming',
      plan: 'creator',
      settings_json: nySettings,
      created_at: now,
      updated_at: now,
    });
    if (!ok) throw new Error(`Opprettelse feilet: ${error}`);
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
    await savePrefs(body);
  } catch (err: any) {
    console.error('[channel-settings POST] Save failed:', err?.message);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Ukjent feil' },
      { status: 500 }
    );
  }

  try {
    const { nullstillKanalCache } = await import('@/lib/discordChannel');
    nullstillKanalCache();
  } catch {}

  return NextResponse.json({ success: true, source: 'supabase', saved: true });
}
