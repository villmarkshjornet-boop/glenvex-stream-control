import type { StreamInfo, Settings, GuildInfo } from '@/types';

const DISCORD_API = 'https://discord.com/api/v10';

function getBotHeaders() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN mangler i .env');
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

interface WorkspaceEmbed {
  brandName: string;
  twitchLogin: string;
}

export async function postLiveEmbed(
  stream: StreamInfo,
  settings: Settings,
  ws?: WorkspaceEmbed
): Promise<void> {
  const channelId = settings.discordLiveChannelId;
  if (!channelId) {
    throw new Error('discordLiveChannelId er ikke konfigurert i innstillinger');
  }

  // Always use workspace identity — never fall back to GLENVEX hardcode
  const brand      = ws?.brandName   || stream.userName || 'Stream';
  const login      = ws?.twitchLogin || stream.userName || '';
  const twitchUrl  = login ? `https://twitch.tv/${login}` : (stream.streamUrl || '');

  const startedTs = stream.startedAt
    ? Math.floor(new Date(stream.startedAt).getTime() / 1000)
    : null;

  const embed = {
    title:       `🔴 ${brand.toUpperCase()} ER LIVE!`,
    description: 'Bli med nå – dette skjer bare én gang.',
    color: 0x00ff41,
    fields: [
      { name: '🎮 Spill',   value: stream.game || 'Ukjent',                    inline: true },
      { name: '👁️ Seere',  value: stream.viewerCount?.toString() || '–',       inline: true },
      { name: '​',          value: '​',                                           inline: true },
      { name: '📺 Tittel',  value: stream.title || 'Ingen tittel',              inline: false },
      ...(startedTs ? [{ name: '⏱️ Startet', value: `<t:${startedTs}:R>`, inline: true }] : []),
      ...(twitchUrl ? [{ name: '🔗 Se her', value: `[${twitchUrl}](${twitchUrl})`, inline: true }] : []),
    ],
    image:  stream.thumbnailUrl ? { url: stream.thumbnailUrl } : undefined,
    footer: { text: `${brand} Stream Control • Auto-varsel` },
    timestamp: new Date().toISOString(),
  };

  const payload: Record<string, unknown> = { embeds: [embed] };

  if (settings.pingRole && settings.discordLiveRoleId) {
    payload.content = `<@&${settings.discordLiveRoleId}>`;
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: getBotHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API feil ${res.status}: ${err}`);
  }
}

export async function getGuildInfo(): Promise<GuildInfo | null> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!process.env.DISCORD_BOT_TOKEN || !guildId) return null;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}?with_counts=true`,
      { headers: getBotHeaders() }
    );
    if (!res.ok) return null;
    return (await res.json()) as GuildInfo;
  } catch {
    return null;
  }
}

export async function checkDiscordBotHealth(): Promise<boolean> {
  try {
    const info = await getGuildInfo();
    return info !== null;
  } catch {
    return false;
  }
}
