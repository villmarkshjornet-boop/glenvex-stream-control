import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  // Valider at alle forutsetninger er oppfylt før onboarding markeres fullført.
  // Uten dette kan en bruker hoppe til steg 5 uten å ha koblet Twitch/Discord,
  // og WorkspaceManager vil hoppe over dem med 'missing_twitch_connection'.
  const { data: ws } = await db.from('workspaces')
    .select('twitch_connected_at,twitch_login,discord_connected_at,discord_guild_id,settings_json,live_channel_id')
    .eq('id', workspaceId)
    .single();

  const kanalPrefs = ((ws?.settings_json as any)?.kanalPreferanser ?? {}) as Record<string, string>;
  const liveChannelId = kanalPrefs.live ?? ws?.live_channel_id ?? null;

  const missing: string[] = [];
  if (!ws?.twitch_connected_at || !ws?.twitch_login) missing.push('twitch');
  if (!ws?.discord_connected_at || !ws?.discord_guild_id) missing.push('discord');
  if (!liveChannelId) missing.push('live_channel');

  if (missing.length > 0) {
    try { await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'onboarding',
      event_type: 'ONBOARDING_INCOMPLETE',
      title: `Onboarding avvist — mangler: ${missing.join(', ')}`,
      severity: 'warning',
      metadata: { workspaceId, missing, twitchLogin: ws?.twitch_login, discordGuildId: ws?.discord_guild_id, liveChannelId },
    }); } catch {}
    return NextResponse.json({ error: `Onboarding ufullstendig — mangler: ${missing.join(', ')}`, missing }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await db.from('workspaces').update({
    onboarding_completed_at: now,
    onboarding_step: 5,
    alpha_enabled: true,   // WorkspaceManager requires this to pick up the workspace
    updated_at: now,
  }).eq('id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try { await db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'onboarding',
    event_type: 'ONBOARDING_COMPLETED',
    title: `Onboarding fullført for workspace ${workspaceId}`,
    severity: 'info',
    metadata: { workspaceId, completedAt: now, twitchLogin: ws?.twitch_login, discordGuildId: ws?.discord_guild_id, liveChannelId },
  }); } catch {}

  // Fast-notify: skriv WORKSPACE_ONBOARDING_READY med severity 'critical' så
  // WorkspaceManager sin 30-sekunders poll kan plukke opp workspace'et umiddelbart
  // istedenfor å vente på den ordinære 3-minutters sync-syklusen.
  try { await db.from('system_events').insert({
    workspace_id: workspaceId,
    source: 'onboarding',
    event_type: 'WORKSPACE_ONBOARDING_READY',
    title: `Workspace ${workspaceId} klar for bot-oppstart (fast-pickup)`,
    severity: 'critical',
    metadata: { alpha_enabled: true, source: 'onboarding_activate', completedAt: now },
  }); } catch {}

  return NextResponse.json({ ok: true });
}
