import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { encodeState } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

// Required env vars: TWITCH_CLIENT_ID, OAUTH_STATE_SECRET, GLENVEX_OAUTH_BASE
// Register ONE redirect URI in Twitch dev console: {GLENVEX_OAUTH_BASE}/api/auth/twitch/callback

export async function GET(req: NextRequest) {
  const h = headers();
  const userId      = h.get('x-user-id');
  const workspaceId = h.get('x-workspace-id');

  const clientId    = process.env.TWITCH_CLIENT_ID;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  // Never fall back to the request host — redirect_uri must be the registered central domain
  const centralBase = (process.env.GLENVEX_OAUTH_BASE ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

  if (!clientId)    return NextResponse.json({ error: 'TWITCH_CLIENT_ID ikke satt' }, { status: 500 });
  if (!stateSecret) return NextResponse.json({ error: 'OAUTH_STATE_SECRET ikke satt' }, { status: 500 });
  if (!centralBase) return NextResponse.json({ error: 'GLENVEX_OAUTH_BASE ikke satt' }, { status: 500 });

  let wsId = workspaceId;
  if (!wsId && userId) {
    const db = getDb();
    if (db) {
      const { data } = await db.from('workspaces').select('id').eq('owner_user_id', userId).limit(1).single();
      wsId = data?.id ?? null;
    }
  }
  if (!wsId) return NextResponse.json({ error: 'Workspace ikke funnet — fullfør steg 1 først' }, { status: 400 });

  const returnUrl   = req.nextUrl.searchParams.get('returnUrl') ?? '/onboarding?step=3';
  const { encoded, nonce } = encodeState(wsId, returnUrl, stateSecret);
  const redirectUri = `${centralBase}/api/auth/twitch/callback`;

  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user:read:email');
  url.searchParams.set('state', encoded);
  url.searchParams.set('force_verify', 'true');

  void getDb()?.from('system_events').insert({
    workspace_id: wsId,
    source:       'onboarding',
    event_type:   'OAUTH_TWITCH_STARTED',
    title:        'Twitch OAuth påbegynt',
    severity:     'info',
    metadata:     { redirectUri, returnUrl },
  });

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('twitch_oauth_nonce', nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  });
  return response;
}
