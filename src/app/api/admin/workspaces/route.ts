import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function GET() {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const [wsRes, eventsRes, vodsRes, snapshotsRes] = await Promise.allSettled([
    db.from('workspaces')
      .select('id,brand_name,streamer_name,twitch_login,twitch_user_id,twitch_display_name,twitch_connected_at,discord_guild_id,discord_guild_name,discord_connected_at,live_channel_id,alpha_enabled,onboarding_completed_at,onboarding_step,created_at,updated_at,owner_user_id,plan,settings_json')
      .order('created_at', { ascending: false })
      .limit(200),

    db.from('system_events')
      .select('workspace_id,source,event_type,title,severity,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(5000),

    db.from('content_vods')
      .select('id,workspace_id,title,status,created_at,updated_at,twitch_vod_id')
      .order('created_at', { ascending: false })
      .limit(500),

    db.from('ai_agent_events')
      .select('workspace_id,event_type,metadata,created_at')
      .eq('event_type', 'AUDIENCE_SNAPSHOT')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const workspaces    = wsRes.status        === 'fulfilled' ? (wsRes.value?.data        ?? []) : [];
  const allEvents     = eventsRes.status    === 'fulfilled' ? (eventsRes.value?.data    ?? []) : [];
  const allVods       = vodsRes.status      === 'fulfilled' ? (vodsRes.value?.data      ?? []) : [];
  const allSnapshots  = snapshotsRes.status === 'fulfilled' ? (snapshotsRes.value?.data ?? []) : [];

  // Build per-workspace event maps — single pass
  const lastEventByWs:     Record<string, any> = {};
  const lastErrorByWs:     Record<string, any> = {};
  const audienceHbByWs:    Record<string, any> = {};
  const botHbByWs:         Record<string, any> = {};
  const lastStreamByWs:    Record<string, any> = {};
  const lastStreamEndByWs: Record<string, any> = {};
  const coachReportByWs:   Record<string, any> = {};

  const BOT_HB_SOURCES = new Set(['twitch_bot', 'workspace_manager', 'discord_bot', 'recovery_engine']);

  for (const ev of allEvents) {
    const wId = ev.workspace_id as string;
    if (!wId) continue;
    if (!lastEventByWs[wId]) lastEventByWs[wId] = ev;
    if (ev.severity === 'error' && !lastErrorByWs[wId]) lastErrorByWs[wId] = ev;
    if (ev.event_type === 'AUDIENCE_TRACKING_HEARTBEAT' && !audienceHbByWs[wId]) audienceHbByWs[wId] = ev;
    if (ev.event_type === 'HEARTBEAT' && BOT_HB_SOURCES.has(ev.source) && !botHbByWs[wId]) botHbByWs[wId] = ev;
    if (ev.event_type === 'TWITCH_LIVE_DETECTED' && !lastStreamByWs[wId]) lastStreamByWs[wId] = ev;
    if (ev.event_type === 'TWITCH_OFFLINE_DETECTED' && !lastStreamEndByWs[wId]) lastStreamEndByWs[wId] = ev;
    if (ev.event_type === 'COACH_REPORT_GENERATED' && !coachReportByWs[wId]) coachReportByWs[wId] = ev;
  }

  // Content vods per workspace
  const cfActiveByWs:  Record<string, number> = {};
  const cfFailedByWs:  Record<string, number> = {};
  const cfQueuedByWs:  Record<string, number> = {};
  const cfLastVodByWs: Record<string, any>    = {};

  for (const vod of allVods) {
    const wId = vod.workspace_id as string;
    if (!wId) continue;
    if (!cfLastVodByWs[wId]) cfLastVodByWs[wId] = vod;
    if (vod.status === 'ANALYZING') cfActiveByWs[wId] = (cfActiveByWs[wId] ?? 0) + 1;
    if (vod.status === 'FAILED')    cfFailedByWs[wId] = (cfFailedByWs[wId] ?? 0) + 1;
    if (vod.status === 'PENDING' || vod.status === 'QUEUED') cfQueuedByWs[wId] = (cfQueuedByWs[wId] ?? 0) + 1;
  }

  // Latest audience snapshot per workspace
  const snapshotByWs: Record<string, any> = {};
  for (const ev of allSnapshots) {
    const wId = ev.workspace_id as string;
    if (!wId) continue;
    if (!snapshotByWs[wId]) snapshotByWs[wId] = ev;
  }

  const result = workspaces.map((ws: any) => {
    const kanalPrefs = (ws.settings_json?.kanalPreferanser ?? {}) as Record<string, string>;
    const liveChannelId = kanalPrefs.live ?? ws.live_channel_id ?? null;
    return {
      id:                     ws.id,
      brandName:              ws.brand_name,
      streamerName:           ws.streamer_name,
      twitchLogin:            ws.twitch_login,
      twitchUserId:           ws.twitch_user_id,
      twitchDisplayName:      ws.twitch_display_name,
      twitchConnectedAt:      ws.twitch_connected_at,
      discordGuildId:         ws.discord_guild_id,
      discordGuildName:       ws.discord_guild_name,
      discordConnectedAt:     ws.discord_connected_at,
      liveChannelId,
      kanalPrefs,
      alphaEnabled:           !!ws.alpha_enabled,
      onboardingComplete:     !!ws.onboarding_completed_at,
      onboardingCompletedAt:  ws.onboarding_completed_at,
      onboardingStep:         ws.onboarding_step ?? 0,
      plan:                   ws.plan,
      createdAt:              ws.created_at,
      ownerUserId:            ws.owner_user_id,

      lastEvent:       lastEventByWs[ws.id]     ?? null,
      lastError:       lastErrorByWs[ws.id]     ?? null,
      audienceHb:      audienceHbByWs[ws.id]    ?? null,
      botHb:           botHbByWs[ws.id]         ?? null,
      lastStream:      lastStreamByWs[ws.id]    ?? null,
      lastStreamEnd:   lastStreamEndByWs[ws.id] ?? null,
      coachReport:     coachReportByWs[ws.id]   ?? null,

      cfActive:   cfActiveByWs[ws.id]  ?? 0,
      cfFailed:   cfFailedByWs[ws.id]  ?? 0,
      cfQueued:   cfQueuedByWs[ws.id]  ?? 0,
      cfLastVod:  cfLastVodByWs[ws.id] ?? null,

      audienceSnapshot: snapshotByWs[ws.id] ?? null,
    };
  });

  return NextResponse.json({ workspaces: result, total: result.length });
}

export async function PATCH(req: NextRequest) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const { workspaceId, alpha_enabled } = await req.json() as { workspaceId: string; alpha_enabled: boolean };
  if (!workspaceId || typeof alpha_enabled !== 'boolean') {
    return NextResponse.json({ error: 'workspaceId og alpha_enabled påkrevd' }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { error: dbErr } = await db.from('workspaces')
    .update({ alpha_enabled, updated_at: new Date().toISOString() })
    .eq('id', workspaceId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const { data: ws } = await db.from('workspaces').select('owner_user_id').eq('id', workspaceId).single();
  if (ws?.owner_user_id) {
    const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (sbUrl && sbKey) {
      const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await admin.auth.admin.updateUserById(ws.owner_user_id, {
        user_metadata: { alpha_enabled },
      }).catch(err => console.error('[admin PATCH] user_metadata feil:', err.message));
    }
  }

  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'admin',
      event_type: alpha_enabled ? 'ALPHA_READY' : 'ALPHA_DISABLED',
      title: alpha_enabled ? `Alpha aktivert for ${workspaceId}` : `Alpha deaktivert for ${workspaceId}`,
      severity: 'info',
      metadata: { workspaceId, alpha_enabled, changedBy: h.get('x-user-email') },
    });
  } catch {}

  return NextResponse.json({ ok: true, workspaceId, alpha_enabled });
}
