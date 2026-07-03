import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ─── GET: Twitch integration details with live token validation ───────────────

export async function GET() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  const userId      = h.get('x-user-id');

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });

  let ws: Record<string, unknown> | null = null;

  if (workspaceId) {
    const { data } = await db
      .from('workspaces')
      .select('id,twitch_user_id,twitch_login,twitch_display_name,twitch_profile_image,twitch_access_token,twitch_refresh_token,twitch_connected_at')
      .eq('id', workspaceId)
      .maybeSingle();
    ws = data as Record<string, unknown> | null;
  } else if (userId) {
    const { data } = await db
      .from('workspaces')
      .select('id,twitch_user_id,twitch_login,twitch_display_name,twitch_profile_image,twitch_access_token,twitch_refresh_token,twitch_connected_at')
      .eq('owner_user_id', userId)
      .limit(1)
      .maybeSingle();
    ws = data as Record<string, unknown> | null;
  }

  if (!ws) {
    return NextResponse.json({ connected: false, reason: 'no_workspace', workspaceId });
  }

  const accessToken = ws.twitch_access_token as string | null;

  if (!accessToken) {
    return NextResponse.json({
      connected:       false,
      reason:          'no_token',
      workspaceId:     ws.id,
      twitchUserId:    ws.twitch_user_id ?? null,
      twitchLogin:     null,
      twitchName:      null,
      connectedAt:     ws.twitch_connected_at ?? null,
      hasRefreshToken: !!(ws.twitch_refresh_token),
      scopes:          [],
      tokenValid:      false,
    });
  }

  // Live-validate token with Twitch
  const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!validateRes?.ok) {
    return NextResponse.json({
      connected:       false,
      reason:          'token_expired',
      workspaceId:     ws.id,
      twitchUserId:    ws.twitch_user_id ?? null,
      twitchLogin:     ws.twitch_login   ?? null,
      twitchName:      ws.twitch_display_name ?? null,
      connectedAt:     ws.twitch_connected_at ?? null,
      hasRefreshToken: !!(ws.twitch_refresh_token),
      scopes:          [],
      tokenValid:      false,
    });
  }

  const validation = await validateRes.json() as {
    login: string; user_id: string; scopes: string[]; expires_in: number;
  };

  return NextResponse.json({
    connected:       true,
    tokenValid:      true,
    workspaceId:     ws.id,
    twitchUserId:    ws.twitch_user_id    ?? validation.user_id,
    twitchLogin:     ws.twitch_login      ?? validation.login,
    twitchName:      ws.twitch_display_name ?? null,
    connectedAt:     ws.twitch_connected_at ?? null,
    hasRefreshToken: !!(ws.twitch_refresh_token),
    scopes:          validation.scopes ?? [],
    expiresIn:       validation.expires_in,
    liveLogin:       validation.login,
    liveUserId:      validation.user_id,
  });
}

// ─── DELETE: Disconnect Twitch — clears all Twitch fields from workspace ──────

export async function DELETE() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  const userId      = h.get('x-user-id');

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });

  let wsId: string | null = null;

  if (workspaceId) {
    const { data } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle();
    wsId = (data?.id as string | null) ?? null;
  } else if (userId) {
    const { data } = await db
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', userId)
      .limit(1)
      .maybeSingle();
    wsId = (data?.id as string | null) ?? null;
  }

  if (!wsId) {
    return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 });
  }

  const { error } = await db.from('workspaces').update({
    twitch_user_id:       null,
    twitch_login:         null,
    twitch_display_name:  null,
    twitch_profile_image: null,
    twitch_access_token:  null,
    twitch_refresh_token: null,
    twitch_connected_at:  null,
    twitch_channel_name:  null,
    onboarding_step:      1,
    updated_at:           new Date().toISOString(),
  }).eq('id', wsId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from('system_events').insert({
    workspace_id: wsId,
    source:       'integrations',
    event_type:   'TWITCH_DISCONNECTED',
    title:        'Twitch-integrasjon frakoblet',
    severity:     'info',
    metadata:     { disconnectedBy: userId ?? 'unknown', workspaceId: wsId },
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, workspaceId: wsId });
}
