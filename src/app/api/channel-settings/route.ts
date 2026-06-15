import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

// ── Supabase connection ───────────────────────────────────────────────────────

function sbUrl(): string {
  return (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
}

function anonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
}

// Extract the user's Supabase access token from request cookies.
// @supabase/ssr stores the session as URL-encoded JSON in sb-<ref>-auth-token.
// Supports both single-cookie and chunked (sb-<ref>-auth-token.0/.1/...) formats.
function getAccessToken(req: NextRequest): string {
  const all = req.cookies.getAll();

  // Single cookie
  const single = all.find(c => /^sb-.+-auth-token$/.test(c.name));
  if (single?.value) {
    try {
      const sess = JSON.parse(decodeURIComponent(single.value));
      if (sess?.access_token) return sess.access_token as string;
    } catch {}
  }

  // Chunked cookies: sb-<ref>-auth-token.0, .1, …
  const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
  if (chunk0) {
    const base = chunk0.name.slice(0, -2);
    const parts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const v = all.find(c => c.name === `${base}.${i}`)?.value;
      if (!v) break;
      parts.push(v);
    }
    try {
      const sess = JSON.parse(decodeURIComponent(parts.join('')));
      if (sess?.access_token) return sess.access_token as string;
    } catch {}
  }

  return '';
}

function authHeaders(): Record<string, string> {
  // Service role bypasses RLS — correct for server-side workspace operations (no INSERT).
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const key = svcKey || anonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function sbSelect(wsId: string): Promise<Record<string, unknown> | null> {
  const url = sbUrl();
  if (!url) return null;
  const res = await fetch(
    `${url}/rest/v1/workspaces?id=eq.${encodeURIComponent(wsId)}&select=settings_json`,
    { headers: authHeaders(), signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) return null;
  const rows = await res.json() as any[];
  return rows[0] ?? null;
}

async function sbUpdate(wsId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const url = sbUrl();
  if (!url) return { ok: false, error: 'SUPABASE_URL mangler' };
  const res = await fetch(
    `${url}/rest/v1/workspaces?id=eq.${encodeURIComponent(wsId)}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
  }
  return { ok: true };
}

// ── Types ─────────────────────────────────────────────────────────────────────

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
  admin: string;
}

// ── Load / Save ───────────────────────────────────────────────────────────────

async function loadPrefs(): Promise<Partial<KanalPreferanser>> {
  const wsId = getWorkspaceId();
  const row = await sbSelect(wsId);
  if (row?.settings_json) {
    const prefs = (row.settings_json as any)?.kanalPreferanser;
    if (prefs) return prefs as Partial<KanalPreferanser>;
  }
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

async function savePrefs(prefs: Partial<KanalPreferanser>): Promise<void> {
  const wsId = getWorkspaceId();
  if (!wsId) throw new Error('Workspace ID mangler');

  const row = await sbSelect(wsId);
  if (!row) {
    throw Object.assign(
      new Error('Workspace mangler. Fullfør onboarding først.'),
      { status: 404 }
    );
  }

  const current = (row.settings_json as Record<string, unknown>) ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };

  const { ok, error } = await sbUpdate(wsId, {
    settings_json: nySettings,
    updated_at: new Date().toISOString(),
  });

  if (!ok) throw new Error(`Lagring feilet: ${error}`);
}

// ── Route handlers ────────────────────────────────────────────────────────────

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
    admin: lagret.admin ?? '',
  };

  return NextResponse.json({ kanaler, preferanser });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<KanalPreferanser>;

  try {
    await savePrefs(body);
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
