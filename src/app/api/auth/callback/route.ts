import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

// Auth callback for Supabase magic-link / OAuth code exchange.
//
// IMPORTANT: cookies MUST be applied directly to the redirect NextResponse.
// Using cookies() from next/headers inside setAll does NOT reliably set
// cookies when the route returns NextResponse.redirect(), because Next.js
// does not always merge the cookie store mutations into a redirect response.
// We collect cookies in an array and apply them manually to the response.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    console.warn('[auth/callback] No code in request — redirecting to login');
    return NextResponse.redirect(new URL('/login?error=missing_code', origin));
  }

  const sbUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  // Use anon key for auth operations — service role key is for admin use only
  const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!sbUrl || !sbAnon) {
    console.error('[auth/callback] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
    return NextResponse.redirect(new URL('/login?error=config_error', origin));
  }

  // Collect cookies that Supabase SSR wants to set (session tokens)
  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(sbUrl, sbAnon, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookies) {
        // Collect — do NOT write to next/headers cookies() here
        cookiesToSet.push(...cookies);
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession failed:', error?.message ?? 'no user');
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin));
  }

  const workspaceId = data.user.user_metadata?.workspace_id as string | undefined;
  const redirectPath = workspaceId ? next : '/onboarding';

  console.log(`[auth/callback] user=${data.user.id} workspace=${workspaceId ?? 'none'} → ${redirectPath}`);

  const response = NextResponse.redirect(new URL(redirectPath, origin));

  // Apply session cookies to the redirect response
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
