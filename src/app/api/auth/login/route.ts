/**
 * POST /api/auth/login
 *
 * Uses plain createClient for sign-in so there are no complex SSR internals to crash.
 * Writes the session cookie manually in @supabase/ssr's native format:
 *   base64-{base64url(JSON.stringify(session))}
 * This matches exactly what createServerClient middleware reads via decodeChunkedCookieValue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sessionToCookieValue(session: object): string {
  // @supabase/ssr reads cookies whose value starts with "base64-" by base64url-decoding the rest.
  // Buffer.toString('base64url') = RFC 4648 §5 (no padding, same as @supabase/ssr stringToBase64URL).
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

function getProjectRef(supabaseUrl: string): string {
  return supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
}

export async function POST(req: NextRequest) {
  try {
    console.log('[LOGIN] route reached');

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Ugyldig JSON i forespørsel' }, { status: 400 });
    }

    const { email, password, mode } = body as { email?: string; password?: string; mode?: string };

    console.log(`[LOGIN] hasEmail=${!!email} | hasPassword=${!!password} | mode=${mode}`);

    if (!email || (!password && mode !== 'magic')) {
      return NextResponse.json({ error: 'Mangler e-post eller passord' }, { status: 400 });
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
    const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    const sbSvc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    console.log(`[LOGIN] supabaseUrl=${!!sbUrl} | anonKey=${!!sbAnon} | svcKey=${!!sbSvc}`);

    if (!sbUrl || !sbAnon) {
      console.error('[LOGIN] CRITICAL: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
      return NextResponse.json(
        { error: 'Server-konfig mangler (kontakt support)' },
        { status: 500 },
      );
    }

    const origin = req.headers.get('origin') ?? `https://${req.headers.get('host') ?? ''}`;
    const callbackUrl = `${origin}/api/auth/callback`;

    // ── Magic link ──────────────────────────────────────────────────────────────
    if (mode === 'magic') {
      const supabase = createClient(sbUrl, sbAnon, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl },
      });
      if (error) {
        console.error('[LOGIN] magic link error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, magic: true });
    }

    // ── Signup ──────────────────────────────────────────────────────────────────
    if (mode === 'signup') {
      if (!sbSvc) {
        return NextResponse.json(
          { error: 'SUPABASE_SERVICE_ROLE_KEY mangler — kan ikke opprette bruker' },
          { status: 500 },
        );
      }
      const admin = createClient(sbUrl, sbSvc, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: createErr } = await admin.auth.admin.createUser({
        email, password: password!, email_confirm: true,
      });

      if (createErr) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = (list?.users ?? []).find(
          (u: any) => u.email?.toLowerCase() === email.toLowerCase(),
        );

        if (existing) {
          await admin.auth.admin.updateUserById(existing.id, {
            password: password!, email_confirm: true,
          }).catch(() => {});
        } else {
          const msg = createErr.message.toLowerCase().includes('not allowed')
            ? 'Kontoen kan ikke opprettes automatisk. Be administrator opprette brukeren i Supabase Dashboard.'
            : createErr.message;
          return NextResponse.json({ error: msg }, { status: 400 });
        }
      }
      // fall through to sign-in below
    }

    // ── Sign-in ─────────────────────────────────────────────────────────────────
    const supabase = createClient(sbUrl, sbAnon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email!, password: password!,
    });

    console.log(
      `[LOGIN] signInWithPassword ${error ? `FAIL: ${error.message}` : 'OK'} |`,
      `user=${data.user?.id ?? 'none'} |`,
      `hasSession=${!!data.session} |`,
      `hasAccessToken=${!!data.session?.access_token} |`,
      `hasRefreshToken=${!!data.session?.refresh_token}`,
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data.session) {
      console.error('[LOGIN] signInWithPassword succeeded but session is null');
      return NextResponse.json({ error: 'Innlogging feilet — ingen sesjon returnert' }, { status: 500 });
    }

    const projectRef = getProjectRef(sbUrl);
    if (!projectRef) {
      console.error('[LOGIN] Could not derive projectRef from sbUrl:', sbUrl);
      return NextResponse.json({ error: 'Ugyldig Supabase URL-format' }, { status: 500 });
    }

    // Write session cookie in @supabase/ssr native format.
    // Format: base64-{base64url(JSON.stringify(session))}
    // This is read by createServerClient's decodeChunkedCookieValue in middleware.
    const cookieName = `sb-${projectRef}-auth-token`;
    const cookieValue = sessionToCookieValue(data.session);

    console.log(`[LOGIN] writing cookie: name=${cookieName} length=${cookieValue.length} prefix="${cookieValue.slice(0, 20)}"`);

    const workspaceId = data.user?.user_metadata?.workspace_id ?? '';
    const response = NextResponse.json({
      ok: true,
      workspaceId,
      immediate: mode === 'signup' && !workspaceId,
    });

    // Match @supabase/ssr DEFAULT_COOKIE_OPTIONS: httpOnly: false, maxAge: 400 days
    response.cookies.set(cookieName, cookieValue, {
      path: '/',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 400 * 24 * 60 * 60,
    });

    return response;
  } catch (err: unknown) {
    // Top-level catch ensures we ALWAYS return a JSON response.
    // Without this, an uncaught throw causes Next.js to close the connection
    // and the browser fetch() sees "fetch failed" instead of an HTTP error.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LOGIN] Uncaught error in route handler:', message);
    return NextResponse.json(
      { error: `Server error: ${message}` },
      { status: 500 },
    );
  }
}
