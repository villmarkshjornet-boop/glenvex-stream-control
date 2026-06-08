import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const CACHE_TTL = 5 * 60_000; // 5 minutes

let _cache: Record<string, string> | null = null;
let _cacheTime = 0;
let _botSettingsCache: Record<string, any> | null = null;
let _botSettingsCacheTime = 0;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadSettingsJson(): Promise<any> {
  try {
    const sb = getClient();
    if (!sb) return {};
    const { data } = await sb
      .from('workspaces')
      .select('settings_json')
      .eq('id', WORKSPACE_ID)
      .single();
    return data?.settings_json ?? {};
  } catch {}
  return {};
}

async function loadPrefs(): Promise<Record<string, string>> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  try {
    const json = await loadSettingsJson();
    if (json?.kanalPreferanser) {
      _cache = json.kanalPreferanser;
      _cacheTime = Date.now();
      return _cache!;
    }
  } catch {}
  return {};
}

async function loadBotSettings(): Promise<Record<string, any>> {
  if (_botSettingsCache && Date.now() - _botSettingsCacheTime < CACHE_TTL) return _botSettingsCache;
  try {
    const json = await loadSettingsJson();
    if (json?.botSettings) {
      _botSettingsCache = json.botSettings;
      _botSettingsCacheTime = Date.now();
      return _botSettingsCache!;
    }
  } catch {}
  return {};
}

export async function getBotTone(): Promise<string> {
  const bs = await loadBotSettings().catch(() => ({}));
  return (bs as any).tone ?? 'dark_gaming';
}

export async function getPauseProaktiv(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return !!(bs as any).pauseProaktiv;
}

// Fallback: env → prefs → null
export async function getSubsKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.subs || prefs.chat || process.env.DISCORD_CHAT_CHANNEL_ID || '';
}

export async function getClipsKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.clips || prefs.chat || process.env.DISCORD_CHAT_CHANNEL_ID || '';
}

export async function getChatKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.chat || process.env.DISCORD_CHAT_CHANNEL_ID || '';
}

export async function getLiveKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.live || process.env.DISCORD_LIVE_CHANNEL_ID || '';
}

export async function getRaidKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.raid || prefs.chat || process.env.DISCORD_CHAT_CHANNEL_ID || '';
}
