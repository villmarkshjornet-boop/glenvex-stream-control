import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface PersonaAdminSettings {
  showcaseAktiv:       boolean;
  twitchVarselAktiv:   boolean;
  showcaseKanalId:     string;
  cooldownMinutter:    number;
}

const DEFAULTS: PersonaAdminSettings = {
  showcaseAktiv:     false,
  twitchVarselAktiv: false,
  showcaseKanalId:   '',
  cooldownMinutter:  60,
};

async function loadSettings(wsId: string): Promise<PersonaAdminSettings> {
  const db = getDb();
  if (!db) return DEFAULTS;
  const { data } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();
  const sj = (data as any)?.settings_json ?? {};
  return { ...DEFAULTS, ...(sj.personaSettings ?? {}) };
}

export async function GET() {
  const wsId    = getWorkspaceId();
  const settings = await loadSettings(wsId);
  return NextResponse.json({ settings });
}

export async function POST(req: Request) {
  const wsId = getWorkspaceId();
  const db   = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB ikke tilgjengelig' });

  const body    = await req.json();
  const current = await loadSettings(wsId);
  const merged  = { ...current, ...body } as PersonaAdminSettings;

  const { data: wsRow } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();

  const existingSj = (wsRow as any)?.settings_json ?? {};
  await db
    .from('workspaces')
    .update({ settings_json: { ...existingSj, personaSettings: merged } })
    .eq('id', wsId);

  return NextResponse.json({ ok: true, settings: merged });
}
