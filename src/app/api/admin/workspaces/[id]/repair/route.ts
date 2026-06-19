import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import { evaluateIntegrationStatus } from '@/lib/integrationStatus';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const workspaceId = params.id;
  const body = await req.json().catch(() => ({})) as { forceAlpha?: boolean };
  const forceAlpha = body.forceAlpha === true;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { data: ws } = await db
    .from('workspaces')
    .select('id,brand_name,twitch_login,twitch_connected_at,twitch_access_token,twitch_refresh_token,discord_guild_id,discord_guild_name,discord_connected_at,live_channel_id,alpha_enabled,onboarding_completed_at,onboarding_step,settings_json,owner_user_id')
    .eq('id', workspaceId)
    .single();

  if (!ws) return NextResponse.json({ error: 'Workspace ikke funnet' }, { status: 404 });

  // Heartbeat check via system_events (last 12h) — single source of truth
  const cutoff12h = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const [twitchEvRes, discordEvRes] = await Promise.all([
    db.from('system_events').select('created_at').eq('workspace_id', workspaceId).eq('source', 'twitch_bot').gte('created_at', cutoff12h).order('created_at', { ascending: false }).limit(1),
    db.from('system_events').select('created_at').eq('workspace_id', workspaceId).eq('source', 'discord_bot').gte('created_at', cutoff12h).order('created_at', { ascending: false }).limit(1),
  ]);

  const twitchBotLastEventAt  = twitchEvRes.data?.[0]?.created_at  ?? null;
  const discordBotLastEventAt = discordEvRes.data?.[0]?.created_at ?? null;

  const status = evaluateIntegrationStatus({
    workspace: ws,
    twitchBotLastEventAt,
    discordBotLastEventAt,
  });

  const checks   = status.checks;
  const missing: string[] = [];
  if (!checks.twitchConnected)  missing.push('twitch_connection');
  if (!checks.discordConnected) missing.push('discord_connection');
  if (!checks.liveChannelSet)   missing.push('live_channel');

  const repairActions: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  // ── Backfill twitch_connected_at if bot is active but timestamp missing ──
  if (status.twitch.botWatching && !ws.twitch_connected_at) {
    const { error } = await db.from('workspaces').update({
      twitch_connected_at: now,
      updated_at: now,
    }).eq('id', workspaceId);
    if (error) {
      errors.push(`twitch_connected_at backfill: ${error.message}`);
    } else {
      repairActions.push('twitch_connected_at satt (bot var aktiv, timestamp manglet)');
      checks.twitchConnected = true;
      missing.splice(missing.indexOf('twitch_connection'), 1);
    }
  }

  // ── Backfill discord_connected_at if guild set + bot active ─────────────
  if (status.discord.botInGuild && ws.discord_guild_id && !ws.discord_connected_at) {
    const { error } = await db.from('workspaces').update({
      discord_connected_at: now,
      updated_at: now,
    }).eq('id', workspaceId);
    if (error) {
      errors.push(`discord_connected_at backfill: ${error.message}`);
    } else {
      repairActions.push('discord_connected_at satt (bot aktiv i guild, timestamp manglet)');
      checks.discordConnected = true;
      missing.splice(missing.indexOf('discord_connection'), 1);
    }
  }

  // ── Fix onboarding_completed_at if all prerequisites are now met ─────────
  if (missing.length === 0 && !checks.onboardingComplete) {
    const { error } = await db.from('workspaces').update({
      onboarding_completed_at: now,
      onboarding_step: 5,
      updated_at: now,
    }).eq('id', workspaceId);
    if (error) {
      errors.push(`onboarding_completed_at: ${error.message}`);
    } else {
      repairActions.push('onboarding_completed_at satt til nå');
      checks.onboardingComplete = true;
    }
  }

  // ── Enable alpha ─────────────────────────────────────────────────────────
  const shouldEnableAlpha = forceAlpha || (missing.length === 0 && checks.onboardingComplete);
  if (shouldEnableAlpha && !checks.alphaEnabled) {
    const { error } = await db.from('workspaces').update({
      alpha_enabled: true,
      updated_at: now,
    }).eq('id', workspaceId);
    if (error) {
      errors.push(`alpha_enabled: ${error.message}`);
    } else {
      repairActions.push('alpha_enabled satt til true');
      checks.alphaEnabled = true;

      if (ws.owner_user_id) {
        const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
        if (sbUrl && sbKey) {
          const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
          await admin.auth.admin.updateUserById(ws.owner_user_id as string, {
            user_metadata: { alpha_enabled: true, workspace_id: workspaceId, brand_name: ws.brand_name ?? workspaceId },
          }).catch((err: any) => errors.push(`user_metadata sync: ${err?.message?.slice(0, 80)}`));
          repairActions.push('user_metadata synkronisert (alpha_enabled + workspace_id)');
        }
      }
    }
  }

  // ── Always sync workspace_id in user_metadata ────────────────────────────
  if (checks.alphaEnabled && ws.owner_user_id && !repairActions.some(a => a.includes('user_metadata'))) {
    const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (sbUrl && sbKey) {
      const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await admin.auth.admin.updateUserById(ws.owner_user_id as string, {
        user_metadata: { workspace_id: workspaceId, brand_name: ws.brand_name ?? workspaceId, alpha_enabled: true },
      }).catch((err: any) => errors.push(`user_metadata workspace_id sync: ${err?.message?.slice(0, 80)}`));
      repairActions.push('user_metadata workspace_id synkronisert');
    }
  }

  const kanalPrefs = ((ws.settings_json as any)?.kanalPreferanser ?? {}) as Record<string, string>;
  const liveChannelId = kanalPrefs.live ?? ws.live_channel_id ?? null;
  const readyForRuntime = checks.twitchConnected && checks.discordConnected && checks.liveChannelSet && checks.onboardingComplete && checks.alphaEnabled;

  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'admin',
      event_type: 'WORKSPACE_REPAIR_RUN',
      title: `Repair for ${ws.brand_name ?? workspaceId}: ${repairActions.length ? repairActions.join(', ') : 'ingen endringer'}`,
      severity: repairActions.length > 0 ? 'info' : 'warning',
      metadata: {
        workspaceId, checks, missing, repairActions, errors, readyForRuntime,
        repairedBy: h.get('x-user-email'),
        twitchLogin: ws.twitch_login, discordGuildId: ws.discord_guild_id, liveChannelId,
        twitchBotActive: status.twitch.botWatching, discordBotActive: status.discord.botInGuild,
      },
    });
  } catch {}

  return NextResponse.json({
    ok: errors.length === 0,
    workspaceId,
    brandName: ws.brand_name,
    checks,
    missing,
    repairActions,
    errors,
    readyForRuntime,
    integrationStatus: status,
    nextStep: !readyForRuntime && missing.length > 0
      ? `Mangler: ${missing.join(', ')} — bruker må fullføre onboarding`
      : !readyForRuntime && !checks.alphaEnabled
      ? 'Alt koblet — bruk Alpha-toggle i admin for å aktivere, eller kjør repair med forceAlpha=true'
      : readyForRuntime
      ? 'Workspace er klart — bot plukker det opp innen 3 minutter'
      : null,
  });
}
