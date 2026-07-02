import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── Cookie parser (same logic as middleware + onboarding/complete) ────────────

function parseSession(cookieStore: ReturnType<typeof cookies>): {
  raw: any; cookieName: string;
} | null {
  const all = cookieStore.getAll();

  const single = all.find(c => /^sb-.+-auth-token$/.test(c.name));
  if (single?.value) {
    try {
      return { raw: JSON.parse(decodeURIComponent(single.value)), cookieName: single.name };
    } catch {}
  }

  const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
  if (chunk0) {
    const base = chunk0.name.replace('.0', '');
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) {
      const chunk = cookieStore.get(`${base}.${i}`)?.value;
      if (!chunk) break;
      chunks.push(chunk);
    }
    if (chunks.length) {
      try {
        return { raw: JSON.parse(decodeURIComponent(chunks.join(''))), cookieName: base };
      } catch {}
    }
  }
  return null;
}

function decodeJwtPayload(token: string): any | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch { return null; }
}

// ── GET — vis nåværende tilstand ──────────────────────────────────────────────

export async function GET() {
  const cookieStore = cookies();
  const parsed = parseSession(cookieStore);
  if (!parsed) return NextResponse.json({ error: 'Ingen session — logg inn' }, { status: 401 });

  const claims = decodeJwtPayload(parsed.raw?.access_token ?? '');
  if (!claims?.sub) return NextResponse.json({ error: 'Ugyldig token' }, { status: 401 });

  const currentWsId = claims.user_metadata?.workspace_id ?? null;

  const db = getDb();
  let workspace = null;
  if (db && currentWsId) {
    const { data } = await db.from('workspaces')
      .select('id,brand_name,streamer_name,twitch_display_name,twitch_login,owner_user_id')
      .eq('id', currentWsId)
      .single();
    workspace = data;
  }

  // Finn alle workspaces der auth-brukeren er owner — for å se kandidater
  let ownedWorkspaces: any[] = [];
  if (db) {
    const { data } = await db.from('workspaces')
      .select('id,brand_name,twitch_display_name,twitch_login,owner_user_id')
      .eq('owner_user_id', claims.sub);
    ownedWorkspaces = data ?? [];
  }

  return NextResponse.json({
    authUser: {
      id:               claims.sub,
      email:            claims.email ?? null,
      currentWorkspaceId: currentWsId,
    },
    currentWorkspace:   workspace,
    isOwnerMatch:       workspace?.owner_user_id === claims.sub,
    ownedWorkspaces,
    note: 'POST { newWorkspaceId } for å bytte',
  });
}

// ── POST — bytt workspace_id i user_metadata og refresh JWT ──────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as { newWorkspaceId?: string };
  const newWorkspaceId = body.newWorkspaceId?.trim();
  if (!newWorkspaceId) {
    return NextResponse.json({ error: 'newWorkspaceId kreves i body' }, { status: 400 });
  }

  const cookieStore = cookies();
  const parsed = parseSession(cookieStore);
  if (!parsed) return NextResponse.json({ error: 'Ingen session — logg inn' }, { status: 401 });

  const { raw: session, cookieName } = parsed;
  const accessToken:  string = session?.access_token  ?? '';
  const refreshToken: string = session?.refresh_token ?? '';
  if (!accessToken) return NextResponse.json({ error: 'Ugyldig session' }, { status: 401 });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase-konfig mangler på server' }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Verifiser at access_token er gyldig og tilhører en ekte bruker
  const { data: { user }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !user) {
    return NextResponse.json({ error: 'Token ugyldig — logg ut og inn igjen' }, { status: 401 });
  }

  // 2. Finn target workspace
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB utilgjengelig' }, { status: 500 });

  const { data: ws } = await db.from('workspaces')
    .select('id,owner_user_id,brand_name,twitch_display_name,twitch_login')
    .eq('id', newWorkspaceId)
    .single();

  if (!ws) {
    return NextResponse.json({
      error: `Workspace '${newWorkspaceId}' finnes ikke i databasen`,
    }, { status: 404 });
  }

  // 3. Sikkerhetssjekk: workspace må enten ikke ha eier, eller tilhøre denne brukeren
  if (ws.owner_user_id && ws.owner_user_id !== user.id) {
    return NextResponse.json({
      error: `Workspace '${newWorkspaceId}' tilhører en annen bruker. Kontakt admin.`,
      ownerId: ws.owner_user_id,
      yourId:  user.id,
    }, { status: 403 });
  }

  // 4. Oppdater user_metadata
  const brandName = ws.brand_name ?? ws.twitch_display_name ?? ws.twitch_login ?? newWorkspaceId;
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { workspace_id: newWorkspaceId, brand_name: brandName },
  });

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // 5. Claim workspace hvis det ikke har eier
  if (!ws.owner_user_id) {
    await db.from('workspaces')
      .update({ owner_user_id: user.id, updated_at: new Date().toISOString() })
      .eq('id', newWorkspaceId);
  }

  // 6. Refresh JWT så ny workspace_id er i tokenet umiddelbart — unngår utlogging
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? supabaseKey;
  let newSession: any = session;
  if (refreshToken) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body:    JSON.stringify({ refresh_token: refreshToken }),
        signal:  AbortSignal.timeout(8_000),
      });
      if (res.ok) newSession = await res.json();
    } catch {}
  }

  // 7. Skriv ny session til cookie (chunked hvis nødvendig)
  const response = NextResponse.json({
    ok:          true,
    workspaceId: newWorkspaceId,
    brandName,
    message:     newSession !== session
      ? 'Workspace oppdatert og JWT refreshet — last siden på nytt.'
      : 'Workspace oppdatert i DB. JWT refresh feilet — logg ut og inn igjen for å aktivere.',
  });

  if (newSession !== session) {
    const encoded    = encodeURIComponent(JSON.stringify(newSession));
    const CHUNK_SIZE = 3500;
    if (encoded.length <= CHUNK_SIZE) {
      response.cookies.set(cookieName, encoded, {
        path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
      });
      for (let i = 0; i < 5; i++) {
        response.cookies.set(`${cookieName}.${i}`, '', {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0,
        });
      }
    } else {
      response.cookies.set(cookieName, '', {
        path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0,
      });
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        chunks.push(encoded.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        response.cookies.set(`${cookieName}.${i}`, chunks[i], {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
        });
      }
    }
  }

  return response;
}
