import { NextRequest, NextResponse } from 'next/server';

/**
 * Returns the workspace_id if the request is authenticated, or null if not.
 *
 * Authentication is established by the middleware: every request that passes
 * through middleware gets `x-workspace-id` injected into the request headers
 * from the validated JWT claims. If that header is absent or empty the request
 * either bypassed middleware (impossible on Vercel) or has no valid session.
 */
export function getAuthenticatedWorkspace(req: NextRequest): string | null {
  const wsId = req.headers.get('x-workspace-id');
  if (!wsId || wsId.trim() === '') return null;
  return wsId;
}

/**
 * Returns a 401 NextResponse if the request is not authenticated, or null if OK.
 *
 * Usage at the top of any POST handler:
 *   const authError = requireAuth(req);
 *   if (authError) return authError;
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const wsId = getAuthenticatedWorkspace(req);
  if (!wsId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'NO_SESSION' },
      { status: 401 },
    );
  }
  return null;
}
