/**
 * Next.js Edge Middleware — authentication + workspace routing.
 *
 * Session validation: @supabase/ssr createServerClient reads plain-JSON cookies
 * (format: JSON.stringify(session), NOT encodeURIComponent(...)).
 * /api/auth/login and /api/auth/callback must write cookies in this format.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth',           // /api/auth/callback, /api/auth/login, /api/auth/twitch/*, etc.
  '/api/cron',
  '/api/backfill',
  '/api/admin/run-migration',
  '/overlay',            // OBS Browser Source — no session required
  '/api/goals/live',     // public read-only goal data for overlay
  '/api/debug/session',  // diagnostic endpoint — public so it works when not logged in
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Static assets ─────────────────────────────────────────────────────────────
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next({ request });
  }

  // ── Public paths ──────────────────────────────────────────────────────────────
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    // Handle Supabase OAuth code exchange landing on /login (fallback from magic links)
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

  // ── Private path: validate session via Supabase SSR ───────────────────────────
  const sbUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const sbAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isApiRoute = pathname.startsWith('/api/');

  if (!sbUrl || !sbAnonKey) {
    console.error('[MW] CRITICAL: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing in middleware');
    if (isApiRoute) {
      return NextResponse.json({ error: 'Server configuration error', code: 'CONFIG_ERROR' }, { status: 500 });
    }
    return new NextResponse('Server configuration error — contact support.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Log cookie names for debugging — never log values
  const cookieNames = request.cookies.getAll().map(c => c.name);
  const hasSbCookie = cookieNames.some(n => n.startsWith('sb-') && n.includes('-auth-token'));
  console.log(`[MW] ${pathname} | cookies=[${cookieNames.join(',')}] | hasSbCookie=${hasSbCookie}`);

  // Supabase SSR canonical pattern:
  // supabaseResponse is mutable — setAll replaces it on token refresh so refreshed
  // cookies are included in whichever response we return.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(sbUrl, sbAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() validates the session server-side and refreshes expired tokens.
  // Do NOT use getSession() — it trusts client-supplied tokens without revalidation.
  const { data: { user }, error: getUserError } = await supabase.auth.getUser();

  if (getUserError) {
    console.warn(`[MW] ${pathname} | getUser error: ${getUserError.message}`);
  }

  console.log(`[MW] ${pathname} | hasUser=${!!user} | userId=${user?.id ?? 'none'}`);

  if (!user) {
    console.log(`[MW] ${pathname} | BLOCK → /login | hasSbCookie=${hasSbCookie}`);
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized', code: 'NO_SESSION' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // ── Workspace lookup ──────────────────────────────────────────────────────────
  let workspaceId  = (user.user_metadata?.workspace_id as string | undefined) ?? '';
  const userId     = user.id;
  const userEmail  = user.email ?? '';
  const alphaEnabled = user.user_metadata?.alpha_enabled as boolean | undefined;

  const isOnboardingPath = pathname.startsWith('/onboarding')
    || pathname.startsWith('/api/onboarding')
    || pathname.startsWith('/api/auth');
  const isWaitingPath = pathname.startsWith('/waiting');
  const isAdminPath   = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

  // If workspace_id not in JWT claims, check DB before redirecting to onboarding.
  // This handles older users or sessions issued before workspace_id was added to metadata.
  if (!workspaceId && !isOnboardingPath) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (sbUrl && serviceKey) {
      try {
        const wsRes = await fetch(
          `${sbUrl}/rest/v1/workspaces?owner_user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
          {
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            signal: AbortSignal.timeout(2000),
          },
        );
        if (wsRes.ok) {
          const rows = await wsRes.json() as { id: string }[];
          workspaceId = rows?.[0]?.id ?? '';
          if (workspaceId) {
            console.log(`[MW] ${pathname} | workspace_id "${workspaceId}" found in DB (not in JWT) — user should re-login to refresh token`);
          }
        }
      } catch {}
    }
  }

  if (!workspaceId && !isOnboardingPath) {
    console.log(`[MW] ${pathname} | REDIRECT /onboarding | reason=no_workspace_id | userId=${userId}`);
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }

  // Alpha gate: alpha_enabled === false → waiting list
  // undefined/true → allowed (backwards compat for users without the flag)
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

  // ── Build final response ───────────────────────────────────────────────────────
  // Custom headers are set on the REQUEST side so route handlers can read them.
  // Build new headers, then copy refreshed cookies from supabaseResponse.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-workspace-id', workspaceId);
  requestHeaders.set('x-user-id', userId);
  requestHeaders.set('x-user-email', userEmail);

  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });

  // Forward any refreshed session cookies Supabase SSR wrote via setAll
  supabaseResponse.cookies.getAll().forEach(cookie => {
    finalResponse.cookies.set(cookie.name, cookie.value);
  });

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
