import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { goalType: string } }
) {
  // Workspace ID is injected by middleware for auth'd routes
  const wsId = req.headers.get('x-workspace-id');
  if (!wsId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 401 });
  }

  const { goalType } = params;

  let delta: number;
  try {
    const body = await req.json() as { delta: number };
    delta = typeof body.delta === 'number' ? body.delta : 1;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  }

  const { data: wsData, error } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();

  if (error || !wsData) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const goals: any[] = wsData.settings_json?.viewer_goals ?? [];
  const idx = goals.findIndex((g: any) => g.type === goalType);

  if (idx === -1) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  }

  const goal = goals[idx];

  // Only manual goals can be incremented
  const isManual =
    goal.source === 'manual' ||
    (goal.source === undefined && goal.manuell === true) ||
    (goal.source === undefined && !['followers', 'subscribers'].includes(goal.type));

  if (!isManual) {
    return NextResponse.json({ error: 'Only manual goals can be incremented' }, { status: 400 });
  }

  // delta === 0 means reset to startValue
  let newValue: number;
  if (delta === 0) {
    newValue = goal.startValue ?? 0;
  } else {
    newValue = Math.max(0, (goal.gjeldende ?? 0) + delta);
  }

  const updatedGoals = goals.map((g: any, i: number) =>
    i === idx ? { ...g, gjeldende: newValue } : g
  );

  const currentSettings = wsData.settings_json ?? {};
  const { error: saveError } = await db
    .from('workspaces')
    .update({
      settings_json: { ...currentSettings, viewer_goals: updatedGoals },
      updated_at: new Date().toISOString(),
    })
    .eq('id', wsId);

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: goalType, gjeldende: newValue });
}
