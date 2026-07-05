/**
 * Posting Gate — pre-flight safety check before any bot message is sent.
 *
 * Checks workspace status, bot settings, live status, and rate limits.
 * This is NOT a content compliance check (complianceEngine handles that).
 *
 * All functions default to { allowed: true } on infrastructure failures
 * so the bot never gets stuck due to DB/network issues.
 */

import { getBotDb } from './supabase';
import { logSystemEvent } from './systemEvents';

// ─── Public types ─────────────────────────────────────────────────────────────

export type PostBlockReason =
  | 'WORKSPACE_INACTIVE'
  | 'BOT_DISABLED'
  | 'TWITCH_OFFLINE'
  | 'COOLDOWN_ACTIVE'
  | 'CHANNEL_MISSING'
  | 'TOKEN_MISSING'
  | 'MAX_PER_HOUR'
  | 'NO_GUILD';

export interface PostGateResult {
  allowed: boolean;
  reason?: PostBlockReason;
  detail?: string;
}

// ─── Workspace data cache ─────────────────────────────────────────────────────

interface WorkspaceData {
  alpha_enabled: boolean;
  discord_guild_id: string | null;
  botSettings: Record<string, unknown>;
  kanalPreferanser: Record<string, string>;
}

interface CacheEntry {
  data: WorkspaceData;
  ts: number;
}

const _wsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

async function getWorkspaceData(workspaceId: string): Promise<WorkspaceData | null> {
  const cached = _wsCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const db = getBotDb();
    if (!db) return null;

    const { data } = await db
      .from('workspaces')
      .select('alpha_enabled, discord_guild_id, settings_json')
      .eq('id', workspaceId)
      .single();

    if (!data) return null;

    const settingsJson = (data.settings_json ?? {}) as Record<string, unknown>;

    const wsData: WorkspaceData = {
      alpha_enabled:    data.alpha_enabled === true,
      discord_guild_id: (data.discord_guild_id as string | null) ?? null,
      botSettings:      (settingsJson['botSettings'] as Record<string, unknown>) ?? {},
      kanalPreferanser: (settingsJson['kanalPreferanser'] as Record<string, string>) ?? {},
    };

    _wsCache.set(workspaceId, { data: wsData, ts: Date.now() });
    return wsData;
  } catch {
    return null;
  }
}

// ─── Live status check ────────────────────────────────────────────────────────

export async function isTwitchLive(workspaceId: string): Promise<boolean> {
  try {
    const db = getBotDb();
    if (!db) return true; // fail-open: if DB is down, assume live to not block

    const { data } = await db
      .from('system_events')
      .select('event_type')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['LIVE_DETECTED', 'STREAM_ENDED'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return false;
    return (data[0] as { event_type: string }).event_type === 'LIVE_DETECTED';
  } catch {
    return true; // fail-open
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

interface RateWindow {
  count: number;
  windowStart: number;
}

const _twitchRateMap  = new Map<string, RateWindow>();
const _discordRateMap = new Map<string, RateWindow>();

const RATE_WINDOW_MS       = 60 * 60_000; // 1 hour
const MAX_TWITCH_PER_HOUR  = 30;
const MAX_DISCORD_PER_HOUR = 20;

function checkAndIncrementRate(
  map: Map<string, RateWindow>,
  key: string,
  maxPerHour: number,
): boolean {
  const now      = Date.now();
  const existing = map.get(key);

  if (!existing || now - existing.windowStart >= RATE_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (existing.count >= maxPerHour) return false;

  existing.count++;
  return true;
}

// ─── Types that require Twitch to be live ─────────────────────────────────────

const LIVE_REQUIRED_TYPES = new Set<string>([
  'ai_reply',
  'hype',
  'chat_response',
  'partner_promo',
]);

// ─── Block helper ─────────────────────────────────────────────────────────────

function blocked(
  reason: PostBlockReason,
  detail: string,
  workspaceId: string,
  type: string,
  channelType?: string,
): PostGateResult {
  logSystemEvent({
    source:     'posting_gate',
    event_type: 'POST_BLOCKED',
    title:      `Post blocked: ${reason}`,
    severity:   'info',
    metadata:   { reason, workspaceId, type, channelType: channelType ?? null, detail },
  });
  return { allowed: false, reason, detail };
}

// ─── canPostToTwitch ──────────────────────────────────────────────────────────

/**
 * Check whether the bot may post a message to Twitch chat.
 *
 * @param workspaceId - The workspace ID (process.env.WORKSPACE_ID)
 * @param type        - Message type, e.g. 'ai_reply', 'partner_promo', 'hype'
 */
export async function canPostToTwitch(
  workspaceId: string,
  type: string,
): Promise<PostGateResult> {
  try {
    const ws = await getWorkspaceData(workspaceId);
    if (!ws) return { allowed: true }; // fail-open on DB issues

    // 1. Workspace must be alpha-enabled
    if (!ws.alpha_enabled) {
      return blocked('WORKSPACE_INACTIVE', 'Workspace alpha_enabled = false', workspaceId, type);
    }

    // 2. Bot must be active
    if (ws.botSettings['aktiv'] === false) {
      return blocked('BOT_DISABLED', 'botSettings.aktiv = false', workspaceId, type);
    }

    // 3. Twitch must not be paused
    if (ws.botSettings['pauseTwitch'] === true) {
      return blocked('BOT_DISABLED', 'botSettings.pauseTwitch = true', workspaceId, type);
    }

    // 4. Some message types require an active stream
    if (LIVE_REQUIRED_TYPES.has(type)) {
      const live = await isTwitchLive(workspaceId);
      if (!live) {
        return blocked(
          'TWITCH_OFFLINE',
          `Type '${type}' requires Twitch to be live`,
          workspaceId,
          type,
        );
      }
    }

    // 5. Rate limit: max 30 messages per hour per workspace
    if (!checkAndIncrementRate(_twitchRateMap, workspaceId, MAX_TWITCH_PER_HOUR)) {
      return blocked(
        'MAX_PER_HOUR',
        `Twitch rate limit exceeded (${MAX_TWITCH_PER_HOUR}/hour)`,
        workspaceId,
        type,
      );
    }

    return { allowed: true };
  } catch {
    return { allowed: true }; // fail-open on any unexpected error
  }
}

// ─── canPostToDiscord ─────────────────────────────────────────────────────────

/**
 * Check whether the bot may post a message to a Discord channel.
 *
 * @param workspaceId - The workspace ID
 * @param channelType - Channel slot name, e.g. 'live', 'chat', 'clips', 'partner', 'subs', 'errors'
 * @param type        - Message type, e.g. 'stream_announce', 'partner_promo'
 */
export async function canPostToDiscord(
  workspaceId: string,
  channelType: string,
  type: string,
): Promise<PostGateResult> {
  try {
    const ws = await getWorkspaceData(workspaceId);
    if (!ws) return { allowed: true }; // fail-open on DB issues

    // 1. Workspace must be alpha-enabled
    if (!ws.alpha_enabled) {
      return blocked('WORKSPACE_INACTIVE', 'Workspace alpha_enabled = false', workspaceId, type, channelType);
    }

    // Bot must be active
    if (ws.botSettings['aktiv'] === false) {
      return blocked('BOT_DISABLED', 'botSettings.aktiv = false', workspaceId, type, channelType);
    }

    // Discord must not be paused
    if (ws.botSettings['pauseDiscord'] === true) {
      return blocked('BOT_DISABLED', 'botSettings.pauseDiscord = true', workspaceId, type, channelType);
    }

    // 2. Channel must be configured in kanalPreferanser
    const channelId = ws.kanalPreferanser[channelType];
    if (!channelId) {
      return blocked(
        'CHANNEL_MISSING',
        `No channel configured for slot '${channelType}' in kanalPreferanser`,
        workspaceId,
        type,
        channelType,
      );
    }

    // 3. Live channel requires a Discord guild to be configured
    if (channelType === 'live') {
      if (!ws.discord_guild_id) {
        return blocked(
          'NO_GUILD',
          'discord_guild_id not configured on workspace',
          workspaceId,
          type,
          channelType,
        );
      }
    }

    // 4. Rate limit: max 20 messages per hour per workspace+channelType
    const rateKey = `${workspaceId}:${channelType}`;
    if (!checkAndIncrementRate(_discordRateMap, rateKey, MAX_DISCORD_PER_HOUR)) {
      return blocked(
        'MAX_PER_HOUR',
        `Discord rate limit exceeded (${MAX_DISCORD_PER_HOUR}/hour) for channel '${channelType}'`,
        workspaceId,
        type,
        channelType,
      );
    }

    return { allowed: true };
  } catch {
    return { allowed: true }; // fail-open on any unexpected error
  }
}
