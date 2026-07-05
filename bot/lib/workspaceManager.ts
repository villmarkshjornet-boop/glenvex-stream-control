/**
 * WorkspaceManager — multi-tenant bot runtime.
 *
 * Laster alle aktive alpha-workspaces fra Supabase og kjører
 * live-sjekk for hvert workspace via den delte Discord-klienten.
 *
 * Aktive workspaces krever:
 *   alpha_enabled = true
 *   onboarding_completed_at NOT NULL
 *   twitch_login + twitch_connected_at
 *   discord_guild_id + discord_connected_at
 *   settings_json.kanalPreferanser.live (eller live_channel_id)
 *
 * Default-workspacet (WORKSPACE_ID env) håndteres av bot/index.ts —
 * WorkspaceManager ekskluderer det for å unngå dobbel live-sjekk.
 *
 * BOT_MODE=single_tenant deaktiverer WorkspaceManager (nødfallback).
 */

import type { Client } from 'discord.js';
import { WorkspaceRuntime, type WorkspaceConfig } from './workspaceRuntime';
import { logSystemEvent } from './systemEvents';

const LIVE_CHECK_INTERVAL_MS  = 2 * 60 * 1000;   // Live-sjekk hvert 2. min
const SYNC_INTERVAL_MS        = 3 * 60 * 1000;   // Sync nye workspaces hvert 3. min
const FAST_PICKUP_INTERVAL_MS = 30_000;           // Fast-pickup sjekk hvert 30. sek
const STAGGER_MS              = 8_000;            // 8s mellom hvert workspace (rate limit buffer)
const DEFAULT_WS              = process.env.WORKSPACE_ID ?? '';

const runtimes = new Map<string, WorkspaceRuntime>();

interface WorkspaceRow {
  id: string;
  brand_name: string | null;
  twitch_login: string | null;
  twitch_user_id: string | null;
  discord_guild_id: string | null;
  live_channel_id: string | null;
  settings_json: { kanalPreferanser?: Record<string, string> } | null;
  alpha_enabled: boolean | null;
  onboarding_completed_at: string | null;
  twitch_connected_at: string | null;
  discord_connected_at: string | null;
}

// ── Hent aktive workspaces fra Supabase ───────────────────────────────────────

export async function loadActiveWorkspaces(): Promise<WorkspaceConfig[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  try {
    const qs = new URLSearchParams({
      select: [
        'id', 'brand_name', 'twitch_login', 'twitch_user_id',
        'discord_guild_id', 'live_channel_id', 'settings_json',
        'alpha_enabled', 'onboarding_completed_at',
        'twitch_connected_at', 'discord_connected_at',
      ].join(','),
      alpha_enabled:              'eq.true',
      'onboarding_completed_at':  'not.is.null',
      id:                         `neq.${DEFAULT_WS}`,
    });

    const res = await fetch(`${url}/rest/v1/workspaces?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[WorkspaceManager] Supabase ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }

    const rows = await res.json() as WorkspaceRow[];
    const configs: WorkspaceConfig[] = [];

    for (const row of rows) {
      const skip = (reason: string) => {
        logSystemEvent({
          workspaceId: row.id,
          source: 'workspace_manager',
          event_type: 'WORKSPACE_SKIPPED',
          title: `Workspace ${row.brand_name ?? row.id} hoppet over: ${reason}`,
          severity: 'info',
          metadata: { workspaceId: row.id, reason },
        });
      };

      if (!row.twitch_login || !row.twitch_connected_at) {
        skip(`missing_twitch_connection (twitch_login=${row.twitch_login ?? 'null'}, connected_at=${row.twitch_connected_at ?? 'null'})`);
        continue;
      }
      if (!row.discord_guild_id || !row.discord_connected_at) {
        skip(`missing_discord_connection (guild_id=${row.discord_guild_id ?? 'null'}, connected_at=${row.discord_connected_at ?? 'null'})`);
        continue;
      }

      const kanalPrefs = row.settings_json?.kanalPreferanser ?? {};
      const liveChannelId = kanalPrefs.live ?? row.live_channel_id ?? '';

      if (!liveChannelId) {
        skip('missing_live_channel (ingen kanalPreferanser.live og ingen live_channel_id)');
        continue;
      }

      configs.push({
        workspaceId:     row.id,
        brandName:       row.brand_name ?? row.id,
        twitchLogin:     row.twitch_login,
        twitchUserId:    row.twitch_user_id ?? '',
        discordGuildId:  row.discord_guild_id,
        liveChannelId,
        chatChannelId:   kanalPrefs.chat ?? undefined,
        kanalPreferanser: kanalPrefs,
      });
    }

    return configs;
  } catch (err: any) {
    console.error('[WorkspaceManager] loadActiveWorkspaces feil:', err.message?.slice(0, 120));
    return [];
  }
}

// ── Sync: start nye, stopp deaktiverte, oppdater endrede ─────────────────────

async function syncWorkspaces(discordClient: Client): Promise<void> {
  logSystemEvent({
    source: 'workspace_manager',
    event_type: 'WORKSPACE_RUNTIME_LOADING',
    title: 'WorkspaceManager: laster aktive workspaces fra Supabase',
    severity: 'info',
    metadata: { currentRuntimes: runtimes.size, timestamp: new Date().toISOString() },
  });

  const configs = await loadActiveWorkspaces();
  const incoming = new Map(configs.map(c => [c.workspaceId, c]));

  // Stopp runtimes for workspaces som forsvant / ble deaktivert
  for (const [id, runtime] of runtimes) {
    if (!incoming.has(id)) {
      runtime.stop();
      runtimes.delete(id);
      console.log(`[WorkspaceManager] Runtime stoppet: ${id}`);
    }
  }

  // Start nye / oppdater eksisterende
  for (const [id, config] of incoming) {
    if (runtimes.has(id)) {
      runtimes.get(id)!.updateConfig(config);
    } else {
      const runtime = new WorkspaceRuntime(config);
      runtimes.set(id, runtime);
      runtime.start();
      console.log(`[WorkspaceManager] Runtime startet: ${id} (${config.brandName})`);
    }
  }
}

// ── Staggeret live-sjekk — kjøres per workspace med 8s mellomrom ────────────

async function runStaggeredLiveChecks(discordClient: Client): Promise<void> {
  const all = Array.from(runtimes.values());
  for (let i = 0; i < all.length; i++) {
    const runtime = all[i];
    setTimeout(() => {
      runtime.checkLive(discordClient).catch((err: any) => {
        logSystemEvent({
          workspaceId: runtime.workspaceId,
          source: 'workspace_manager',
          event_type: 'BOT_WORKSPACE_ERROR',
          title: `${runtime.config.brandName}: live-sjekk krasjet — ${err.message?.slice(0, 80)}`,
          severity: 'error',
          metadata: { workspaceId: runtime.workspaceId, error: err.message?.slice(0, 200) },
        });
      });
    }, i * STAGGER_MS);
  }
}

// ── Fast pickup: plukk opp nyaktiverte workspaces uten å vente på 3-min sync ──

async function checkForNewlyActivatedWorkspaces(discordClient: Client): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const cutoff10m = new Date(Date.now() - 10 * 60_000).toISOString();

    const qs = new URLSearchParams({
      select:     'workspace_id',
      event_type: 'eq.WORKSPACE_ONBOARDING_READY',
      created_at: `gte.${cutoff10m}`,
    });

    const res = await fetch(`${url}/rest/v1/system_events?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(`[WorkspaceManager] fast-pickup Supabase ${res.status}`);
      return;
    }

    const rows = await res.json() as { workspace_id: string }[];
    if (!rows.length) return;

    // Deduplicer — ett workspace kan ha flere events i vinduet
    const candidateIds = [...new Set(rows.map(r => r.workspace_id))];
    const newIds = candidateIds.filter(id => id && id !== DEFAULT_WS && !runtimes.has(id));

    if (newIds.length === 0) return;

    console.log(`[WorkspaceManager] Fast-pickup: ${newIds.length} nytt workspace(r) oppdaget — kjører sync`);

    await syncWorkspaces(discordClient);

    for (const wsId of newIds) {
      logSystemEvent({
        workspaceId: wsId,
        source: 'workspace_manager',
        event_type: 'WORKSPACE_FAST_PICKUP',
        title: `Fast-pickup: workspace ${wsId} plukket opp via WORKSPACE_ONBOARDING_READY`,
        severity: 'info',
        metadata: { workspaceId: wsId, timestamp: new Date().toISOString() },
      });
    }
  } catch (err: any) {
    // Aldri krasj WorkspaceManager på grunn av fast-pickup
    console.error('[WorkspaceManager] fast-pickup feil:', err.message?.slice(0, 120));
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function startWorkspaceManager(discordClient: Client): void {
  const mode = process.env.BOT_MODE ?? 'multi_tenant';

  if (mode === 'single_tenant') {
    console.log('  ℹ️  BOT_MODE=single_tenant — WorkspaceManager deaktivert (kun default workspace)');
    return;
  }

  console.log('  ✓ WorkspaceManager startet (multi-tenant · eksluderer default:', DEFAULT_WS, ')');

  // Vent 20s på at Discord-klienten er ferdig initialisert
  setTimeout(async () => {
    await syncWorkspaces(discordClient).catch(err =>
      console.error('[WorkspaceManager] Initial sync feil:', err.message)
    );

    // Initial live-sjekk
    await runStaggeredLiveChecks(discordClient).catch(() => {});

    logSystemEvent({
      source: 'workspace_manager',
      event_type: 'BOT_MULTI_TENANT_STARTED',
      title: `Multi-tenant bot startet: ${runtimes.size} ekstra workspace(s)`,
      severity: 'info',
      metadata: {
        workspaceCount:    runtimes.size,
        enabledWorkspaces: Array.from(runtimes.keys()),
        defaultWorkspace:  DEFAULT_WS,
        timestamp:         new Date().toISOString(),
      },
    });

    console.log(`[WorkspaceManager] ${runtimes.size} ekstra workspace(r) aktive`);

    // Periodisk live-sjekk
    setInterval(() => runStaggeredLiveChecks(discordClient).catch(() => {}), LIVE_CHECK_INTERVAL_MS);

    // Periodisk sync — oppdager nye alpha-testere uten restart
    setInterval(() => syncWorkspaces(discordClient).catch(() => {}), SYNC_INTERVAL_MS);

    // Fast-pickup — sjekker hvert 30. sekund for nyaktiverte workspaces
    // (WORKSPACE_ONBOARDING_READY-event) for å unngå opptil 3 minutters ventetid
    setInterval(() => checkForNewlyActivatedWorkspaces(discordClient).catch(() => {}), FAST_PICKUP_INTERVAL_MS);

  }, 20_000);
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getActiveRuntimes(): WorkspaceRuntime[] {
  return Array.from(runtimes.values());
}

export function getActiveWorkspaceCount(): number {
  return runtimes.size;
}
