import { dbSelect, dbInsert, dbUpsert, isDbAvailable } from './db';

export interface Workspace {
  id: string;
  owner_user_id: string;
  streamer_name: string;
  brand_name: string;
  twitch_channel_id?: string;
  twitch_channel_name: string;
  discord_guild_id?: string;
  discord_guild_name?: string;
  live_channel_id?: string;
  promo_channel_id?: string;
  clips_channel_id?: string;
  partner_channel_id?: string;
  bot_personality: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

// For now, a single default workspace backed by env vars
const DEFAULT_WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

export function getWorkspaceId(): string {
  return DEFAULT_WORKSPACE_ID;
}

export async function getOrCreateWorkspace(): Promise<Workspace> {
  const defaultWs: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    owner_user_id: 'glenvex',
    streamer_name: process.env.TWITCH_USERNAME ?? 'glenvex',
    brand_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'GLENVEX Stream Control',
    twitch_channel_name: process.env.TWITCH_USERNAME ?? 'glenvex',
    twitch_channel_id: undefined,
    discord_guild_id: process.env.DISCORD_GUILD_ID,
    live_channel_id: process.env.DISCORD_LIVE_CHANNEL_ID,
    promo_channel_id: process.env.DISCORD_CHAT_CHANNEL_ID,
    bot_personality: 'dark_gaming',
    plan: 'creator',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!isDbAvailable()) return defaultWs;

  const existing = await dbSelect<Workspace>('workspaces', { id: DEFAULT_WORKSPACE_ID });
  if (existing.length > 0) return existing[0];

  const created = await dbUpsert<Workspace>('workspaces', defaultWs, 'id');
  return created ?? defaultWs;
}
