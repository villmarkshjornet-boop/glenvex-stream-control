import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { decodeState, safeReturnUrl } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const fallbackUrl = `${origin}/onboarding`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_cancelled`);
  }

  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!stateSecret) {
    console.error('[twitch/callback] OAUTH_STATE_SECRET ikke satt');
    return NextResponse.redirect(`${fallbackUrl}?error=server_config`);
  }

  // Never use request origin as redirect_uri — must match what's registered in Twitch dev console
  const centralBase = (process.env.GLENVEX_OAUTH_BASE ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (!centralBase) {
    console.error('[twitch/callback] GLENVEX_OAUTH_BASE ikke satt');
    return NextResponse.redirect(`${fallbackUrl}?error=server_config`);
  }

  const decoded = decodeState(state, stateSecret);
  if (!decoded.ok) {
    console.error('[twitch/callback] state decode failed:', decoded.error);
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_state_${decoded.error}`);
  }

  const { wsId, ret, nonce } = decoded.state;
  const db = getDb();

  const logFailed = (reason: string, extra?: Record<string, unknown>) => {
    void db?.from('system_events').insert({
      workspace_id: wsId,
      source:       'onboarding',
      event_type:   'OAUTH_FAILED',
      title:        `Twitch OAuth mislyktes: ${reason}`,
      severity:     'warning',
      metadata:     { reason, provider: 'twitch', ...extra },
    });
  };

  // CSRF check: nonce in HMAC-signed state must match cookie
  const storedNonce = req.cookies.get('twitch_oauth_nonce')?.value;
  if (!storedNonce || storedNonce !== nonce) {
    logFailed('nonce_mismatch');
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_state_mismatch`);
  }

  const clientId     = process.env.TWITCH_CLIENT_ID ?? '';
  const clientSecret = process.env.TWITCH_CLIENT_SECRET ?? '';

  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  `${centralBase}/api/auth/twitch/callback`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error('[twitch/callback] token exchange failed:', tokenRes.status, body);
    logFailed('token_exchange_failed', { httpStatus: tokenRes.status });
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_token_failed`);
  }

  const tokens = await tokenRes.json() as {
    access_token: string; refresh_token: string; scope: string; token_type: string;
  };

  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Client-Id':   clientId,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!userRes.ok) {
    logFailed('user_fetch_failed', { httpStatus: userRes.status });
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_user_failed`);
  }

  const userData = await userRes.json() as { data: Array<{
    id: string; login: string; display_name: string; profile_image_url: string; email?: string;
  }> };
  const twitchUser = userData.data[0];
  if (!twitchUser) {
    logFailed('no_user_in_response');
    return NextResponse.redirect(`${fallbackUrl}?error=twitch_no_user`);
  }

  if (!db) return NextResponse.redirect(`${fallbackUrl}?error=db_unavailable`);

  // Verify workspace exists before updating — Supabase .update().eq() returns error:null even on 0-row matches
  const { data: wsCheck } = await db.from('workspaces').select('id').eq('id', wsId).single();
  if (!wsCheck) {
    logFailed('workspace_not_found', { wsId });
    return NextResponse.redirect(
      `${fallbackUrl}?step=1&error=workspace_ikke_funnet&source=twitch_callback&wsId=${encodeURIComponent(wsId)}&hasMetadataWorkspaceId=unknown&dbWorkspaceFound=false`
    );
  }

  const { data: updatedRows, error: dbErr } = await db.from('workspaces').update({
    twitch_user_id:       twitchUser.id,
    twitch_login:         twitchUser.login,
    twitch_display_name:  twitchUser.display_name,
    twitch_profile_image: twitchUser.profile_image_url,
    twitch_access_token:  tokens.access_token,
    twitch_refresh_token: tokens.refresh_token,
    twitch_connected_at:  new Date().toISOString(),
    streamer_name:        twitchUser.login,
    twitch_channel_name:  twitchUser.login,
    onboarding_step:      2,
    updated_at:           new Date().toISOString(),
  }).eq('id', wsId).select('id');

  if (dbErr || !updatedRows?.length) {
    console.error('[twitch/callback] db update failed:', dbErr?.message ?? `0 rows updated for wsId=${wsId}`);
    logFailed('db_save_failed', { dbMessage: dbErr?.message ?? 'update matched 0 rows', wsId });
    return NextResponse.redirect(`${fallbackUrl}?error=db_save_failed`);
  }

  try { await db.from('system_events').insert({
    workspace_id: wsId,
    source:       'onboarding',
    event_type:   'OAUTH_TWITCH_CONNECTED',
    title:        `Twitch tilkoblet: ${twitchUser.display_name} (${twitchUser.login})`,
    severity:     'info',
    metadata:     { twitchUserId: twitchUser.id, login: twitchUser.login, displayName: twitchUser.display_name },
  }); } catch {}

  const redirectTo = safeReturnUrl(ret, `${fallbackUrl}?step=3`);
  const response = NextResponse.redirect(
    redirectTo.startsWith('/') ? `${origin}${redirectTo}` : redirectTo
  );
  response.cookies.delete('twitch_oauth_nonce');
  return response;
}
