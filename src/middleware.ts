import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth',
  '/api/cron',
  '/api/backfill',
  '/api/admin/run-migration',
  '/overlay',        // OBS browser sources — ingen session
  '/api/goals/live', // read-only public goal data (brukes av overlay)
];
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dager

interface StoredSession {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface UserClaims {
  id: string;
  email: string;
  workspace_id: string;
  alpha_enabled?: boolean;
  exp: number;
}

// ─── Parse stored session from cookie ────────────────────────────────────────
function parseCookieSession(request: NextRequest): {
  session: StoredSession | null;
  cookieName: string | null;
} {
  const all = request.cookies.getAll();
  let tokenValue = '';
  let cookieName: string | null = null;

  const authCookie = all.find(c => /^sb-.+-auth-token$/.test(c.name));
  if (authCookie) {
    tokenValue = authCookie.value;
    cookieName = authCookie.name;
  }

  if (!tokenValue) {
    const chunkCookie = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
    if (chunkCookie) {
      const base = chunkCookie.name.replace('.0', '');
      cookieName = base;
      const chunks: string[] = [];
      for (let i = 0; i < 10; i++) {
        const chunk = request.cookies.get(`${base}.${i}`)?.value;
        if (!chunk) break;
        chunks.push(chunk);
      }
      tokenValue = chunks.join('');
    }
  }

  if (!tokenValue) return { session: null, cookieName: null };

  try {
    const session = JSON.parse(decodeURIComponent(tokenValue)) as StoredSession;
    return { session, cookieName };
  } catch {
    return { session: null, cookieName: null };
  }
}

// ─── Decode JWT claims without crypto ────────────────────────────────────────
function decodeJwtClaims(accessToken: string): UserClaims | null {
  try {
    const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      typeof atob !== 'undefined'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf-8')
    );
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: payload.email ?? '',
      workspace_id: payload.user_metadata?.workspace_id ?? '',
      alpha_enabled: payload.user_metadata?.alpha_enabled,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Verify JWT cryptographically ────────────────────────────────────────────
//
// Strategy (two-tier, fastest path first):
//
// 1. LOCAL — HMAC-SHA256 with SUPABASE_JWT_SECRET via Web Crypto API.
//    No network call, no latency, works when Supabase is down.
//    Available when SUPABASE_JWT_SECRET env var is set (recommended).
//
// 2. REMOTE — Supabase /auth/v1/user endpoint.
//    Fallback when secret is not configured. 8 s hard timeout via Promise.race.
//
// Returns:
//   { id, email, workspace_id, alpha_enabled } — token is cryptographically valid
//   'invalid'  — signature does not match (forged payload or revoked)
//   null       — verification unavailable (no secret + network failure/timeout)

type VerifyResult = { id: string; email: string; workspace_id: string; alpha_enabled?: boolean } | 'invalid' | null;

async function verifyJwtLocally(token: string): Promise<VerifyResult> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null; // secret not configured — try remote fallback

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 'invalid';

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (header.alg !== 'HS256') return null; // only handle HS256 locally; RS256 needs remote

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigB64  = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const sigPad  = sigB64 + '='.repeat((4 - sigB64.length % 4) % 4);
    const sigBytes = Uint8Array.from(atob(sigPad), c => c.charCodeAt(0));
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, dataBytes);
    if (!valid) return 'invalid';

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.sub) return 'invalid';
    if (payload.exp && payload.exp < Date.now() / 1000) return 'invalid';

    return {
      id:            payload.sub,
      email:         payload.email ?? '',
      workspace_id:  payload.user_metadata?.workspace_id ?? '',
      alpha_enabled: payload.user_metadata?.alpha_enabled as boolean | undefined,
    };
  } catch {
    return null;
  }
}

async function verifyJwtRemote(accessToken: string): Promise<VerifyResult> {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.warn('[SECURITY] verifyJwtRemote: missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
    return null;
  }

  const timeout  = new Promise<null>(resolve => setTimeout(() => resolve(null), 8000));
  const call = (async (): Promise<VerifyResult> => {
    try {
      const supabase = createServerClient(url, anonKey, {
        cookies: { getAll: () => [], setAll: () => {} },
      });
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      if (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (status === 401 || status === 403) return 'invalid';
        return null;
      }
      if (!user) return 'invalid';
      return {
        id:            user.id,
        email:         user.email ?? '',
        workspace_id:  user.user_metadata?.workspace_id ?? '',
        alpha_enabled: user.user_metadata?.alpha_enabled as boolean | undefined,
      };
    } catch {
      return null;
    }
  })();

  return Promise.race([call, timeout]);
}

async function verifyJwt(accessToken: string): Promise<VerifyResult> {
  const local = await verifyJwtLocally(accessToken);
  if (local !== null) return local; // local gave a definitive answer (valid OR invalid)
  // Local unavailable (no SUPABASE_JWT_SECRET) — try remote
  return verifyJwtRemote(accessToken);
}

// ─── Refresh access token via Supabase REST ───────────────────────────────────
async function refreshAccessToken(refreshToken: string): Promise<StoredSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(8000), // 8s timeout — avoid hanging edge functions
    });
    if (!res.ok) return null;
    return await res.json() as StoredSession;
  } catch {
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some(p => pathname.startsWith(p))
  ) {
    if (pathname === '/login') {
      const code = request.nextUrl.searchParams.get('code');
      if (code) {
        const url = request.nextUrl.clone();
        url.pathname = '/api/auth/callback';
        return NextResponse.redirect(url);
      }
    }
    const res = NextResponse.next({ request });
    res.headers.set('x-pathname', pathname);
    return res;
  }

  const { session, cookieName } = parseCookieSession(request);
  const isApiRoute = pathname.startsWith('/api/');

  if (!session || !cookieName) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized', code: 'NO_SESSION' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  let claims = decodeJwtClaims(session.access_token);
  let refreshedSession: StoredSession | null = null;
  const nowSec = Date.now() / 1000;

  if (!claims || claims.exp < nowSec) {
    // Token definitively expired
    if (isApiRoute) {
      // Never redirect API routes — race-condition-safe 401 so caller can handle gracefully
      return NextResponse.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 });
    }
    if (!session.refresh_token) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    refreshedSession = await refreshAccessToken(session.refresh_token);
    if (!refreshedSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    claims = decodeJwtClaims(refreshedSession.access_token);
    if (!claims) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  } else if (!isApiRoute && claims.exp < nowSec + 5 * 60) {
    // Token expiring within 5 minutes — proactively refresh on page navigation only
    // Skipping API routes avoids the parallel-request race condition that kicks users to login
    if (session.refresh_token) {
      refreshedSession = await refreshAccessToken(session.refresh_token);
      if (refreshedSession) {
        claims = decodeJwtClaims(refreshedSession.access_token) ?? claims;
      }
    }
  }

  const isOnboardingPath = pathname.startsWith('/onboarding') || pathname.startsWith('/api/onboarding') || pathname.startsWith('/api/auth');
  const isWaitingPath    = pathname.startsWith('/waiting');
  const isAdminPath      = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

  if (!claims.workspace_id && !isOnboardingPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Alpha gate: alpha_enabled === false means the workspace is on the waiting list.
  // undefined/true means allowed (preserves access for existing users without the flag).
  // JWT claims are cached — if admin just enabled access the DB is authoritative.
  // We do one fast REST check and force-refresh the token so the user gets through
  // without having to log out and back in.
  if (
    claims.workspace_id &&
    claims.alpha_enabled === false &&
    !isWaitingPath &&
    !isOnboardingPath &&
    !isAdminPath
  ) {
    let dbAlphaEnabled = false;
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (sbUrl && sbKey) {
      try {
        const checkRes = await fetch(
          `${sbUrl}/rest/v1/workspaces?id=eq.${encodeURIComponent(claims.workspace_id)}&select=alpha_enabled&limit=1`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, signal: AbortSignal.timeout(3000) },
        );
        if (checkRes.ok) {
          const rows = await checkRes.json() as { alpha_enabled: boolean }[];
          dbAlphaEnabled = rows?.[0]?.alpha_enabled === true;
        }
      } catch {}
    }
    if (!dbAlphaEnabled) {
      const url = request.nextUrl.clone();
      url.pathname = '/waiting';
      return NextResponse.redirect(url);
    }
    // Admin has since enabled access — force a token refresh so the JWT claim updates.
    if (session.refresh_token && !refreshedSession) {
      refreshedSession = await refreshAccessToken(session.refresh_token);
      if (refreshedSession) claims = decodeJwtClaims(refreshedSession.access_token) ?? claims;
    }
  }

  // ─── Cryptographic JWT verification ─────────────────────────────────────────
  // Skip for freshly-refreshed tokens: those are server-issued by Supabase and
  // cannot be tampered. For all other tokens (hot-path), verify the signature so
  // workspace_id cannot be forged by editing the JWT payload.
  //
  // Public/overlay/cron paths are already returned above — every request that
  // reaches this point is a private route.
  if (!refreshedSession) {
    // Debug: log what we're about to verify (no token values)
    console.log(`[SECURITY-DEBUG] ${pathname} | hasAccessToken=${!!session.access_token} hasRefreshToken=${!!session.refresh_token} hasJwtSecret=${!!process.env.SUPABASE_JWT_SECRET}`);

    const verifyResult = await verifyJwt(session.access_token);

    console.log(`[SECURITY-DEBUG] ${pathname} | verifyResult=${verifyResult === null ? 'null(unavailable)' : verifyResult === 'invalid' ? 'invalid' : `ok:${verifyResult.workspace_id || '(empty)'}`}`);

    if (verifyResult === 'invalid') {
      // Signature mismatch — token was forged or is revoked
      console.warn(`[SECURITY] JWT rejected (invalid signature or revoked) — blocking ${pathname}`);
      if (isApiRoute) {
        return NextResponse.json({ error: 'Invalid token', code: 'INVALID_TOKEN' }, { status: 401 });
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }

    if (verifyResult === null) {
      // Both local and remote verification unavailable.
      // Fail closed for API routes. For page routes, return a 503 inline —
      // do NOT redirect to /login, as that creates an infinite redirect loop
      // (login is public, dashboard requires auth, middleware redirects back to login).
      console.warn(`[SECURITY] JWT verification unavailable (no SUPABASE_JWT_SECRET + Supabase unreachable/timeout) — fail closed: ${pathname}`);
      if (isApiRoute) {
        return NextResponse.json(
          { error: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' },
          { status: 503 },
        );
      }
      return new NextResponse(
        `<!doctype html><html lang="no"><head><meta charset="utf-8"><title>Midlertidig utilgjengelig</title>
         <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#e2e8f0}
         .box{text-align:center;max-width:420px}.title{font-size:1.4rem;margin-bottom:.75rem;color:#9b77cf}
         .desc{color:#94a3b8;line-height:1.6}.btn{margin-top:1.5rem;display:inline-block;padding:.65rem 1.4rem;background:#9b77cf;color:#fff;border-radius:.5rem;text-decoration:none;font-weight:600}</style>
         </head><body><div class="box"><div class="title">⚠ Midlertidig utilgjengelig</div>
         <p class="desc">Autentiseringstjenesten er midlertidig utilgjengelig. Prøv igjen om noen sekunder.</p>
         <a href="${pathname}" class="btn">Prøv igjen</a></div></body></html>`,
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '15' } },
      );
    }

    // Cryptographically-verified identity — overwrite base64-decoded values
    claims.id            = verifyResult.id;
    claims.email         = verifyResult.email;
    claims.workspace_id  = verifyResult.workspace_id;
    claims.alpha_enabled = verifyResult.alpha_enabled;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-workspace-id', claims.workspace_id);
  requestHeaders.set('x-user-id', claims.id);
  requestHeaders.set('x-user-email', claims.email);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-workspace-id', claims.workspace_id);
  response.headers.set('x-user-id', claims.id);
  response.headers.set('x-pathname', pathname);

  // Write refreshed session back as cookie so next request is instant
  if (refreshedSession) {
    const encoded = encodeURIComponent(JSON.stringify(refreshedSession));
    const CHUNK_SIZE = 3500; // stay well under 4096 browser limit
    if (encoded.length <= CHUNK_SIZE) {
      // Single cookie — also delete any stale chunks from previous chunked write
      response.cookies.set(cookieName, encoded,
        { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE });
      for (let i = 0; i < 5; i++) {
        response.cookies.set(`${cookieName}.${i}`, '',
          { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
      }
    } else {
      // Chunked write — delete the base cookie and write chunks
      response.cookies.set(cookieName, '',
        { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        chunks.push(encoded.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        response.cookies.set(`${cookieName}.${i}`, chunks[i],
          { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE });
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
