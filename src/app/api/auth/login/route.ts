import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { email, password, mode } = await req.json();

  if (!email || (!password && mode !== 'magic')) {
    return NextResponse.json({ error: 'Mangler e-post eller passord' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase-konfig mangler på server' }, { status: 500 });
  }

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
    // Use admin API — oppretter bruker uten epost-bekreftelse, ingen rate limit
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 });

    // Logg inn umiddelbart
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) return NextResponse.json({ error: signInErr.message }, { status: 400 });

    const session = signInData.session;
    const projectRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
    const cookieName = `sb-${projectRef}-auth-token`;
    const response = NextResponse.json({ ok: true, workspaceId: '', immediate: true });
    response.cookies.set(cookieName, encodeURIComponent(JSON.stringify(session)), {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.expires_in,
    });
    return response;
  }

  // signin — get session and set cookie manually
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const session = data.session;
  const workspaceId = data.user?.user_metadata?.workspace_id ?? '';

  // Build cookie name from project ref (same format middleware reads)
  const projectRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(JSON.stringify(session));

  const response = NextResponse.json({ ok: true, workspaceId });
  response.cookies.set(cookieName, cookieValue, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: session.expires_in,
  });

  return response;
}
