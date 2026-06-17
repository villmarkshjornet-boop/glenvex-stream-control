import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { encodeState } from '@/lib/oauthState';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Required env vars: TWITCH_CLIENT_ID, OAUTH_STATE_SECRET, GLENVEX_OAUTH_BASE
// Register ONE redirect URI in Twitch dev console: {GLENVEX_OAUTH_BASE}/api/auth/twitch/callback

export async function GET(req: NextRequest) {
  const h = headers();
  const userId              = h.get('x-user-id');
  const metadataWorkspaceId = h.get('x-workspace-id'); // JWT user_metadata.workspace_id

  const clientId    = process.env.TWITCH_CLIENT_ID;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  // Never fall back to the request host — redirect_uri must be the registered central domain
  const centralBase = (process.env.GLENVEX_OAUTH_BASE ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

  if (!clientId)    return NextResponse.json({ error: 'TWITCH_CLIENT_ID ikke satt' }, { status: 500 });
  if (!stateSecret) return NextResponse.json({ error: 'OAUTH_STATE_SECRET ikke satt' }, { status: 500 });
  if (!centralBase) return NextResponse.json({ error: 'GLENVEX_OAUTH_BASE ikke satt' }, { status: 500 });

  const db = getDb();
  const hasMetadataWorkspaceId = !!metadataWorkspaceId;
  let wsId: string | null = null;
  let dbWorkspaceFound = false;
  let syncedMetadata = false;

  // Step 1: JWT workspace_id — verify it exists AND belongs to this user
  if (metadataWorkspaceId && userId && db) {
    const { data } = await db
      .from('workspaces')
      .select('id, owner_user_id')
      .eq('id', metadataWorkspaceId)
      .single();

    if (data?.owner_user_id === userId) {
      wsId = data.id;
      dbWorkspaceFound = true;
    }
    // If null or owner mismatch: fall through to step 2
  }

  // Step 2: Fallback — look up workspace by owner_user_id
  if (!wsId && userId && db) {
    const { data } = await db
      .from('workspaces')
      .select('id, owner_user_id')
      .eq('owner_user_id', userId)
      .limit(1)
      .single();

    if (data) {
      wsId = data.id;
      dbWorkspaceFound = true;

      // Self-heal: JWT had wrong or missing workspace_id — sync it back so next request is fast
      if (wsId !== metadataWorkspaceId) {
        const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
        if (sbUrl && sbKey) {
          const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
          void admin.auth.admin.updateUserById(userId, {
            user_metadata: { workspace_id: wsId },
          }).catch(() => {});
          syncedMetadata = true;
        }
      }
    }
  }

  if (!wsId) {
    const url = req.nextUrl.clone();
    url.pathname = '/onboarding';
    url.searchParams.set('step', '1');
    url.searchParams.set('error', 'workspace_ikke_funnet');
    url.searchParams.set('source', 'auth_twitch_start');
    if (userId) url.searchParams.set('userId', userId);
    url.searchParams.set('hasMetadataWorkspaceId', String(hasMetadataWorkspaceId));
    url.searchParams.set('dbWorkspaceFound', 'false');
    void db?.from('system_events').insert({
      workspace_id: null,
      source:       'onboarding',
      event_type:   'OAUTH_TWITCH_WORKSPACE_MISSING',
      title:        `Twitch OAuth stoppet — ingen workspace funnet for bruker`,
      severity:     'warning',
      metadata:     { userId, hasMetadataWorkspaceId, metadataWorkspaceId },
    });
    return NextResponse.redirect(url);
  }

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

  void db?.from('system_events').insert({
    workspace_id: wsId,
    source:       'onboarding',
    event_type:   'OAUTH_TWITCH_STARTED',
    title:        'Twitch OAuth påbegynt',
    severity:     'info',
    metadata:     { redirectUri, returnUrl, hasMetadataWorkspaceId, syncedMetadata },
  });

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('twitch_oauth_nonce', nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  });
  return response;
}
