import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface Goal {
  type: 'followers' | 'subscribers' | 'viewers';
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers', label: 'Følgere', mal: 1000, gjeldende: 0, aktiv: true },
  { type: 'subscribers', label: 'Subscribers', mal: 50, gjeldende: 0, aktiv: true },
  { type: 'viewers', label: 'Seere (snitt)', mal: 20, gjeldende: 0, aktiv: false },
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
  const data = await req.json() as Goal[];
  await saveGoals(data);
  return NextResponse.json({ ok: true });
}
