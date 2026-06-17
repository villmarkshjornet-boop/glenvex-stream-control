import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h           = headers();
  const userId      = h.get('x-user-id');
  const workspaceId = h.get('x-workspace-id');

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'db unavailable' }, { status: 500 });

  // Find workspace — prefer JWT workspace_id, fall back to owner lookup
  let ws: any = null;
  if (workspaceId) {
    const { data } = await db.from('workspaces').select('*').eq('id', workspaceId).single();
    ws = data;
  } else if (userId) {
    const { data } = await db.from('workspaces').select('*').eq('owner_user_id', userId).limit(1).single();
    ws = data;
  }

  if (!ws) {
    return NextResponse.json({
      workspaceId: null,
      twitchConnected: false,
      discordConnected: false,
      channelsSaved: false,
      onboardingComplete: false,
      alphaEnabled: false,
      currentStep: 1,
    });
  }

  const twitchConnected  = !!ws.twitch_connected_at;
  const discordConnected = !!ws.discord_connected_at;
  const channelsSaved    = !!(ws.settings_json?.kanalPreferanser?.live || ws.live_channel_id);
  const onboardingComplete = !!ws.onboarding_completed_at;

  // Workspace eksisterer → brukeren er forbi steg 1 selv om Twitch/Discord mangler.
  // Uten dette viser onboarding-siden steg 1 på nytt og brukeren havner i en loop.
  let currentStep = ws ? 2 : 1;
  if (twitchConnected)    currentStep = 3;
  if (discordConnected)   currentStep = 4;
  if (channelsSaved)      currentStep = 5;
  if (onboardingComplete) currentStep = 5;

  return NextResponse.json({
    workspaceId:       ws.id,
    brandName:         ws.brand_name,
    twitchConnected,
    twitchLogin:       ws.twitch_login ?? null,
    twitchDisplayName: ws.twitch_display_name ?? null,
    twitchProfileImage: ws.twitch_profile_image ?? null,
    discordConnected,
    guildId:           ws.discord_guild_id ?? null,
    guildName:         ws.discord_guild_name ?? null,
    channelsSaved,
    onboardingComplete,
    alphaEnabled:      !!ws.alpha_enabled,
    currentStep,
  });
}
