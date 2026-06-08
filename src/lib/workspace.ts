import { headers } from 'next/headers';
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
  settings_json?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function getWorkspaceId(): string {
  // Try to read from request headers (injected by middleware for authenticated users)
  try {
    const h = headers();
    const wsId = h.get('x-workspace-id');
    if (wsId) return wsId;
  } catch {
    // headers() throws outside of request context (e.g. bot/Railway)
  }
  // Fallback: env var (used by Railway bot and local dev)
  return process.env.WORKSPACE_ID ?? 'glenvex-default';
}

export async function getOrCreateWorkspace(): Promise<Workspace> {
  const wsId = getWorkspaceId();
  const defaultWs: Workspace = {
    id: wsId,
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

  const existing = await dbSelect<Workspace>('workspaces', { id: wsId });
  if (existing.length > 0) return existing[0];

  const created = await dbUpsert<Workspace>('workspaces', defaultWs, 'id');
  return created ?? defaultWs;
}
