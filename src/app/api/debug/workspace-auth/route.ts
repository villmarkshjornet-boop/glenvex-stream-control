import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h           = headers();
  const userId      = h.get('x-user-id')      ?? null;
  const workspaceId = h.get('x-workspace-id') ?? null;

  if (!userId) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 });
  }

  const db = getDb();
  let broadcasterTokenExists  = false;
  let twitchConnected         = false;
  let discordConnected        = false;

  if (db && workspaceId) {
    const { data: ws } = await db
      .from('workspaces')
      .select('twitch_login, twitch_access_token, discord_guild_id, settings_json')
      .eq('id', workspaceId)
      .single();

    if (ws) {
      twitchConnected        = !!ws.twitch_login;
      broadcasterTokenExists = !!ws.twitch_access_token;
      discordConnected       = !!ws.discord_guild_id;
    }
  }

  return NextResponse.json({
    userId,
    workspaceId,
    twitchConnected,
    broadcasterTokenExists,
    discordConnected,
  });
}
