import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email   = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function GET() {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const [wsRes, eventsRes] = await Promise.allSettled([
    db.from('workspaces')
      .select('id,brand_name,streamer_name,twitch_login,twitch_display_name,twitch_connected_at,discord_guild_id,discord_guild_name,discord_connected_at,alpha_enabled,onboarding_completed_at,onboarding_step,created_at,updated_at,owner_user_id,plan')
      .order('created_at', { ascending: false })
      .limit(200),

    db.from('system_events')
      .select('workspace_id,event_type,title,severity,created_at')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const workspaces   = wsRes.status === 'fulfilled' ? (wsRes.value?.data ?? []) : [];
  const allEvents    = eventsRes.status === 'fulfilled' ? (eventsRes.value?.data ?? []) : [];

  // Build per-workspace summary: last event, last error
  const lastEventByWs: Record<string, any>  = {};
  const lastErrorByWs: Record<string, any>  = {};
  for (const ev of allEvents) {
    const wId = ev.workspace_id as string;
    if (!lastEventByWs[wId]) lastEventByWs[wId] = ev;
    if (ev.severity === 'error' && !lastErrorByWs[wId]) lastErrorByWs[wId] = ev;
  }

  const result = workspaces.map((ws: any) => ({
    id:                    ws.id,
    brandName:             ws.brand_name,
    streamerName:          ws.streamer_name,
    twitchLogin:           ws.twitch_login,
    twitchDisplayName:     ws.twitch_display_name,
    twitchConnectedAt:     ws.twitch_connected_at,
    discordGuildId:        ws.discord_guild_id,
    discordGuildName:      ws.discord_guild_name,
    discordConnectedAt:    ws.discord_connected_at,
    alphaEnabled:          !!ws.alpha_enabled,
    onboardingComplete:    !!ws.onboarding_completed_at,
    onboardingStep:        ws.onboarding_step ?? 0,
    plan:                  ws.plan,
    createdAt:             ws.created_at,
    updatedAt:             ws.updated_at,
    ownerUserId:           ws.owner_user_id,
    lastEvent:             lastEventByWs[ws.id] ?? null,
    lastError:             lastErrorByWs[ws.id] ?? null,
  }));

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

  // Update workspace table
  const { error: dbErr } = await db.from('workspaces')
    .update({ alpha_enabled, updated_at: new Date().toISOString() })
    .eq('id', workspaceId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // Update Supabase user_metadata so JWT picks it up on next refresh
  const { data: ws } = await db.from('workspaces').select('owner_user_id').eq('id', workspaceId).single();
  if (ws?.owner_user_id) {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (supabaseUrl && supabaseKey) {
      const admin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await admin.auth.admin.updateUserById(ws.owner_user_id, {
        user_metadata: { alpha_enabled },
      }).catch(err => console.error('[admin/workspaces PATCH] metadata update failed:', err.message));
    }
  }

  // Observability
  try { await db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'admin',
    event_type: alpha_enabled ? 'ALPHA_READY' : 'ALPHA_DISABLED',
    title: alpha_enabled ? `Alpha aktivert for ${workspaceId}` : `Alpha deaktivert for ${workspaceId}`,
    severity: 'info',
    metadata: { workspaceId, alpha_enabled, changedBy: h.get('x-user-email') },
  }); } catch {}

  return NextResponse.json({ ok: true, workspaceId, alpha_enabled });
}
