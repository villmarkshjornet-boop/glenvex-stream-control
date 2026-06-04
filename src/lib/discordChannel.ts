import fs from 'fs';
import path from 'path';

const DISCORD_API = 'https://discord.com/api/v10';
const PREFS_FILE = path.join(process.cwd(), 'data', 'channel-settings.json');

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

function loadPrefs(): Record<string, string> {
  try {
    if (fs.existsSync(PREFS_FILE)) return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
  } catch {}
  return {};
}

// Kategorier som er spill/RP-spesifikke – ekskluderes fra generelle kanaler
const RP_KATEGORIER = ['future', 'rp', 'tarkov', 'gta', 'nxt', 'gaming', 'spill', 'game'];
const GENERELLE_KATEGORIER = ['informasjon', 'info', 'general', 'community', 'server', 'generelt', 'hoved'];

async function hentAlleKanaler() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_BOT_TOKEN) return [];
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
    if (!res.ok) return [];
    return await res.json() as any[];
  } catch { return []; }
}

function erRPKategori(kategorinavn: string): boolean {
  const navn = kategorinavn.toLowerCase();
  return RP_KATEGORIER.some(rp => navn.includes(rp));
}

function erGenerellKategori(kategorinavn: string): boolean {
  const navn = kategorinavn.toLowerCase();
  return GENERELLE_KATEGORIER.some(g => navn.includes(g));
}

async function autoDetektKanal(prioritet: string[]): Promise<string | null> {
  try {
    const alleKanaler = await hentAlleKanaler();
    const kategorier = new Map(alleKanaler.filter((k: any) => k.type === 4).map((k: any) => [k.id, k.name]));
    const tekstKanaler = alleKanaler.filter((k: any) => k.type === 0);

    // Ekskluder kanaler i RP/spill-kategorier
    const ikkeRpKanaler = tekstKanaler.filter((k: any) => {
      const katNavn = kategorier.get(k.parent_id) ?? '';
      return !erRPKategori(katNavn);
    });

    // Foretrekk kanaler i generelle kategorier
    const generelleKanaler = ikkeRpKanaler.filter((k: any) => {
      const katNavn = kategorier.get(k.parent_id) ?? '';
      return erGenerellKategori(katNavn);
    });

    const søkI = generelleKanaler.length > 0 ? generelleKanaler : ikkeRpKanaler;

    for (const søk of prioritet) {
      const funnet = søkI.find((k: any) => k.name.toLowerCase().includes(søk));
      if (funnet) return funnet.id;
    }

    const ekskluder = ['log', 'bot', 'admin', 'mod', 'staff', 'regel', 'velkomst'];
    return søkI.find((k: any) =>
      !ekskluder.some(e => k.name.toLowerCase().includes(e))
    )?.id ?? null;
  } catch { return null; }
}

// Hent kanal – preferanse → env → auto-detect
export async function getChatKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.chat) return prefs.chat;
  if (process.env.DISCORD_CHAT_CHANNEL_ID) return process.env.DISCORD_CHAT_CHANNEL_ID;
  return autoDetektKanal(['chat', 'general', 'gaming', 'generelt', 'snakk', 'community']);
}

export async function getAnnonseringsKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.announce) return prefs.announce;
  if (process.env.DISCORD_ANNOUNCE_CHANNEL_ID) return process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
  const auto = await autoDetektKanal(['annonsering', 'announce', 'kunngjøring', 'nyheter']);
  if (auto) return auto;
  if (process.env.DISCORD_LIVE_CHANNEL_ID) return process.env.DISCORD_LIVE_CHANNEL_ID;
  return getChatKanalId();
}

export async function getLiveKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.live) return prefs.live;
  if (process.env.DISCORD_LIVE_CHANNEL_ID) return process.env.DISCORD_LIVE_CHANNEL_ID;
  return autoDetektKanal(['live', 'stream', 'streaming']);
}

export async function getPartnerKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.partner) return prefs.partner;
  return getAnnonseringsKanalId();
}

export async function getStreamplanKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.streamplan) return prefs.streamplan;
  return getAnnonseringsKanalId();
}

export async function getClipsKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.clips) return prefs.clips;
  return autoDetektKanal(['klipp', 'clips', 'highlights', 'høydepunkter']);
}

export async function getEventsKanalId(): Promise<string | null> {
  const prefs = loadPrefs();
  if (prefs.events) return prefs.events;
  return getChatKanalId();
}
