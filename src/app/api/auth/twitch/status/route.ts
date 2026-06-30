import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db  = getDb();
  const wsId = getWorkspaceId();

  if (!db) {
    return NextResponse.json({ connected: false, reason: 'db_unavailable' });
  }

  const { data: ws } = await db
    .from('workspaces')
    .select('twitch_access_token, twitch_refresh_token, twitch_user_id, twitch_login, twitch_display_name, twitch_connected_at')
    .eq('id', wsId)
    .single();

  if (!ws?.twitch_access_token) {
    return NextResponse.json({
      connected: false,
      reason:    'no_token',
      workspaceId: wsId,
      hasRefreshToken: !!ws?.twitch_refresh_token,
      twitchUserId:    ws?.twitch_user_id ?? null,
      twitchLogin:     ws?.twitch_login ?? null,
    });
  }

  // Validate token and get scopes from Twitch
  const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${ws.twitch_access_token}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!validateRes?.ok) {
    return NextResponse.json({
      connected:       false,
      reason:          'token_expired',
      workspaceId:     wsId,
      twitchUserId:    ws.twitch_user_id ?? null,
      twitchLogin:     ws.twitch_login ?? null,
      hasRefreshToken: !!ws.twitch_refresh_token,
      connectedAt:     ws.twitch_connected_at ?? null,
    });
  }

  const validation = await validateRes.json() as {
    client_id: string;
    login: string;
    user_id: string;
    scopes: string[];
    expires_in: number;
  };

  const scopes             = validation.scopes ?? [];
  const hasFollowerScope   = scopes.includes('moderator:read:followers');
  const hasSubScope        = scopes.includes('channel:read:subscriptions');

  return NextResponse.json({
    connected:       true,
    workspaceId:     wsId,
    twitchUserId:    ws.twitch_user_id ?? validation.user_id,
    twitchLogin:     ws.twitch_login ?? validation.login,
    twitchName:      ws.twitch_display_name ?? null,
    connectedAt:     ws.twitch_connected_at ?? null,
    scopes,
    hasFollowerScope,
    hasSubScope,
    expiresIn:       validation.expires_in,
  });
}
