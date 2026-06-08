import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];
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
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
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

  if (!session || !cookieName) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  let claims = decodeJwtClaims(session.access_token);
  let refreshedSession: StoredSession | null = null;

  // JWT expired — try to silently refresh using refresh_token
  if (!claims || claims.exp < Date.now() / 1000) {
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
  }

  if (
    !claims.workspace_id &&
    !pathname.startsWith('/onboarding') &&
    !pathname.startsWith('/api/onboarding') &&
    !pathname.startsWith('/api/auth')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-workspace-id', claims.workspace_id);
  requestHeaders.set('x-user-email', claims.email);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-workspace-id', claims.workspace_id);
  response.headers.set('x-pathname', pathname);

  // Write refreshed session back as cookie so next request is instant
  if (refreshedSession) {
    response.cookies.set(
      cookieName,
      encodeURIComponent(JSON.stringify(refreshedSession)),
      { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE }
    );
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
