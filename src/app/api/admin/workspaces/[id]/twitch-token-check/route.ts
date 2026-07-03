import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

/**
 * POST /api/admin/workspaces/[id]/twitch-token-check
 *
 * Validates the Twitch OAuth tokens stored for a workspace:
 * 1. Checks that tokens exist in DB
 * 2. Calls Twitch /oauth2/validate to confirm not expired
 * 3. Verifies that the token's login matches the stored twitch_login
 *
 * Returns a detailed diagnosis — no tokens are exposed in the response.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const workspaceId = params.id;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .select('id,twitch_login,twitch_user_id,twitch_connected_at,twitch_access_token,twitch_refresh_token')
    .eq('id', workspaceId)
    .single();

  if (wsErr || !ws) {
    return NextResponse.json({ ok: false, error: 'Workspace ikke funnet' }, { status: 404 });
  }

  const hasAccessToken  = !!ws.twitch_access_token;
  const hasRefreshToken = !!ws.twitch_refresh_token;

  if (!hasAccessToken) {
    return NextResponse.json({
      ok:              false,
      status:          'no_token',
      hasAccessToken,
      hasRefreshToken,
      storedLogin:     ws.twitch_login ?? null,
      connectedAt:     ws.twitch_connected_at ?? null,
      diagnosis:       'Ingen access token lagret i databasen. Brukeren må koble til Twitch på nytt.',
      action:          'reconnect',
    });
  }

  interface TwitchValidation {
    login: string;
    user_id: string;
    expires_in: number;
    scopes: string[];
  }

  // Validate token against Twitch
  let validation: TwitchValidation | null = null;
  let tokenValid = false;
  let validateError: string | null = null;

  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${ws.twitch_access_token}` },
      signal: AbortSignal.timeout(6000),
    });

    if (validateRes.ok) {
      validation = await validateRes.json() as TwitchValidation;
      tokenValid = true;
    } else if (validateRes.status === 401) {
      validateError = 'token_expired';
    } else {
      validateError = `twitch_http_${validateRes.status}`;
    }
  } catch (err: unknown) {
    validateError = err instanceof Error ? err.message : 'network_timeout';
  }

  // Check login mismatch
  const storedLogin  = ws.twitch_login ?? null;
  const tokenLogin   = validation?.login ?? null;
  const loginMismatch = tokenValid && storedLogin && tokenLogin && storedLogin !== tokenLogin;

  let diagnosis: string;
  let action: 'ok' | 'reconnect' | 'mismatch' | 'expired';

  if (!tokenValid && validateError === 'token_expired') {
    if (hasRefreshToken) {
      diagnosis = 'Access token er utløpt. Refresh token finnes — systemet vil forsøke å fornye automatisk neste API-kall. Klikk "Koble til på nytt" for å tvinge ny autorisasjon.';
    } else {
      diagnosis = 'Access token er utløpt og det finnes ingen refresh token. Brukeren MÅ koble til Twitch på nytt.';
    }
    action = 'expired';
  } else if (!tokenValid) {
    diagnosis = `Token-validering feilet (${validateError ?? 'ukjent feil'}). Prøv igjen eller klikk "Koble til på nytt".`;
    action = 'reconnect';
  } else if (loginMismatch) {
    diagnosis = `Token tilhører @${tokenLogin} men workspace er registrert som @${storedLogin}. workspace_id kan tilhøre feil Twitch-konto — koble til på nytt.`;
    action = 'mismatch';
  } else {
    diagnosis = `Token er gyldig for @${tokenLogin ?? storedLogin}. Utløper om ${Math.round((validation?.expires_in ?? 0) / 3600)}t.`;
    action = 'ok';
  }

  return NextResponse.json({
    ok:              action === 'ok',
    status:          action,
    hasAccessToken,
    hasRefreshToken,
    tokenValid,
    storedLogin,
    tokenLogin,
    loginMismatch:   !!loginMismatch,
    connectedAt:     ws.twitch_connected_at ?? null,
    expiresInSeconds: validation?.expires_in ?? null,
    scopes:          validation?.scopes ?? null,
    diagnosis,
    action,
  });
}
