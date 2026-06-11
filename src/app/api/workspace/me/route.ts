import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h   = headers();
  const wsId = h.get('x-workspace-id');
  if (!wsId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db_unavailable' }, { status: 500 });

  const { data } = await db
    .from('workspaces')
    .select('id,brand_name,streamer_name,twitch_display_name,twitch_login,twitch_profile_image,twitch_connected_at,discord_connected_at')
    .eq('id', wsId)
    .single();

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id:                  data.id,
    brandName:           data.brand_name           ?? null,
    streamerName:        data.streamer_name         ?? null,
    twitchDisplayName:   data.twitch_display_name   ?? null,
    twitchLogin:         data.twitch_login           ?? null,
    twitchProfileImage:  data.twitch_profile_image  ?? null,
    twitchConnected:     !!data.twitch_connected_at,
    discordConnected:    !!data.discord_connected_at,
  });
}
