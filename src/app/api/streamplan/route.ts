import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'schedule.json');

// Legacy format (still accepted on write for backward compat)
interface StreamDay {
  dag: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
}

// New format (stored from UI v2 onwards)
export interface StreamEntry {
  id: string;
  type: 'weekly' | 'single';
  weekday?: number;
  dag?: string;
  date?: string;       // ISO "YYYY-MM-DD" for single-date streams
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
  status?: 'upcoming' | 'completed' | 'skipped';
  pre_hype_enabled?: boolean;
  pre_hype_minutes_before?: number;
}

// Migrate legacy StreamDay → StreamEntry on read
function migrateEntry(raw: any, idx: number): StreamEntry {
  if (raw.type === 'weekly' || raw.type === 'single') return raw as StreamEntry;
  return {
    id: raw.id ?? `legacy-${idx}`,
    type: 'weekly',
    dag: raw.dag,
    tid: raw.tid ?? '20:00',
    spill: raw.spill ?? '',
    tittel: raw.tittel ?? '',
    aktiv: raw.aktiv !== false,
    status: 'upcoming',
    pre_hype_enabled: true,
    pre_hype_minutes_before: 60,
  };
}

function loadFile(): StreamEntry[] {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as any[];
      return raw.map((e, i) => migrateEntry(e, i));
    }
  } catch {}
  return [];
}

function saveFile(data: StreamEntry[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

async function loadFromDb(): Promise<StreamEntry[] | null> {
  if (!isDbAvailable()) return null;
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', getWorkspaceId())
    .single();
  const raw: any[] = data?.settings_json?.streamplan ?? [];
  if (raw.length === 0) return null;
  return raw.map((e, i) => migrateEntry(e, i));
}

async function saveToDb(plan: StreamEntry[]): Promise<boolean> {
  if (!isDbAvailable()) return false;
  const db = getDb();
  if (!db) return false;

  const { data: existing } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', getWorkspaceId())
    .single();

  const current = existing?.settings_json ?? {};
  const { error } = await db
    .from('workspaces')
    .update({ settings_json: { ...current, streamplan: plan }, updated_at: new Date().toISOString() })
    .eq('id', getWorkspaceId());
  return !error;
}

export async function GET() {
  const dbPlan = await loadFromDb();
  if (dbPlan && dbPlan.length > 0) return NextResponse.json(dbPlan);
  return NextResponse.json(loadFile());
}

export async function POST(req: NextRequest) {
  const raw = await req.json() as (StreamEntry | StreamDay)[];

  // Normalize: accept both legacy StreamDay and new StreamEntry
  const data: StreamEntry[] = (raw as any[]).map((e, i) => migrateEntry(e, i));

  const dbOk = await saveToDb(data);
  saveFile(data);

  // Notify bot om ny streamplan (fire-and-forget)
  const botApiUrl = process.env.BOT_API_URL;
  if (botApiUrl && data.some(e => e.aktiv)) {
    fetch(`${botApiUrl}/stream-syklus/discord-varsling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: data }),
    }).catch(() => {});
  }

  const aktive = data.filter(e => e.aktiv);
  const ukentlige = aktive.filter(e => e.type === 'weekly');
  const single = aktive.filter(e => e.type === 'single');

  await logSystemEvent({
    source: 'streamplan',
    event_type: 'STREAMPLAN_SAVED',
    title: `Streamplan lagret – ${aktive.length} aktive (${ukentlige.length} ukentlige, ${single.length} enkeltdatoer)`,
    description: aktive.map(e => e.type === 'single'
      ? `${e.date} kl. ${e.tid}: ${e.spill}${e.pre_hype_enabled ? ` (pre-hype ${e.pre_hype_minutes_before ?? 60}min)` : ''}`
      : `${e.dag ?? 'ukentlig'} kl. ${e.tid}: ${e.spill}${e.pre_hype_enabled ? ` (pre-hype ${e.pre_hype_minutes_before ?? 60}min)` : ''}`
    ).join(', ') || 'Ingen aktive streamdager',
    severity: 'info',
    metadata: { aktiveStreamdager: aktive.length, ukentlige: ukentlige.length, single: single.length, plan: data.slice(0, 10) },
  });

  return NextResponse.json({ ok: true, lagret: dbOk ? 'supabase' : 'fil' });
}
