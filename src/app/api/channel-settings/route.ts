import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders, cookies } from 'next/headers';
import { getWorkspaceId } from '@/lib/workspace';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';
const FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

// ── Supabase REST — uses user JWT (anon key + user token) so RLS allows own rows ──
// Service role key is tried first; falls back to user JWT if service role is misconfigured.

function sbBase(): string {
  return (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
}

function serviceRoleHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function extractAccessTokenFromCookies(): string {
  try {
    const jar = cookies();
    const all = jar.getAll();
    const single = all.find(c => /^sb-.+-auth-token$/.test(c.name));
    if (single?.value) {
      const sess = JSON.parse(decodeURIComponent(single.value));
      if (sess.access_token) return sess.access_token as string;
    }
    const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
    if (chunk0) {
      const base = chunk0.name.replace('.0', '');
      const chunks: string[] = [];
      for (let i = 0; i < 10; i++) {
        const v = jar.get(`${base}.${i}`)?.value;
        if (!v) break;
        chunks.push(v);
      }
      const sess = JSON.parse(decodeURIComponent(chunks.join('')));
      if (sess.access_token) return sess.access_token as string;
    }
  } catch {}
  return '';
}

function userJwtHeaders(token: string): Record<string, string> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Returns best available headers: user JWT > service role > null
// User JWT is preferred — workspace rows are owned by the user, RLS allows auth.uid() = owner_user_id.
// Service role fallback only if no user session (e.g. server-side calls).
function bestHeaders(): Record<string, string> | null {
  const token = extractAccessTokenFromCookies();
  if (token) return userJwtHeaders(token);
  const svc = serviceRoleHeaders();
  if (svc) return svc;
  return null;
}

async function sbGet(table: string, filter: string): Promise<any[]> {
  const base = sbBase();
  const hdrs = bestHeaders();
  if (!base || !hdrs) return [];
  const res = await fetch(`${base}/rest/v1/${table}?${filter}&select=*`, {
    headers: { ...hdrs, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  return res.json();
}

async function sbPatch(table: string, filter: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const base = sbBase();
  const hdrs = bestHeaders();
  if (!base || !hdrs) return { ok: false, error: 'Supabase ikke konfigurert' };
  const res = await fetch(`${base}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...hdrs, Prefer: 'return=minimal' },
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

  // Read existing row (direct REST — bypasses JS-client auth / RLS issues)
  const rows = await sbGet('workspaces', `id=eq.${encodeURIComponent(wsId)}`);
  const current = (rows[0]?.settings_json as Record<string, unknown>) ?? {};
  const nySettings = { ...current, kanalPreferanser: prefs };
  const now = new Date().toISOString();

  if (rows.length === 0) {
    throw Object.assign(new Error('Workspace mangler. Fullfør onboarding først.'), { status: 404 });
  }

  const { ok, error } = await sbPatch(
    'workspaces',
    `id=eq.${encodeURIComponent(wsId)}`,
    { settings_json: nySettings, updated_at: now }
  );
  if (!ok) throw new Error(`Lagring feilet: ${error}`);
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
