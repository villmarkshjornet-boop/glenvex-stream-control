/**
 * Shared utility for parsing Supabase auth cookie values.
 *
 * Handles both cookie formats:
 *   New (@supabase/ssr): "base64-{base64url(JSON.stringify(session))}"
 *   Legacy:              URL-encoded JSON or plain JSON
 *
 * Routes under /api/auth are PUBLIC — middleware does not inject x-user-id or
 * x-workspace-id. These routes must parse the session cookie themselves.
 */

export interface CookieIdentity {
  userId: string | null;
  workspaceId: string | null;
}

/** Decode a raw cookie value to a JSON string without throwing. */
function decodeCookieValue(raw: string): string | null {
  try {
    if (raw.startsWith('base64-')) {
      // @supabase/ssr writes: base64-{base64url(JSON.stringify(session))}
      return Buffer.from(raw.slice(7), 'base64url').toString('utf-8');
    }
    // Legacy: encodeURIComponent(JSON.stringify(session)) or plain JSON
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Extract userId and workspaceId from a decoded session JSON string. */
function extractIdentity(sessionJson: string): CookieIdentity {
  try {
    const session = JSON.parse(sessionJson) as { access_token?: string };
    if (!session.access_token) return { userId: null, workspaceId: null };

    const [, b64Raw] = session.access_token.split('.');
    if (!b64Raw) return { userId: null, workspaceId: null };

    // JWT payload is standard base64 (not base64url) — convert before decode
    const b64 = b64Raw.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as {
      sub?: string;
      user_metadata?: { workspace_id?: string };
    };
    return {
      userId:      payload.sub ?? null,
      workspaceId: payload.user_metadata?.workspace_id ?? null,
    };
  } catch {
    return { userId: null, workspaceId: null };
  }
}

/**
 * Read the Supabase auth cookie from a NextRequest and extract userId + workspaceId.
 * Handles chunked cookies (sb-*-auth-token.0, .1, ...) and the base64url format.
 */
export function getIdentityFromRequestCookies(cookies: { getAll: () => { name: string; value: string }[]; get: (name: string) => { value: string } | undefined }): CookieIdentity {
  const all = cookies.getAll();
  let rawValue = '';

  // Single cookie (most common)
  const single = all.find(c => /^sb-.+-auth-token$/.test(c.name) && !c.name.includes('.'));
  if (single) {
    rawValue = single.value;
  } else {
    // Chunked: sb-*-auth-token.0, .1, ...
    const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
    if (chunk0) {
      const base = chunk0.name.replace('.0', '');
      const parts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const v = cookies.get(`${base}.${i}`)?.value;
        if (!v) break;
        parts.push(v);
      }
      rawValue = parts.join('');
    }
  }

  if (!rawValue) return { userId: null, workspaceId: null };

  const json = decodeCookieValue(rawValue);
  if (!json) return { userId: null, workspaceId: null };

  return extractIdentity(json);
}

/**
 * Same as above but for the next/headers cookieStore (server components / route handlers
 * that use cookies() from 'next/headers').
 */
export function getIdentityFromCookieStore(cookieStore: { getAll: () => { name: string; value: string }[]; get: (name: string) => { value: string } | undefined }): CookieIdentity {
  return getIdentityFromRequestCookies(cookieStore);
}

/** Extract only the user ID from the cookie (used by routes that only need userId). */
export function getUserIdFromCookieStore(cookieStore: { getAll: () => { name: string; value: string }[]; get: (name: string) => { value: string } | undefined }): string | null {
  return getIdentityFromCookieStore(cookieStore).userId;
}
