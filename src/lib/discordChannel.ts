const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

let cachedChatKanalId: string | null = null;

export async function getChatKanalId(): Promise<string | null> {
  // 1. Eksplisitt satt i env
  if (process.env.DISCORD_CHAT_CHANNEL_ID) return process.env.DISCORD_CHAT_CHANNEL_ID;

  // 2. Cachet fra forrige kall
  if (cachedChatKanalId) return cachedChatKanalId;

  // 3. Auto-detect fra Discord
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_BOT_TOKEN) return null;

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
    if (!res.ok) return null;

    const kanaler = await res.json() as any[];
    const tekstKanaler = kanaler.filter((k: any) => k.type === 0); // Kun tekstkanaler

    // Prioritert søk
    const prioritet = ['chat', 'general', 'gaming', 'generelt', 'snakk', 'community'];
    for (const søk of prioritet) {
      const funnet = tekstKanaler.find((k: any) => k.name.toLowerCase().includes(søk));
      if (funnet) {
        cachedChatKanalId = funnet.id;
        return funnet.id;
      }
    }

    // Fallback: første tekstkanal som ikke er system/logs/bot
    const ekskluder = ['log', 'bot', 'admin', 'mod', 'staff', 'announce', 'regel', 'info', 'velkomst'];
    const fallback = tekstKanaler.find((k: any) =>
      !ekskluder.some(e => k.name.toLowerCase().includes(e))
    );
    if (fallback) {
      cachedChatKanalId = fallback.id;
      return fallback.id;
    }
  } catch {}

  return null;
}
