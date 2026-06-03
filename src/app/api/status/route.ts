import { NextResponse } from 'next/server';
import { getStreamInfo, checkTwitchApiHealth } from '@/lib/twitch';
import { getGuildInfo, checkDiscordBotHealth } from '@/lib/discord';
import { getLogs, countAlerts } from '@/lib/logger';
import { getSettings } from '@/lib/settings';
import type { StatusResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [twitchHealthy, discordHealthy, stream, guild] = await Promise.allSettled([
    checkTwitchApiHealth(),
    checkDiscordBotHealth(),
    getStreamInfo(),
    getGuildInfo(),
  ]);

  const logs = getLogs().slice(0, 20);
  const settings = getSettings();
  const totalAlerts = countAlerts();

  const lastNotificationLog = logs.find(
    (l) => l.type === 'success' && l.message.toLowerCase().includes('varsel')
  );

  const response: StatusResponse = {
    twitchApi:
      twitchHealthy.status === 'fulfilled' && twitchHealthy.value
        ? 'online'
        : 'error',
    discordBot:
      discordHealthy.status === 'fulfilled' && discordHealthy.value
        ? 'online'
        : 'error',
    stream:
      stream.status === 'fulfilled' ? stream.value : null,
    guild:
      guild.status === 'fulfilled' ? guild.value : null,
    lastNotification: lastNotificationLog?.timestamp ?? null,
    recentLogs: logs,
    totalAlerts,
    settings,
  };

  return NextResponse.json(response);
}
