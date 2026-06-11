import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Required env vars: TWITCH_CLIENT_ID, NEXT_PUBLIC_BASE_URL
// Register redirect URI in Twitch dev console: {NEXT_PUBLIC_BASE_URL}/api/auth/twitch/callback

export async function GET() {
  const h = headers();
  const userId      = h.get('x-user-id');
  const workspaceId = h.get('x-workspace-id');

  const clientId = process.env.TWITCH_CLIENT_ID;
  const host     = h.get('host') ?? '';
  const proto    = host.startsWith('localhost') ? 'http' : 'https';
  const baseUrl  = (process.env.NEXT_PUBLIC_BASE_URL ?? `${proto}://${host}`).replace(/\/$/, '');

  if (!clientId) return NextResponse.json({ error: 'TWITCH_CLIENT_ID ikke satt' }, { status: 500 });
  if (!baseUrl)  return NextResponse.json({ error: 'NEXT_PUBLIC_BASE_URL ikke satt' }, { status: 500 });

  // Prefer workspace from JWT; fall back to looking it up by owner if onboarding is in progress
  let wsId = workspaceId;
  if (!wsId && userId) {
    const db = getDb();
    if (db) {
      const { data } = await db.from('workspaces').select('id').eq('owner_user_id', userId).limit(1).single();
      wsId = data?.id ?? null;
    }
  }
  if (!wsId) return NextResponse.json({ error: 'Workspace ikke funnet — fullfør steg 1 først' }, { status: 400 });

  const nonce       = randomBytes(16).toString('hex');
  const statePayload = Buffer.from(JSON.stringify({ wsId, nonce })).toString('base64url');

  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${baseUrl}/api/auth/twitch/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user:read:email');
  url.searchParams.set('state', statePayload);
  url.searchParams.set('force_verify', 'true');

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('twitch_oauth_nonce', nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  });
  return response;
}
