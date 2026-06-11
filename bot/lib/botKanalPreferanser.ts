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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
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

export async function getAktiv(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return (bs as any).aktiv !== false; // default true
}

export async function getPauseDiscord(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return !!(bs as any).pauseDiscord;
}

export async function getPauseTwitch(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return !!(bs as any).pauseTwitch;
}

export async function getPauseLiveVarsler(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return !!(bs as any).pauseLiveVarsler;
}

export async function getPausePartnerPromo(): Promise<boolean> {
  const bs = await loadBotSettings().catch(() => ({}));
  return !!(bs as any).pausePartnerPromo;
}

export async function getSvarSjanse(): Promise<number> {
  const bs = await loadBotSettings().catch(() => ({}));
  return typeof (bs as any).svarSjanse === 'number' ? (bs as any).svarSjanse : 0.35;
}

export async function getCooldownMs(): Promise<number> {
  const bs = await loadBotSettings().catch(() => ({}));
  const sek = typeof (bs as any).cooldownSek === 'number' ? (bs as any).cooldownSek : 15;
  return sek * 1000;
}

// Hent Twitch URL og sosiale lenker fra Supabase settings_json
export async function getTwitchUrl(): Promise<string> {
  const json = await loadSettingsJson();
  return (json as any)?.twitchUrl || (json as any)?.socials?.twitch || process.env.TWITCH_URL || `https://twitch.tv/${process.env.TWITCH_USERNAME ?? 'glenvex'}`;
}

export async function getDiscordInviteUrl(): Promise<string> {
  const json = await loadSettingsJson();
  return (json as any)?.socials?.discord || process.env.DISCORD_INVITE_URL || '';
}

export async function getSocialsFromSettings(): Promise<Record<string, string | undefined>> {
  const json = await loadSettingsJson();
  return (json as any)?.socials ?? {};
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

export async function getPartnerKanalId(): Promise<string> {
  const prefs = await loadPrefs().catch(() => ({} as Record<string, string>));
  return prefs.partner || prefs.chat || process.env.DISCORD_CHAT_CHANNEL_ID || '';
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
