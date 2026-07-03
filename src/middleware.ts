/**
 * Next.js Edge Middleware — authentication + workspace routing.
 *
 * Session validation: @supabase/ssr createServerClient with request cookies.
 * getUser() calls Supabase /auth/v1/user, handles token refresh automatically,
 * and writes refreshed cookies back via setAll. No manual JWT parsing needed.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Paths that bypass auth entirely — matched with startsWith
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth',        // /api/auth/callback, /api/auth/twitch/*, login, logout
  '/api/cron',
  '/api/backfill',
  '/api/admin/run-migration',
  '/overlay',         // OBS Browser Source — no session
  '/api/goals/live',  // public read-only goal data used by overlay
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Static assets ────────────────────────────────────────────────────────────
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next({ request });
  }

  // ── Public paths ─────────────────────────────────────────────────────────────
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    // Handle Supabase OAuth code exchange routed through /login
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

  // ── Private path: validate session via Supabase SSR ──────────────────────────
  const sbUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const sbAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isApiRoute = pathname.startsWith('/api/');

  if (!sbUrl || !sbAnonKey) {
    console.error('[SECURITY] middleware: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
    if (isApiRoute) {
      return NextResponse.json({ error: 'Server configuration error', code: 'CONFIG_ERROR' }, { status: 500 });
    }
    return new NextResponse('Server configuration error — contact support.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Supabase SSR canonical pattern:
  // supabaseResponse is a mutable variable so setAll can replace it on token refresh.
  // IMPORTANT: return supabaseResponse (or finalResponse with its cookies copied)
  // so the refreshed cookies are written to the browser.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(sbUrl, sbAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to request (so subsequent reads in this middleware see new cookies)
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // Replace supabaseResponse so the refreshed cookies are sent to browser
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() validates the session server-side and refreshes expired tokens.
  // Do NOT use getSession() here — it doesn't revalidate on the server.
  const { data: { user } } = await supabase.auth.getUser();

  console.log(`[SECURITY-DEBUG] ${pathname} | public=false | hasUser=${!!user}`);

  if (!user) {
    console.log(`[SECURITY-DEBUG] ${pathname} | action=block | reason=no_valid_session`);
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized', code: 'NO_SESSION' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // ── Workspace & alpha gate ────────────────────────────────────────────────────
  const workspaceId  = (user.user_metadata?.workspace_id  as string | undefined) ?? '';
  const userId       = user.id;
  const userEmail    = user.email ?? '';
  const alphaEnabled = user.user_metadata?.alpha_enabled as boolean | undefined;

  const isOnboardingPath = pathname.startsWith('/onboarding')
    || pathname.startsWith('/api/onboarding')
    || pathname.startsWith('/api/auth');
  const isWaitingPath = pathname.startsWith('/waiting');
  const isAdminPath   = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

  if (!workspaceId && !isOnboardingPath) {
    console.log(`[SECURITY-DEBUG] ${pathname} | action=redirect_onboarding | reason=no_workspace_id`);
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Alpha gate: alpha_enabled === false → waiting list.
  // undefined/true means allowed (preserves access for older users without the flag).
  if (workspaceId && alphaEnabled === false && !isWaitingPath && !isOnboardingPath && !isAdminPath) {
    let dbAlphaEnabled = false;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (sbUrl && serviceKey) {
      try {
        const res = await fetch(
          `${sbUrl}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=alpha_enabled&limit=1`,
          {
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            signal: AbortSignal.timeout(3000),
          },
        );
        if (res.ok) {
          const rows = await res.json() as { alpha_enabled: boolean }[];
          dbAlphaEnabled = rows?.[0]?.alpha_enabled === true;
        }
      } catch {}
    }
    if (!dbAlphaEnabled) {
      const url = request.nextUrl.clone();
      url.pathname = '/waiting';
      return NextResponse.redirect(url);
    }
  }

  // ── Build final response ──────────────────────────────────────────────────────
  // We need custom headers on the REQUEST side so route handlers can read them.
  // @supabase/ssr's supabaseResponse uses the base request; we rebuild with our
  // custom headers, then copy any refreshed cookies that setAll wrote.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-workspace-id', workspaceId);
  requestHeaders.set('x-user-id', userId);
  requestHeaders.set('x-user-email', userEmail);

  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });

  // Copy refreshed session cookies from supabaseResponse (set by setAll on token refresh)
  supabaseResponse.cookies.getAll().forEach(cookie => {
    finalResponse.cookies.set(cookie.name, cookie.value);
  });

  // Response headers (for tracing / client-readable context)
  finalResponse.headers.set('x-workspace-id', workspaceId);
  finalResponse.headers.set('x-user-id', userId);
  finalResponse.headers.set('x-pathname', pathname);

  return finalResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
