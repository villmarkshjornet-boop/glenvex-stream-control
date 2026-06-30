import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge?: string;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41' },
  { type: 'subscribers', label: 'Subscribers', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf' },
  { type: 'donations',   label: 'Donasjoner',  mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47' },
];

async function loadGoals(): Promise<Goal[]> {
  if (!isDbAvailable()) return DEFAULT_GOALS;
  const db = getDb();
  if (!db) return DEFAULT_GOALS;
  const { data } = await db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single();
  return data?.settings_json?.viewer_goals ?? DEFAULT_GOALS;
}

async function saveGoals(goals: Goal[]): Promise<void> {
  if (!isDbAvailable()) return;
  const db = getDb();
  if (!db) return;
  const { data: existing } = await db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single();
  const current = existing?.settings_json ?? {};
  await db.from('workspaces').update({
    settings_json: { ...current, viewer_goals: goals },
    updated_at: new Date().toISOString(),
  }).eq('id', getWorkspaceId());
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
