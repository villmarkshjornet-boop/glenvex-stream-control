import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

// Decode Supabase JWT from cookies — pure Edge-compatible (no Supabase client, no Node.js APIs)
function getSessionFromCookies(request: NextRequest): { id: string; email: string; workspace_id: string } | null {
  try {
    const all = request.cookies.getAll();

    // Find any sb-*-auth-token cookie (handles project ref mismatch between env vars)
    const authCookie = all.find(c =>
      /^sb-.+-auth-token$/.test(c.name)
    );

    let tokenValue = authCookie?.value ?? '';

    // Try chunked cookies if no single cookie found
    if (!tokenValue) {
      const chunkCookie = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
      if (chunkCookie) {
        const base = chunkCookie.name.replace('.0', '');
        const chunks: string[] = [];
        for (let i = 0; i < 10; i++) {
          const chunk = request.cookies.get(`${base}.${i}`)?.value;
          if (!chunk) break;
          chunks.push(chunk);
        }
        tokenValue = chunks.join('');
      }
    }

    if (!tokenValue) return null;

    const session = JSON.parse(decodeURIComponent(tokenValue));
    const accessToken = session?.access_token;
    if (!accessToken) return null;

    // Decode JWT payload (base64url → JSON) — no crypto, just reading claims
    const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      typeof atob !== 'undefined'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf-8')
    );

    if (!payload.sub || !payload.exp || payload.exp < Date.now() / 1000) return null;

    return {
      id: payload.sub,
      email: payload.email ?? '',
      workspace_id: payload.user_metadata?.workspace_id ?? '',
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always pass through static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some(p => pathname.startsWith(p))
  ) {
    // If /login arrives with ?code= from Supabase magic link, forward to callback
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

  const session = getSessionFromCookies(request);

  // Not logged in → redirect to login
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Logged in but no workspace → onboarding (allow API calls from onboarding page through)
  if (!session.workspace_id && !pathname.startsWith('/onboarding') && !pathname.startsWith('/api/onboarding') && !pathname.startsWith('/api/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Inject workspace context into request headers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-workspace-id', session.workspace_id);
  requestHeaders.set('x-user-email', session.email);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-workspace-id', session.workspace_id);
  response.headers.set('x-pathname', pathname);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
