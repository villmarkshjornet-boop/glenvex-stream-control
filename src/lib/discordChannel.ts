const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

let cachedChatKanalId: string | null = null;

export async function getChatKanalId(): Promise<string | null> {
  if (process.env.DISCORD_CHAT_CHANNEL_ID) return process.env.DISCORD_CHAT_CHANNEL_ID;
  if (cachedChatKanalId) return cachedChatKanalId;
  return autoDetectKanal(['chat', 'general', 'gaming', 'generelt', 'snakk', 'community']);
}

export async function getAnnonseringsKanalId(): Promise<string | null> {
  if (process.env.DISCORD_ANNOUNCE_CHANNEL_ID) return process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
  // Prøv annonsering-kanal først, fall tilbake til live-kanal, så chat
  const annonse = await autoDetectKanal(['annonsering', 'announce', 'kunngjøring', 'nyheter', 'live']);
  if (annonse) return annonse;
  if (process.env.DISCORD_LIVE_CHANNEL_ID) return process.env.DISCORD_LIVE_CHANNEL_ID;
  return getChatKanalId();
}

async function autoDetectKanal(prioritet: string[]): Promise<string | null> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_BOT_TOKEN) return null;

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
    if (!res.ok) return null;

    const kanaler = await res.json() as any[];
    const tekstKanaler = kanaler.filter((k: any) => k.type === 0);

    for (const søk of prioritet) {
      const funnet = tekstKanaler.find((k: any) => k.name.toLowerCase().includes(søk));
      if (funnet) return funnet.id;
    }

    const ekskluder = ['log', 'bot', 'admin', 'mod', 'staff', 'regel', 'velkomst'];
    return tekstKanaler.find((k: any) =>
      !ekskluder.some(e => k.name.toLowerCase().includes(e))
    )?.id ?? null;
  } catch {}
  return null;
}
