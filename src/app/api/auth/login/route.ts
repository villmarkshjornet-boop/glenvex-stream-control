import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// @supabase/ssr reads cookies as plain JSON (no decodeURIComponent).
// All session cookies written here must be JSON.stringify(session) — NO encodeURIComponent.
function writeSesjonCookie(
  response: NextResponse,
  projectRef: string,
  session: object,
): void {
  const cookieName  = `sb-${projectRef}-auth-token`;
  const cookieValue = JSON.stringify(session); // plain JSON — @supabase/ssr expects this
  response.cookies.set(cookieName, cookieValue, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
  });
}

export async function POST(req: NextRequest) {
  const { email, password, mode } = await req.json();

  if (!email || (!password && mode !== 'magic')) {
    return NextResponse.json({ error: 'Mangler e-post eller passord' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Auth operations must use the anon key — service role key bypasses RLS and is for admin use only.
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase-konfig mangler på server' }, { status: 500 });
  }

  const projectRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const origin = req.headers.get('origin') ?? `https://${req.headers.get('host') ?? ''}`;
  const callbackUrl = `${origin}/api/auth/callback`;

  if (mode === 'magic') {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, magic: true });
  }

  if (mode === 'signup') {
    // Admin client needed for createUser — use service role key here only
    const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseKey;
    const admin = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
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

    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) return NextResponse.json({ error: signInErr.message }, { status: 400 });

    const workspaceId = signInData.user?.user_metadata?.workspace_id ?? '';
    const response = NextResponse.json({ ok: true, workspaceId, immediate: !workspaceId });

    if (signInData.session && projectRef) {
      writeSesjonCookie(response, projectRef, signInData.session);
    }

    return response;
  }

  // signin
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const workspaceId = data.user?.user_metadata?.workspace_id ?? '';
  const response = NextResponse.json({ ok: true, workspaceId });

  if (data.session && projectRef) {
    writeSesjonCookie(response, projectRef, data.session);
  }

  return response;
}
