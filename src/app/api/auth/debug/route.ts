import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const projectRef = url.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? 'UKJENT';
  const cookieName = `sb-${projectRef}-auth-token`;
  const token = req.cookies.get(cookieName)?.value ?? '';

  let sessionInfo: any = null;
  if (token) {
    try {
      const session = JSON.parse(decodeURIComponent(token));
      const b64 = session?.access_token?.split('.')?.[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
      const payload = b64 ? JSON.parse(atob(b64)) : null;
      sessionInfo = {
        email: payload?.email,
        sub: payload?.sub,
        exp: payload?.exp,
        expired: payload?.exp ? payload.exp < Date.now() / 1000 : null,
        workspace_id: payload?.user_metadata?.workspace_id,
      };
    } catch (e: any) {
      sessionInfo = { parseError: e.message };
    }
  }

  return NextResponse.json({
    cookieName,
    hasCookie: !!token,
    tokenLength: token.length,
    allCookies: req.cookies.getAll().map(c => c.name),
    session: sessionInfo,
    env: {
      hasSupabaseUrl: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
      projectRef,
    },
  });
}
