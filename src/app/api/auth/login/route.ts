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
    // Prøv å opprette ny bruker via admin API
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      // Sjekk om brukeren allerede finnes (manuelt opprettet eller tidligere forsøk)
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = (list?.users ?? []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

      if (existing) {
        // Bruker finnes — oppdater passord og logg inn
        await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true }).catch(() => {});
      } else {
        // Supabase blokkerer oppretting — gi forklarende melding
        const msg = createErr.message.toLowerCase().includes('not allowed')
          ? 'Kontoen kan ikke opprettes automatisk. Be administrator opprette brukeren i Supabase Dashboard (Authentication → Users → Add user), og logg deretter inn normalt.'
          : createErr.message;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Logg inn med oppgitt passord
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) return NextResponse.json({ error: signInErr.message }, { status: 400 });

    const session = signInData.session;
    const projectRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
    const cookieName = `sb-${projectRef}-auth-token`;
    const workspaceId = signInData.user?.user_metadata?.workspace_id ?? '';
    const response = NextResponse.json({ ok: true, workspaceId, immediate: !workspaceId });
    response.cookies.set(cookieName, encodeURIComponent(JSON.stringify(session)), {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
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
    maxAge: 60 * 60 * 24 * 30, // 30 dager — access_token refreshes selv via middleware
  });

  return response;
}
