import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'schedule.json');

interface StreamDay {
  dag: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
}

function loadFile(): StreamDay[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveFile(data: StreamDay[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

async function loadFromDb(): Promise<StreamDay[] | null> {
  if (!isDbAvailable()) return null;
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', getWorkspaceId())
    .single();
  return data?.settings_json?.streamplan ?? null;
}

async function ensureWorkspace(_db: any) {
  // Workspace opprettes kun i onboarding — ikke her.
}

async function saveToDb(plan: StreamDay[]): Promise<boolean> {
  if (!isDbAvailable()) return false;
  const db = getDb();
  if (!db) return false;

  await ensureWorkspace(db);

  // Hent eksisterende settings_json og slå sammen
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
  const data = await req.json() as StreamDay[];

  // Lagre begge steder
  const dbOk = await saveToDb(data);
  saveFile(data); // fallback på Railway

  // Notify bot om ny streamplan (fire-and-forget)
  const botApiUrl = process.env.BOT_API_URL;
  if (botApiUrl && data.some(d => d.aktiv)) {
    fetch(`${botApiUrl}/stream-syklus/discord-varsling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: data }),
    }).catch(() => {});
  }

  const aktive = data.filter(d => d.aktiv);
  await logSystemEvent({
    source: 'streamplan',
    event_type: 'STREAM_PLAN_SAVED',
    title: `Streamplan lagret – ${aktive.length} aktive stream${aktive.length !== 1 ? 'er' : ''}`,
    description: aktive.map(d => `${d.dag} ${d.tid}: ${d.spill}`).join(', ') || 'Ingen aktive streamdager',
    severity: 'info',
    metadata: { aktiveStreamdager: aktive.length, plan: data.slice(0, 7) },
  });

  return NextResponse.json({ ok: true, lagret: dbOk ? 'supabase' : 'fil' });
}
