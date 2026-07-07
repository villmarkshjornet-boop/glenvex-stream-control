import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Diagnostic endpoint — shows auth identity and workspace isolation state.
 * PUBLIC (no auth required) so it works even when session is broken.
 * Never returns secrets — only IDs, emails, slugs.
 */
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const projectRef = url.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1] ?? 'UKJENT';
  const cookieName = `sb-${projectRef}-auth-token`;
  const token = req.cookies.get(cookieName)?.value ?? '';

  // ── JWT claims ─────────────────────────────────────────────────────────────
  let jwtClaims: any = null;
  let jwtError: string | null = null;
  if (token) {
    try {
      const session = JSON.parse(decodeURIComponent(token));
      const b64 = session?.access_token?.split('.')?.[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
      const payload = b64 ? JSON.parse(atob(b64)) : null;
      jwtClaims = {
        sub:          payload?.sub ?? null,
        email:        payload?.email ?? null,
        exp:          payload?.exp ?? null,
        expired:      payload?.exp ? payload.exp < Date.now() / 1000 : null,
        workspace_id: payload?.user_metadata?.workspace_id ?? null,
        alpha_enabled: payload?.user_metadata?.alpha_enabled ?? null,
      };
    } catch (e: any) {
      jwtError = e.message;
    }
  }

  // ── Middleware-injected headers ────────────────────────────────────────────
  // These are set by src/middleware.ts for every authenticated request.
  // They are the authoritative source of workspace_id for API routes.
  const middlewareWorkspaceId = req.headers.get('x-workspace-id') ?? null;
  const middlewareUserId      = req.headers.get('x-user-id') ?? null;
  const middlewareUserEmail   = req.headers.get('x-user-email') ?? null;

  // ── DB workspace lookup ────────────────────────────────────────────────────
  let workspaceRow: any = null;
  let dbError: string | null = null;
  const wsId = middlewareWorkspaceId ?? jwtClaims?.workspace_id ?? null;

  if (wsId) {
    try {
      const db = getDb();
      if (db) {
        const { data, error } = await db
          .from('workspaces')
          .select('id,owner_user_id,brand_name,twitch_login,twitch_user_id,twitch_channel_name,plan,alpha_enabled')
          .eq('id', wsId)
          .single();
        if (error) dbError = error.message;
        else workspaceRow = data;
      }
    } catch (e: any) {
      dbError = e.message;
    }
  }

  // ── Isolation verdict ──────────────────────────────────────────────────────
  const jwtWs  = jwtClaims?.workspace_id ?? null;
  const mwWs   = middlewareWorkspaceId;
  const wsMatch = jwtWs && mwWs ? jwtWs === mwWs : null;

  const verdict =
    !jwtClaims            ? 'NO_SESSION'          :
    jwtClaims.expired     ? 'SESSION_EXPIRED'     :
    !jwtWs                ? 'NO_WORKSPACE_IN_JWT' :
    !mwWs                 ? 'MIDDLEWARE_NOT_INJECTING' :
    !wsMatch              ? 'WORKSPACE_MISMATCH'  :
    !workspaceRow         ? 'WORKSPACE_NOT_IN_DB' :
    workspaceRow.owner_user_id !== jwtClaims.sub ? 'OWNER_MISMATCH' :
                            'OK';

  return NextResponse.json({
    verdict,
    auth: {
      userId:     middlewareUserId ?? jwtClaims?.sub ?? null,
      email:      middlewareUserEmail ?? jwtClaims?.email ?? null,
      jwtExpired: jwtClaims?.expired ?? null,
      jwtError,
    },
    workspace: {
      fromJwt:        jwtWs,
      fromMiddleware: mwWs,
      match:          wsMatch,
      id:             workspaceRow?.id ?? null,
      ownerId:        workspaceRow?.owner_user_id ?? null,
      brandName:      workspaceRow?.brand_name ?? null,
      plan:           workspaceRow?.plan ?? null,
      alphaEnabled:   workspaceRow?.alpha_enabled ?? null,
      twitchLogin:    workspaceRow?.twitch_login ?? workspaceRow?.twitch_channel_name ?? null,
      twitchUserId:   workspaceRow?.twitch_user_id ?? null,
      dbError,
    },
    env: {
      hasWorkspaceEnvVar: !!process.env.WORKSPACE_ID,
      envWorkspaceId:     process.env.WORKSPACE_ID ?? null,
      projectRef,
    },
  });
}
