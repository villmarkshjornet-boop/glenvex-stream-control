import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface RewardRole {
  level: number;
  roleId: string;
  roleName: string;
}

export interface CommunitySettings {
  aktiv: boolean;
  xpAktiv: boolean;
  levelUpMeldingerAktiv: boolean;
  rewardRoles: RewardRole[];
  xpCooldownSek: number;
  xpMinMeldingslengde: number;
}

export const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  aktiv: true,
  xpAktiv: true,
  levelUpMeldingerAktiv: true,
  rewardRoles: [],
  xpCooldownSek: 60,
  xpMinMeldingslengde: 4,
};

async function loadSettings(wsId: string): Promise<CommunitySettings> {
  const db = getDb();
  if (!db) return { ...DEFAULT_COMMUNITY_SETTINGS };
  const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const stored = (data as any)?.settings_json?.communitySettings;
  return stored ? { ...DEFAULT_COMMUNITY_SETTINGS, ...stored } : { ...DEFAULT_COMMUNITY_SETTINGS };
}

async function saveSettings(wsId: string, settings: Partial<CommunitySettings>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const current = (data as any)?.settings_json ?? {};
  const existing = current.communitySettings ?? {};
  await db.from('workspaces').update({
    settings_json: { ...current, communitySettings: { ...existing, ...settings } },
    updated_at: new Date().toISOString(),
  }).eq('id', wsId);
}

export async function GET() {
  try {
    const settings = await loadSettings(getWorkspaceId());
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ settings: DEFAULT_COMMUNITY_SETTINGS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<CommunitySettings>;
    await saveSettings(getWorkspaceId(), body);
    const updated = await loadSettings(getWorkspaceId());
    return NextResponse.json({ ok: true, settings: updated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Ukjent feil' }, { status: 500 });
  }
}
