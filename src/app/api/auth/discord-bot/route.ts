import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { encodeState } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

// Required env vars: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OAUTH_STATE_SECRET
// Optional: GLENVEX_OAUTH_BASE (central domain, defaults to NEXT_PUBLIC_BASE_URL)
// Register ONE redirect URI in Discord dev console: {GLENVEX_OAUTH_BASE}/api/auth/discord-bot/callback

// Permissions: SEND_MESSAGES | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY
// | MANAGE_MESSAGES | USE_APPLICATION_COMMANDS | MENTION_EVERYONE
const BOT_PERMISSIONS = '19456';

export async function GET(req: NextRequest) {
  const h = headers();
  const userId      = h.get('x-user-id');
  const workspaceId = h.get('x-workspace-id');

  const clientId    = process.env.DISCORD_CLIENT_ID;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  const centralBase = (
    process.env.GLENVEX_OAUTH_BASE ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    `https://${h.get('host') ?? 'app.glenvex.com'}`
  ).replace(/\/$/, '');

  if (!clientId)    return NextResponse.json({ error: 'DISCORD_CLIENT_ID ikke satt' }, { status: 500 });
  if (!stateSecret) return NextResponse.json({ error: 'OAUTH_STATE_SECRET ikke satt' }, { status: 500 });

  let wsId = workspaceId;
  if (!wsId && userId) {
    const db = getDb();
    if (db) {
      const { data } = await db.from('workspaces').select('id').eq('owner_user_id', userId).limit(1).single();
      wsId = data?.id ?? null;
    }
  }
  if (!wsId) return NextResponse.json({ error: 'Workspace ikke funnet — fullfør steg 1 først' }, { status: 400 });

  // returnUrl: where to send the customer after Discord auth (defaults to step 4)
  const returnUrl = req.nextUrl.searchParams.get('returnUrl') ?? '/onboarding?step=4';

  const { encoded, nonce } = encodeState(wsId, returnUrl, stateSecret);
  const redirectUri = `${centralBase}/api/auth/discord-bot/callback`;

  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'bot identify guilds');
  url.searchParams.set('permissions', BOT_PERMISSIONS);
  url.searchParams.set('state', encoded);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('discord_oauth_nonce', nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  });
  return response;
}
