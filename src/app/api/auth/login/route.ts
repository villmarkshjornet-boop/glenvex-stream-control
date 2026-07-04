/**
 * POST /api/auth/login
 *
 * Uses @supabase/ssr createServerClient so cookies are written via the
 * onAuthStateChange → applyServerStorage → setAll pipeline. This guarantees
 * the cookie encoding (base64url by default) matches what the middleware's
 * createServerClient expects when reading cookies back.
 *
 * DO NOT write session cookies manually here — the format must match @supabase/ssr.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { email, password, mode } = await req.json();

  if (!email || (!password && mode !== 'magic')) {
    return NextResponse.json({ error: 'Mangler e-post eller passord' }, { status: 400 });
  }

  const sbUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? process.env.SUPABASE_URL  ?? '';
  // Anon key — required for auth operations. Service role key bypasses RLS and is for admin only.
  const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  // Service role key — only for admin user management (createUser, updateUserById)
  const sbSvc  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  console.log(`[LOGIN] env check | sbUrl=${!!sbUrl} | sbAnon=${!!sbAnon} | sbSvc=${!!sbSvc} | mode=${mode}`);

  if (!sbUrl || !sbAnon) {
    console.error('[LOGIN] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set in environment');
    return NextResponse.json({ error: 'Supabase-konfig mangler (NEXT_PUBLIC_SUPABASE_ANON_KEY)' }, { status: 500 });
  }

  const origin      = req.headers.get('origin') ?? `https://${req.headers.get('host') ?? ''}`;
  const callbackUrl = `${origin}/api/auth/callback`;

  // ── Magic link ───────────────────────────────────────────────────────────────
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

  // ── Signup ───────────────────────────────────────────────────────────────────
  if (mode === 'signup') {
    if (!sbSvc) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY mangler — kan ikke opprette bruker' }, { status: 500 });
    }
    const admin = createClient(sbUrl, sbSvc, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });

    if (createErr) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = (list?.users ?? []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

      if (existing) {
        await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true }).catch(() => {});
      } else {
        const msg = createErr.message.toLowerCase().includes('not allowed')
          ? 'Kontoen kan ikke opprettes automatisk. Be administrator opprette brukeren i Supabase Dashboard.'
          : createErr.message;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    // fall through to sign-in below
  }

  // ── Sign-in (email + password) ─────────────────────────────────────────────
  //
  // createServerClient triggers onAuthStateChange → applyServerStorage → setAll
  // after signInWithPassword. This writes the session cookie in @supabase/ssr
  // native format (base64url) so the middleware's getUser() can read it.
  //
  // Both _saveSession AND _notifyAllSubscribers are awaited inside signInWithPassword
  // (verified from @supabase/auth-js v2.107.0 source), so cookiesToSet is populated
  // synchronously by the time signInWithPassword resolves.

  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(sbUrl, sbAnon, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(cookies) {
        cookiesToSet.push(...cookies);
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  console.log(
    `[LOGIN] signInWithPassword ${error ? `FAIL: ${error.message}` : 'OK'} |`,
    `user=${data.user?.id ?? 'none'} |`,
    `session=${!!data.session} |`,
    `accessToken=${!!data.session?.access_token} |`,
    `refreshToken=${!!data.session?.refresh_token} |`,
    `cookiesSetCount=${cookiesToSet.length}`,
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const workspaceId = data.user?.user_metadata?.workspace_id ?? '';
  const response = NextResponse.json({
    ok:        true,
    workspaceId,
    immediate: mode === 'signup' && !workspaceId,
  });

  // Apply session cookies collected from createServerClient setAll callback
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
    console.log(`[LOGIN] set-cookie name=${name} length=${value.length} prefix="${value.slice(0, 15)}"`);
  });

  if (cookiesToSet.length === 0 && data.session) {
    // Fallback: applyServerStorage did not fire (should not happen based on source analysis,
    // but add safety net). Write in the format @supabase/ssr can parse.
    // Plain JSON works because decodeChunkedCookieValue handles non-base64 values as-is.
    const projectRef = sbUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
    if (projectRef) {
      const cookieName  = `sb-${projectRef}-auth-token`;
      const cookieValue = JSON.stringify(data.session);
      // Match @supabase/ssr DEFAULT_COOKIE_OPTIONS: httpOnly: false, maxAge: 400 days
      response.cookies.set(cookieName, cookieValue, {
        path: '/', httpOnly: false, secure: true, sameSite: 'lax', maxAge: 400 * 24 * 60 * 60,
      });
      console.warn(`[LOGIN] FALLBACK cookie written: ${cookieName} (plain JSON, ${cookieValue.length} bytes)`);
    }
  }

  return response;
}
