import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export interface CommunityCardSettings {
  discordCardDropChannelEnabled:       boolean;
  discordCardDropChannelId:            string | null;
  discordCardDropDmEnabled:            boolean;
  twitchCardDropNotificationsEnabled:  boolean;
}

const DEFAULTS: CommunityCardSettings = {
  discordCardDropChannelEnabled:      false,
  discordCardDropChannelId:           null,
  discordCardDropDmEnabled:           true,
  twitchCardDropNotificationsEnabled: false,
};

async function load(wsId: string): Promise<CommunityCardSettings> {
  const db = getDb();
  if (!db) return DEFAULTS;
  const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const sj = (data as any)?.settings_json ?? {};
  return { ...DEFAULTS, ...(sj.communityCardSettings ?? {}) };
}

export async function GET() {
  const settings = await load(getWorkspaceId());
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const wsId = getWorkspaceId();
  const db   = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB ikke tilgjengelig' }, { status: 500 });

  const body    = await req.json();
  const current = await load(wsId);
  const merged  = { ...current, ...body } as CommunityCardSettings;

  const { data: wsRow } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const existingSj = (wsRow as any)?.settings_json ?? {};

  await db.from('workspaces').update({
    settings_json: { ...existingSj, communityCardSettings: merged },
  }).eq('id', wsId);

  return NextResponse.json({ ok: true, settings: merged });
}
