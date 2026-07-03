import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/discord/role-sync
 * Returns current role sync config and bot permission status from system_events.
 */
export async function GET() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });

  // Load current role sync settings from workspace settings_json
  const { data: ws } = await db
    .from('workspaces')
    .select('settings_json, discord_guild_id')
    .eq('id', workspaceId)
    .maybeSingle();

  const communitySettings = (ws?.settings_json as any)?.communitySettings ?? {};
  const rankRoles  = communitySettings.rankRoles  ?? {};
  const badgeRoles = communitySettings.badgeRoles ?? {};

  // Read latest permission check result from system_events
  const { data: permEvent } = await db
    .from('system_events')
    .select('metadata, created_at')
    .eq('workspace_id', workspaceId)
    .in('event_type', ['ROLE_SYNC_PERMISSION_DENIED', 'RANK_ROLE_SYNCED', 'ROLE_SYNC_REPAIR_COMPLETE'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastSyncAt    = permEvent?.created_at ?? null;
  const hasPermError  = (permEvent as any)?.event_type === 'ROLE_SYNC_PERMISSION_DENIED';

  return NextResponse.json({
    rankRoles,
    badgeRoles,
    guildId:     ws?.discord_guild_id ?? null,
    lastSyncAt,
    hasPermError,
  });
}

/**
 * POST /api/discord/role-sync
 * Saves rank/badge role ID mappings to workspace settings_json.communitySettings.
 */
export async function POST(req: NextRequest) {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });

  const body = await req.json() as { rankRoles?: Record<string, string>; badgeRoles?: Record<string, string> };
  const { rankRoles = {}, badgeRoles = {} } = body;

  // Load existing settings_json to merge
  const { data: ws } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', workspaceId)
    .maybeSingle();

  const existing      = (ws?.settings_json as Record<string, unknown>) ?? {};
  const communityExisting = (existing.communitySettings as Record<string, unknown>) ?? {};

  const updated = {
    ...existing,
    communitySettings: {
      ...communityExisting,
      rankRoles:  { ...(communityExisting.rankRoles  as object ?? {}), ...rankRoles  },
      badgeRoles: { ...(communityExisting.badgeRoles as object ?? {}), ...badgeRoles },
    },
  };

  const { error } = await db
    .from('workspaces')
    .update({ settings_json: updated, updated_at: new Date().toISOString() })
    .eq('id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'dashboard',
    event_type:   'ROLE_SYNC_CONFIG_SAVED',
    title:        'Discord Role Sync konfigurasjon lagret',
    severity:     'info',
    metadata:     { rankRoles, badgeRoles, savedBy: h.get('x-user-id') ?? 'unknown' },
  }).then(null, () => {});

  return NextResponse.json({ ok: true });
}
