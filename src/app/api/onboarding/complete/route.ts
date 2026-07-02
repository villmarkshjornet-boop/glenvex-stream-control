import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

function parseSessionFromCookies(cookieStore: ReturnType<typeof cookies>): string | null {
  const all = cookieStore.getAll();
  const single = all.find(c => /^sb-.+-auth-token$/.test(c.name));
  if (single?.value) return single.value;
  const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
  if (!chunk0) return null;
  const base = chunk0.name.replace('.0', '');
  const chunks: string[] = [];
  for (let i = 0; i < 10; i++) {
    const chunk = cookieStore.get(`${base}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length ? chunks.join('') : null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const cookieStore = cookies();
  const rawCookie = parseSessionFromCookies(cookieStore);
  const adminClient = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string | null = null;
  let previousWorkspaceId: string | null = null;
  if (rawCookie) {
    try {
      const session = JSON.parse(decodeURIComponent(rawCookie));
      const accessToken: string = session.access_token ?? '';
      if (accessToken) {
        const { data: { user } } = await adminClient.auth.getUser(accessToken);
        userId = user?.id ?? null;
        previousWorkspaceId = user?.user_metadata?.workspace_id ?? null;
      }
    } catch {}
  }

  if (!userId) return NextResponse.json({ error: 'Ikke innlogget — logg inn på nytt og prøv igjen' }, { status: 401 });

  const body = await req.json();
  const {
    workspaceSlug, brandName,
    twitchUsername, twitchClientId, twitchClientSecret,
    discordBotToken, discordGuildId, discordInviteUrl,
    discordLiveChannelId, discordChatChannelId,
  } = body;

  if (!workspaceSlug || !twitchUsername || !discordBotToken || !discordGuildId) {
    return NextResponse.json({ error: 'Mangler påkrevde felter' }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  // ── Ownership checks — same logic as onboarding/workspace ─────────────────
  const { data: existing } = await db.from('workspaces')
    .select('id,owner_user_id,twitch_login,discord_guild_id')
    .eq('id', workspaceSlug)
    .single();

  if (existing) {
    // Owned by different user
    if (existing.owner_user_id && existing.owner_user_id !== userId) {
      await db.from('system_events').insert({
        workspace_id: workspaceSlug,
        source: 'onboarding',
        event_type: 'WORKSPACE_CLAIM_REJECTED_OWNED',
        title: `[Auth] Claim avvist — workspace tilhører annen bruker`,
        severity: 'warning',
        metadata: { reason: 'owned_by_other', existingOwnerId: existing.owner_user_id, requestingUserId: userId },
      }).catch(() => {});
      return NextResponse.json({ error: `Workspace "${workspaceSlug}" tilhører allerede en annen bruker.` }, { status: 409 });
    }

    // Configured but no owner — this is a bootstrapped workspace, block claiming
    if (!existing.owner_user_id && (existing.twitch_login || existing.discord_guild_id)) {
      await db.from('system_events').insert({
        workspace_id: workspaceSlug,
        source: 'onboarding',
        event_type: 'WORKSPACE_CLAIM_REJECTED_CONFIGURED',
        title: `[Auth] Claim avvist — workspace er konfigurert uten eier`,
        severity: 'warning',
        metadata: { reason: 'configured_without_owner', twitchLogin: existing.twitch_login ?? null, requestingUserId: userId },
      }).catch(() => {});
      return NextResponse.json({
        error: `Workspace "${workspaceSlug}" er konfigurert for en annen konto. Velg et annet workspace-ID.`,
      }, { status: 409 });
    }
  }

  const isClaiming = !!existing;

  const credentials = { twitchClientId, twitchClientSecret, discordBotToken, discordGuildId, discordInviteUrl, discordLiveChannelId, discordChatChannelId };
  const kanalPreferanser = { live: discordLiveChannelId || null, chat: discordChatChannelId || null, klipp: null, partner: null, subs: null, raid: null, streamplan: null, content_factory: null, feil: null };

  let wsError: any = null;

  if (isClaiming) {
    const { error } = await db.from('workspaces').update({
      owner_user_id: userId,
      updated_at: new Date().toISOString(),
    }).eq('id', workspaceSlug);
    wsError = error;
  } else {
    const { error } = await db.from('workspaces').insert({
      id: workspaceSlug,
      owner_user_id: userId,
      streamer_name: twitchUsername,
      brand_name: brandName || twitchUsername,
      twitch_channel_name: twitchUsername,
      discord_guild_id: discordGuildId,
      live_channel_id: discordLiveChannelId || null,
      bot_personality: 'dark_gaming',
      plan: 'alpha',
      settings_json: { credentials, kanalPreferanser, stream_syklus: {} },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    wsError = error;
  }

  if (wsError) return NextResponse.json({ error: wsError.message }, { status: 500 });

  // ── Write workspace_id into user_metadata ─────────────────────────────────
  const { error: metaError } = await adminClient.auth.admin.updateUserById(userId!, {
    user_metadata: { workspace_id: workspaceSlug, brand_name: brandName },
  });
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });

  // ── Audit log — always record workspace_id changes ────────────────────────
  await db.from('system_events').insert({
    workspace_id: workspaceSlug,
    source: 'onboarding',
    event_type: 'WORKSPACE_ID_ASSIGNED',
    title: `[Auth] workspace_id-tilordning via onboarding/complete for user ${userId}`,
    severity: 'info',
    metadata: {
      source: 'onboarding_complete',
      action: isClaiming ? 'claimed' : 'created',
      userId,
      previousWorkspaceId,
      newWorkspaceId: workspaceSlug,
      brandName,
      twitchUsername,
    },
  }).catch(() => {});

  await db.from('system_events').insert({
    workspace_id: workspaceSlug,
    source: 'system',
    event_type: 'WORKSPACE_CREATED',
    title: `Workspace ${workspaceSlug} opprettet`,
    severity: 'info',
    metadata: { user_id: userId, twitch_username: twitchUsername },
  }).catch(() => {});

  return NextResponse.json({ ok: true, workspaceId: workspaceSlug });
}
