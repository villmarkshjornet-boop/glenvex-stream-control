import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface Goal {
  type: string;
  label: string;
  mal: number;             // targetValue
  gjeldende: number;       // currentValue
  aktiv: boolean;
  farge?: string;
  icon?: string;
  manuell?: boolean;
  source?: 'auto' | 'manual';   // 'auto' = Twitch API, 'manual' = bruker inkrementerer
  startValue?: number;           // reset-target, standard 0
  resetPolicy?: 'never' | 'per_stream' | 'daily' | 'manual'; // standard 'never'
  lastResetStreamId?: string | null;
  lastResetAt?: string | null;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', source: 'auto'   },
  { type: 'subscribers', label: 'Subscribers', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf', source: 'auto'   },
  { type: 'donations',   label: 'Donasjoner',  mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47', source: 'manual', manuell: true },
];

async function loadGoals(): Promise<Goal[]> {
  if (!isDbAvailable()) return DEFAULT_GOALS;
  const db = getDb();
  if (!db) return DEFAULT_GOALS;
  const { data } = await db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single();
  const saved: Goal[] | undefined = data?.settings_json?.viewer_goals;
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_GOALS;
  // Ensure backward-compat: derive source from manuell if not set
  return saved.map(g => ({
    ...g,
    source: g.source ?? (g.manuell ? 'manual' : 'auto'),
  }));
}

async function saveGoals(goals: Goal[]): Promise<void> {
  if (!isDbAvailable()) return;
  const db = getDb();
  if (!db) return;
  const wsId = getWorkspaceId();
  const { data: existing } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const current = existing?.settings_json ?? {};
  await db.from('workspaces').update({
    settings_json: { ...current, viewer_goals: goals },
    updated_at: new Date().toISOString(),
  }).eq('id', wsId);
}

export async function GET() {
  return NextResponse.json(await loadGoals());
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Fx-only update (effektinnstillinger) — mål-array kan følge med for konsistens
  if (body._fxOnly && body.fx) {
    if (!isDbAvailable()) return NextResponse.json({ ok: true });
    const db = getDb();
    if (!db) return NextResponse.json({ ok: true });
    const wsId = getWorkspaceId();
    const { data: existing } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
    const current = existing?.settings_json ?? {};
    const goals = Array.isArray(body.goals) ? body.goals : (current.viewer_goals ?? []);
    await db.from('workspaces').update({
      settings_json: { ...current, viewer_goals: goals, viewer_goals_fx: body.fx },
      updated_at: new Date().toISOString(),
    }).eq('id', wsId);
    return NextResponse.json({ ok: true });
  }

  const data = Array.isArray(body) ? body as Goal[] : (body.goals as Goal[] ?? []);
  await saveGoals(data);
  return NextResponse.json({ ok: true });
}
