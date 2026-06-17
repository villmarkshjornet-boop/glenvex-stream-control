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
    .select('id,brand_name,twitch_login,twitch_connected_at,discord_guild_id,discord_connected_at,live_channel_id,alpha_enabled,onboarding_completed_at,onboarding_step,settings_json,owner_user_id')
    .eq('id', workspaceId)
    .single();

  if (!ws) return NextResponse.json({ error: 'Workspace ikke funnet' }, { status: 404 });

  const kanalPrefs = ((ws.settings_json as any)?.kanalPreferanser ?? {}) as Record<string, string>;
  const liveChannelId = kanalPrefs.live ?? ws.live_channel_id ?? null;

  const checks = {
    twitchConnected:   !!ws.twitch_connected_at && !!ws.twitch_login,
    discordConnected:  !!ws.discord_connected_at && !!ws.discord_guild_id,
    liveChannelSet:    !!liveChannelId,
    onboardingComplete: !!ws.onboarding_completed_at,
    alphaEnabled:      !!ws.alpha_enabled,
  };

  const missing: string[] = [];
  if (!checks.twitchConnected)  missing.push('twitch_connection');
  if (!checks.discordConnected) missing.push('discord_connection');
  if (!checks.liveChannelSet)   missing.push('live_channel');

  const repairActions: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Fix onboarding_completed_at if all connection prerequisites are met
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

  // Enable alpha if forceAlpha OR all conditions now met
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

      // Sync til user_metadata så JWT plukker det opp ved neste refresh
      if (ws.owner_user_id) {
        const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
        if (sbUrl && sbKey) {
          const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
          await admin.auth.admin.updateUserById(ws.owner_user_id as string, {
            user_metadata: { alpha_enabled: true },
          }).catch((err: any) => errors.push(`user_metadata sync: ${err?.message?.slice(0, 80)}`));
          repairActions.push('user_metadata synkronisert (alpha_enabled)');
        }
      }
    }
  }

  const readyForRuntime = checks.twitchConnected && checks.discordConnected && checks.liveChannelSet && checks.onboardingComplete && checks.alphaEnabled;

  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'admin',
      event_type: 'WORKSPACE_REPAIR_RUN',
      title: `Repair for ${ws.brand_name ?? workspaceId}: ${repairActions.length ? repairActions.join(', ') : 'ingen endringer — mangler prerequisites'}`,
      severity: repairActions.length > 0 ? 'info' : 'warning',
      metadata: {
        workspaceId,
        checks,
        missing,
        repairActions,
        errors,
        readyForRuntime,
        repairedBy: h.get('x-user-email'),
        twitchLogin: ws.twitch_login,
        discordGuildId: ws.discord_guild_id,
        liveChannelId,
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
    nextStep: !readyForRuntime && missing.length > 0
      ? `Mangler: ${missing.join(', ')} — bruker må fullføre onboarding`
      : !readyForRuntime && !checks.alphaEnabled
      ? 'Alt koblet — bruk Alpha-toggle i admin for å aktivere, eller kjør repair med forceAlpha=true'
      : readyForRuntime
      ? 'Workspace er klart — bot plukker det opp innen 3 minutter'
      : null,
  });
}
