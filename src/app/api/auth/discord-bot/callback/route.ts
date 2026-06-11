import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { decodeState, safeReturnUrl } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code    = searchParams.get('code');
  const state   = searchParams.get('state');
  const guildId = searchParams.get('guild_id');
  const error   = searchParams.get('error');

  const fallbackUrl = `${origin}/onboarding`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${fallbackUrl}?error=discord_cancelled`);
  }

  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!stateSecret) {
    console.error('[discord-bot/callback] OAUTH_STATE_SECRET ikke satt');
    return NextResponse.redirect(`${fallbackUrl}?error=server_config`);
  }

  const decoded = decodeState(state, stateSecret);
  if (!decoded.ok) {
    console.error('[discord-bot/callback] state decode failed:', decoded.error);
    return NextResponse.redirect(`${fallbackUrl}?error=discord_state_${decoded.error}`);
  }

  const { wsId, ret, nonce } = decoded.state;

  // CSRF check: nonce in signed state must match cookie
  const storedNonce = req.cookies.get('discord_oauth_nonce')?.value;
  if (!storedNonce || storedNonce !== nonce) {
    return NextResponse.redirect(`${fallbackUrl}?error=discord_state_mismatch`);
  }

  const clientId     = process.env.DISCORD_CLIENT_ID ?? '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
  const centralBase  = (
    process.env.GLENVEX_OAUTH_BASE ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    origin
  ).replace(/\/$/, '');

  if (!clientSecret) {
    console.error('[discord-bot/callback] DISCORD_CLIENT_SECRET ikke satt');
    return NextResponse.redirect(`${fallbackUrl}?error=discord_config_missing`);
  }

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  `${centralBase}/api/auth/discord-bot/callback`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error('[discord-bot/callback] token exchange failed:', tokenRes.status, body);
    return NextResponse.redirect(`${fallbackUrl}?error=discord_token_failed`);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string; token_type: string;
    guild?: { id: string; name: string; icon: string | null };
  };

  const resolvedGuildId   = guildId ?? tokenData.guild?.id ?? null;
  let   resolvedGuildName = tokenData.guild?.name ?? null;

  if (resolvedGuildId && !resolvedGuildName) {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (botToken) {
      const guildRes = await fetch(`https://discord.com/api/v10/guilds/${resolvedGuildId}`, {
        headers: { Authorization: `Bot ${botToken}` },
        signal:  AbortSignal.timeout(5_000),
      }).catch(() => null);
      if (guildRes?.ok) {
        const g = await guildRes.json() as { name: string };
        resolvedGuildName = g.name;
      }
    }
  }

  if (!resolvedGuildId) {
    return NextResponse.redirect(`${fallbackUrl}?error=discord_no_guild`);
  }

  const db = getDb();
  if (!db) return NextResponse.redirect(`${fallbackUrl}?error=db_unavailable`);

  const { error: dbErr } = await db.from('workspaces').update({
    discord_guild_id:     resolvedGuildId,
    discord_guild_name:   resolvedGuildName,
    discord_connected_at: new Date().toISOString(),
    onboarding_step:      3,
    updated_at:           new Date().toISOString(),
  }).eq('id', wsId);

  if (dbErr) {
    console.error('[discord-bot/callback] db update failed:', dbErr.message);
    return NextResponse.redirect(`${fallbackUrl}?error=db_save_failed`);
  }

  try { await db.from('system_events').insert({
    workspace_id: wsId,
    source:       'onboarding',
    event_type:   'DISCORD_CONNECTED',
    title:        `Discord tilkoblet: ${resolvedGuildName ?? resolvedGuildId}`,
    severity:     'info',
    metadata:     { guildId: resolvedGuildId, guildName: resolvedGuildName },
  }); } catch {}

  const redirectTo = safeReturnUrl(ret, `${fallbackUrl}?step=4`);
  const response = NextResponse.redirect(
    redirectTo.startsWith('/') ? `${origin}${redirectTo}` : redirectTo
  );
  response.cookies.delete('discord_oauth_nonce');
  return response;
}
