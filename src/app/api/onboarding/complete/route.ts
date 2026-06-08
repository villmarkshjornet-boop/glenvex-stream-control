import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 });

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

  // Check if workspace exists — if it does but has no owner, allow claiming it
  const { data: existing } = await db.from('workspaces').select('id,owner_user_id').eq('id', workspaceSlug).single();
  if (existing && existing.owner_user_id) {
    return NextResponse.json({ error: `Workspace "${workspaceSlug}" tilhører allerede en annen bruker.` }, { status: 409 });
  }

  const isClaiming = !!existing;

  // Create or claim workspace
  const credentials = {
    twitchClientId,
    twitchClientSecret,
    discordBotToken,
    discordGuildId,
    discordInviteUrl,
    discordLiveChannelId,
    discordChatChannelId,
  };

  const kanalPreferanser = {
    live: discordLiveChannelId || null,
    chat: discordChatChannelId || null,
    klipp: null,
    partner: null,
    subs: null,
    raid: null,
    streamplan: null,
    content_factory: null,
    feil: null,
  };

  let wsError: any = null;

  if (isClaiming) {
    // Workspace exists (no owner) — claim it and update credentials
    const { error } = await db.from('workspaces').update({
      owner_user_id: user.id,
      streamer_name: twitchUsername,
      brand_name: brandName || twitchUsername,
      twitch_channel_name: twitchUsername,
      discord_guild_id: discordGuildId,
      live_channel_id: discordLiveChannelId || null,
      plan: 'alpha',
      settings_json: {
        credentials,
        kanalPreferanser,
        stream_syklus: {},
      },
      updated_at: new Date().toISOString(),
    }).eq('id', workspaceSlug);
    wsError = error;
  } else {
    // New workspace — insert
    const { error } = await db.from('workspaces').insert({
      id: workspaceSlug,
      owner_user_id: user.id,
      streamer_name: twitchUsername,
      brand_name: brandName || twitchUsername,
      twitch_channel_name: twitchUsername,
      discord_guild_id: discordGuildId,
      live_channel_id: discordLiveChannelId || null,
      bot_personality: 'dark_gaming',
      plan: 'alpha',
      settings_json: {
        credentials,
        kanalPreferanser,
        stream_syklus: {},
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    wsError = error;
  }

  if (wsError) {
    return NextResponse.json({ error: wsError.message }, { status: 500 });
  }

  // Store workspace_id in user metadata — middleware reads this to inject x-workspace-id
  const { error: metaError } = await supabase.auth.updateUser({
    data: { workspace_id: workspaceSlug, brand_name: brandName },
  });

  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 });
  }

  // Emit system event so the dashboard knows the workspace is live
  try {
    await db.from('system_events').insert({
      workspace_id: workspaceSlug,
      source: 'system',
      event_type: 'WORKSPACE_CREATED',
      title: `Workspace ${workspaceSlug} opprettet`,
      severity: 'info',
      metadata: { user_id: user.id, twitch_username: twitchUsername },
    });
  } catch {}

  return NextResponse.json({ ok: true, workspaceId: workspaceSlug });
}
