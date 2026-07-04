/**
 * /api/debug/session — diagnostic endpoint for auth debugging.
 *
 * PUBLIC (no auth required) — intentionally shows raw session state so we can
 * diagnose login loops. Shows cookie names, getUser() result, and header state.
 * Does NOT expose token values.
 *
 * Remove or gate behind admin auth once login is confirmed working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sbUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // 1. Cookie inventory — names only, never values
  const allCookies = request.cookies.getAll();
  const cookieNames = allCookies.map(c => c.name);
  const sbCookieNames = allCookies
    .filter(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
    .map(c => ({
      name: c.name,
      valueLength: c.value.length,
      // Show first 30 chars to diagnose encoding (JSON starts with {, URL-encoded starts with %7B)
      valuePrefix: c.value.slice(0, 30),
      isUrlEncoded: c.value.startsWith('%'),
      isPlainJson:  c.value.startsWith('{'),
      isBase64Ssr:  c.value.startsWith('base64-'),
    }));

  // 2. Middleware headers (only present if user authenticated + middleware forwarded them)
  const mwWorkspaceId = request.headers.get('x-workspace-id') ?? null;
  const mwUserId      = request.headers.get('x-user-id') ?? null;
  const mwUserEmail   = request.headers.get('x-user-email') ?? null;

  // 3. Attempt getUser() using @supabase/ssr (same as middleware)
  let getUserResult: {
    hasUser: boolean;
    userId:       string | null;
    email:        string | null;
    workspaceId:  string | null;
    alphaEnabled: boolean | undefined;
    error:        string | null;
  } = { hasUser: false, userId: null, email: null, workspaceId: null, alphaEnabled: undefined, error: null };

  if (sbUrl && sbAnon) {
    const supabase = createServerClient(sbUrl, sbAnon, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() { /* read-only for debug */ },
      },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    getUserResult = {
      hasUser:     !!user,
      userId:      user?.id ?? null,
      email:       user?.email ?? null,
      workspaceId: (user?.user_metadata?.workspace_id as string | undefined) ?? null,
      alphaEnabled: user?.user_metadata?.alpha_enabled as boolean | undefined,
      error:       error?.message ?? null,
    };
  }

  // 4. Env config check
  const projectRef = sbUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? 'unknown';
  const expectedCookieName = projectRef !== 'unknown' ? `sb-${projectRef}-auth-token` : 'sb-????-auth-token';

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl:      !!sbUrl,
      hasSupabaseAnonKey:  !!sbAnon,
      hasServiceRoleKey:   !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      projectRef,
      expectedCookieName,
    },
    cookies: {
      total: allCookies.length,
      names: cookieNames,
      supabaseAuthCookies: sbCookieNames,
    },
    getUser: getUserResult,
    middlewareHeaders: {
      workspaceId: mwWorkspaceId,
      userId:      mwUserId,
      email:       mwUserEmail,
      // Note: these are null for public endpoints since middleware doesn't set them
      note: mwWorkspaceId ? 'middleware injected headers (user is authenticated)' : 'no middleware headers (public endpoint or not authenticated)',
    },
    diagnosis: buildDiagnosis(sbCookieNames, getUserResult, projectRef),
  });
}

function buildDiagnosis(
  sbCookies: Array<{ name: string; valueLength: number; valuePrefix: string; isUrlEncoded: boolean; isPlainJson: boolean; isBase64Ssr: boolean }>,
  getUser: { hasUser: boolean; error: string | null },
  projectRef: string,
): string {
  if (sbCookies.length === 0) {
    return 'PROBLEM: Ingen Supabase auth-cookie funnet. Brukeren er ikke innlogget, eller innlogging satte ikke cookies riktig. Logg inn og sjekk igjen.';
  }
  const urlEncoded = sbCookies.filter(c => c.isUrlEncoded);
  if (urlEncoded.length > 0) {
    return `PROBLEM: Cookie(s) ${urlEncoded.map(c => c.name).join(', ')} er URL-encodet (starter med %). @supabase/ssr forventer plain JSON (starter med {). Logg ut, tøm cookies, og logg inn på nytt etter siste deploy.`;
  }
  if (!getUser.hasUser) {
    return `PROBLEM: Supabase-cookie finnes men getUser() returnerte null (error: ${getUser.error ?? 'ingen'}). Mulig årsak: utløpt token og refresh feilet, eller token tilhører feil projekt (forventet: ${projectRef}).`;
  }
  return 'OK: Brukeren er innlogget og getUser() returnerte bruker.';
}
