import { getDb } from '@/lib/db';

/**
 * Returns a valid broadcaster user token. Tries 3 sources in order:
 * 1. TWITCH_USER_OAUTH env var (Railway-set, fastest — no Supabase needed)
 * 2. twitch_access_token from Supabase workspace (with auto-refresh on 401)
 *
 * Required since Aug 2023: /helix/channels/followers needs a broadcaster
 * user token — app access tokens (client credentials) no longer work.
 */
export async function getValidBroadcasterToken(workspaceId: string): Promise<string | null> {
  const clientId     = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // ── 1. Try TWITCH_USER_OAUTH env var (set in Railway) ─────────────────
  const envToken = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '').trim();
  if (envToken) {
    const valid = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${envToken}` },
      signal: AbortSignal.timeout(4000),
    }).then(r => r.ok).catch(() => false);
    if (valid) return envToken;
  }

  // ── 2. Try Supabase stored token, auto-refresh if expired ─────────────
  const db = getDb();
  if (!db) return null;

  const { data: ws } = await db
    .from('workspaces')
    .select('twitch_access_token,twitch_refresh_token')
    .eq('id', workspaceId)
    .single();

  if (!ws?.twitch_access_token) return null;

  const testRes = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${ws.twitch_access_token}` },
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);

  if (testRes?.ok) return ws.twitch_access_token;

  if (!ws.twitch_refresh_token) return null;

  const refreshRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: ws.twitch_refresh_token,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!refreshRes?.ok) return null;

  const tokens = await refreshRes.json() as { access_token: string; refresh_token?: string };
  if (!tokens.access_token) return null;

  await db.from('workspaces').update({
    twitch_access_token:  tokens.access_token,
    ...(tokens.refresh_token ? { twitch_refresh_token: tokens.refresh_token } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', workspaceId);

  return tokens.access_token;
}
