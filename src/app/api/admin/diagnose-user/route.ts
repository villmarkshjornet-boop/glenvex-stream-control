import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function GET(req: NextRequest) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email param mangler' }, { status: 400 });

  const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!sbUrl || !sbKey) return NextResponse.json({ error: 'SUPABASE env mangler' }, { status: 500 });

  const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db ikke tilgjengelig' }, { status: 500 });

  // 1. Find auth user by email
  const { data: { users }, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return NextResponse.json({ error: `auth.listUsers: ${usersErr.message}` }, { status: 500 });

  const authUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null;

  if (!authUser) {
    return NextResponse.json({
      email,
      authUser: null,
      workspace: null,
      systemEvents: [],
      diagnosis: 'BRUKERKONTO IKKE FUNNET — ingen auth.users rad med denne e-posten',
    });
  }

  const userId = authUser.id;
  const userMeta = authUser.user_metadata ?? {};

  // 2. Find workspace by owner
  const { data: workspaceByOwner } = await db
    .from('workspaces')
    .select('id,owner_user_id,brand_name,twitch_login,twitch_connected_at,discord_guild_id,discord_connected_at,live_channel_id,onboarding_step,onboarding_completed_at,alpha_enabled,settings_json,created_at,updated_at')
    .eq('owner_user_id', userId)
    .limit(1)
    .single();

  // 3. If no workspace by owner, try by user_metadata.workspace_id
  let workspaceByMeta: any = null;
  const metaWsId = userMeta?.workspace_id;
  if (!workspaceByOwner && metaWsId) {
    const { data } = await db.from('workspaces').select('*').eq('id', metaWsId).single();
    workspaceByMeta = data ?? null;
  }

  const workspace = workspaceByOwner ?? workspaceByMeta ?? null;

  // 4. Recent system events
  let systemEvents: any[] = [];
  if (workspace?.id) {
    const { data } = await db
      .from('system_events')
      .select('event_type,title,severity,created_at,metadata')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(20);
    systemEvents = data ?? [];
  }

  // 5. Diagnosis
  const checks = {
    authUserFound:      true,
    hasWorkspaceByOwner: !!workspaceByOwner,
    hasWorkspaceByMeta:  !!workspaceByMeta,
    metaWorkspaceId:    metaWsId ?? null,
    metaAlphaEnabled:   userMeta?.alpha_enabled ?? null,
    ownerIdMatches:     workspace ? workspace.owner_user_id === userId : null,
    twitchConnected:    workspace ? !!workspace.twitch_connected_at && !!workspace.twitch_login : false,
    discordConnected:   workspace ? !!workspace.discord_connected_at && !!workspace.discord_guild_id : false,
    liveChannelSet:     workspace ? !!(workspace.settings_json?.kanalPreferanser?.live ?? workspace.live_channel_id) : false,
    onboardingComplete: workspace ? !!workspace.onboarding_completed_at : false,
    alphaEnabled:       workspace ? !!workspace.alpha_enabled : false,
  };

  let diagnosis = '';
  if (!workspace) {
    diagnosis = 'KRITISK: Ingen workspace funnet for denne brukeren. owner_user_id-oppslag returnerte null, og user_metadata.workspace_id er heller ikke i DB. Bruker MÅ gjennomføre steg 1 (workspace-oppretting) på nytt.';
  } else if (!checks.hasWorkspaceByOwner && checks.hasWorkspaceByMeta) {
    diagnosis = `ADVARSEL: Workspace "${workspace.id}" finnes, men owner_user_id = "${workspace.owner_user_id}" ≠ auth.uid "${userId}". Eierskap-mismatch — kan ikke koble til Twitch/Discord.`;
  } else if (!checks.twitchConnected) {
    diagnosis = `Workspace "${workspace.id}" finnes og eierskap er OK. Twitch IKKE tilkoblet. Bruker kan gå til /onboarding?step=2 og koble til.`;
  } else if (!checks.discordConnected) {
    diagnosis = `Twitch OK. Discord IKKE tilkoblet. Bruker kan gå til /onboarding?step=3.`;
  } else if (!checks.liveChannelSet) {
    diagnosis = `Twitch + Discord OK. Live-kanal ikke valgt. Steg 4.`;
  } else if (!checks.onboardingComplete) {
    diagnosis = `Alt koblet. Onboarding ikke fullført. Kjør /api/admin/workspaces/${workspace.id}/repair for å fullføre.`;
  } else if (!checks.alphaEnabled) {
    diagnosis = `Onboarding fullført men alpha_enabled=false. Kjør /api/admin/workspaces/${workspace.id}/repair?forceAlpha=true.`;
  } else {
    diagnosis = 'Alt OK — workspace klar for bot-runtime.';
  }

  return NextResponse.json({
    email,
    authUid: userId,
    authUserMeta: userMeta,
    workspace: workspace ? {
      id: workspace.id,
      owner_user_id: workspace.owner_user_id,
      brand_name: workspace.brand_name,
      twitch_login: workspace.twitch_login,
      twitch_connected_at: workspace.twitch_connected_at,
      discord_guild_id: workspace.discord_guild_id,
      discord_connected_at: workspace.discord_connected_at,
      live_channel_id: workspace.live_channel_id,
      live_kanal_pref: workspace.settings_json?.kanalPreferanser?.live ?? null,
      onboarding_step: workspace.onboarding_step,
      onboarding_completed_at: workspace.onboarding_completed_at,
      alpha_enabled: workspace.alpha_enabled,
      created_at: workspace.created_at,
    } : null,
    checks,
    diagnosis,
    recentEvents: systemEvents.map(e => ({ type: e.event_type, title: e.title, at: e.created_at })),
  });
}
