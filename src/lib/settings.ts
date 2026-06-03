import fs from 'fs';
import path from 'path';
import type { Settings } from '@/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS: Settings = {
  discordLiveChannelId: process.env.DISCORD_LIVE_CHANNEL_ID || '',
  discordLiveRoleId: process.env.DISCORD_LIVE_ROLE_ID || '',
  twitchUsername: process.env.TWITCH_USERNAME || 'glenvex',
  twitchUrl: process.env.TWITCH_URL || 'https://twitch.tv/glenvex',
  autoPostLive: true,
  autoPostPromo: false,
  pingRole: true,
  socials: {
    twitch: process.env.TWITCH_URL || 'https://twitch.tv/glenvex',
  },
  lastNotifiedStreamId: null,
};

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getSettings(): Settings {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaults = buildDefaults();
    writeSettingsFile(defaults);
    return defaults;
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...buildDefaults(), ...JSON.parse(raw) };
  } catch {
    return buildDefaults();
  }
}

export function saveSettings(partial: Partial<Settings>): Settings {
  ensureDataDir();
  const current = getSettings();
  const updated: Settings = { ...current, ...partial };
  writeSettingsFile(updated);
  return updated;
}

function buildDefaults(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    discordLiveChannelId: process.env.DISCORD_LIVE_CHANNEL_ID || DEFAULT_SETTINGS.discordLiveChannelId,
    discordLiveRoleId: process.env.DISCORD_LIVE_ROLE_ID || DEFAULT_SETTINGS.discordLiveRoleId,
    twitchUsername: process.env.TWITCH_USERNAME || DEFAULT_SETTINGS.twitchUsername,
    twitchUrl: process.env.TWITCH_URL || DEFAULT_SETTINGS.twitchUrl,
  };
}

function writeSettingsFile(settings: Settings): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {}
}
