/**
 * WorkspaceManager – laster alle aktive workspaces fra Supabase og
 * starter en WorkspaceBot-instans per workspace (unntatt default-workspace
 * som håndteres av bot/index.ts direkte).
 *
 * Poller Supabase hvert 5. minutt for nye workspaces.
 */

import { WorkspaceBot, type WorkspaceBotConfig } from './workspaceBot';

const DEFAULT_WS = process.env.WORKSPACE_ID ?? 'glenvex-default';

const activeBots = new Map<string, WorkspaceBot>();

interface WorkspaceRow {
  id: string;
  brand_name: string | null;
  streamer_name: string | null;
  twitch_channel_name: string | null;
  discord_guild_id: string | null;
  live_channel_id: string | null;
  settings_json: {
    credentials?: {
      discordBotToken?: string;
      discordGuildId?: string;
      discordLiveChannelId?: string;
      discordChatChannelId?: string;
      discordInviteUrl?: string;
      twitchClientId?: string;
      twitchClientSecret?: string;
    };
  } | null;
}

async function loadWorkspaces(): Promise<WorkspaceBotConfig[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  try {
    const qs = new URLSearchParams({
      select: 'id,brand_name,streamer_name,twitch_channel_name,discord_guild_id,live_channel_id,settings_json',
      'owner_user_id': 'not.is.null',
      'id': `neq.${DEFAULT_WS}`,
    });
    const res = await fetch(`${url}/rest/v1/workspaces?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(`[WorkspaceManager] Supabase feil ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }
    const rows = await res.json() as WorkspaceRow[];

    return rows.flatMap((row): WorkspaceBotConfig[] => {
      const creds = row.settings_json?.credentials;
      const twitchChannel = row.twitch_channel_name ?? row.streamer_name;
      if (!creds?.discordBotToken || !twitchChannel) return [];

      return [{
        workspaceId:          row.id,
        brandName:            row.brand_name ?? row.id,
        twitchChannel,
        discordBotToken:      creds.discordBotToken,
        discordGuildId:       row.discord_guild_id ?? creds.discordGuildId ?? '',
        discordLiveChannelId: creds.discordLiveChannelId ?? row.live_channel_id ?? undefined,
        discordChatChannelId: creds.discordChatChannelId ?? undefined,
        discordInviteUrl:     creds.discordInviteUrl ?? undefined,
        twitchClientId:       creds.twitchClientId ?? undefined,
        twitchClientSecret:   creds.twitchClientSecret ?? undefined,
      }];
    });
  } catch (err: any) {
    console.error('[WorkspaceManager] loadWorkspaces feil:', err.message?.slice(0, 120));
    return [];
  }
}

async function syncWorkspaces() {
  const configs = await loadWorkspaces();
  const activeIds = new Set(configs.map(c => c.workspaceId));

  // Stopp bots for workspaces som er fjernet
  for (const [id, bot] of activeBots) {
    if (!activeIds.has(id)) {
      console.log(`[WorkspaceManager] Stopper bot: ${id}`);
      bot.stop();
      activeBots.delete(id);
    }
  }

  // Start bots for nye workspaces
  for (const config of configs) {
    if (activeBots.has(config.workspaceId)) continue;

    console.log(`[WorkspaceManager] Starter bot: ${config.workspaceId} (${config.brandName})`);
    const bot = new WorkspaceBot(config);
    activeBots.set(config.workspaceId, bot);

    bot.start().catch((err: any) => {
      console.error(`[WorkspaceManager] ${config.workspaceId} oppstart feilet:`, err.message?.slice(0, 120));
      activeBots.delete(config.workspaceId);
    });
  }

  if (configs.length > 0) {
    console.log(`[WorkspaceManager] ${configs.length} aktive workspace-bot(er) + default (${DEFAULT_WS})`);
  }
}

export function startWorkspaceManager(): void {
  console.log('  ✓ WorkspaceManager startet (poller nye workspaces hvert 5. min)');

  // Vent 15s så default-boten rekker å initialisere tmi.js-klienten
  setTimeout(async () => {
    await syncWorkspaces().catch(err =>
      console.error('[WorkspaceManager] Initial sync feil:', err.message)
    );
    setInterval(() => syncWorkspaces().catch(() => {}), 5 * 60 * 1000);
  }, 15_000);
}

/** Returner antall aktive workspace-bots (utenom default). */
export function getActiveWorkspaceCount(): number {
  return activeBots.size;
}
