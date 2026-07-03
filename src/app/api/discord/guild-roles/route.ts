import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/discord/guild-roles
 * Returns the list of roles in the workspace's Discord guild.
 * Used by the dashboard role-sync settings to populate dropdowns.
 */
export async function GET() {
  const h           = headers();
  const workspaceId = h.get('x-workspace-id');
  if (!workspaceId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });

  // Fetch bot token + guild ID from workspace
  const { data: ws } = await db
    .from('workspaces')
    .select('discord_guild_id')
    .eq('id', workspaceId)
    .maybeSingle();

  const guildId  = ws?.discord_guild_id as string | null;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !botToken) {
    return NextResponse.json({ error: 'discord_not_configured', roles: [] });
  }

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ error: 'discord_api_error', status: res?.status, roles: [] });
  }

  const raw = await res.json() as Array<{ id: string; name: string; position: number; color: number; managed: boolean }>;

  // Exclude managed (integration) roles and @everyone
  const roles = raw
    .filter(r => !r.managed && r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.color }));

  return NextResponse.json({ roles });
}
