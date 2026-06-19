/**
 * Single source of truth for Twitch/Discord connection status.
 * Pure function — callers fetch workspace row + bot heartbeat timestamps,
 * this function evaluates all 5 dimensions and returns a unified model.
 */

export interface IntegrationStatusInput {
  workspace: {
    twitch_connected_at:  string | null;
    twitch_login:         string | null;
    twitch_access_token?: string | null;
    twitch_refresh_token?: string | null;
    discord_connected_at: string | null;
    discord_guild_id:     string | null;
    discord_guild_name:   string | null;
    live_channel_id?:     string | null;
    settings_json?:       any;
    alpha_enabled?:       boolean | null;
    onboarding_completed_at?: string | null;
  };
  twitchBotLastEventAt:  string | null;
  discordBotLastEventAt: string | null;
}

const HEARTBEAT_WINDOW_MS = 12 * 3_600_000;

export function evaluateIntegrationStatus(input: IntegrationStatusInput) {
  const { workspace: ws, twitchBotLastEventAt, discordBotLastEventAt } = input;
  const now = Date.now();

  const twitchBotActive  = twitchBotLastEventAt
    ? (now - new Date(twitchBotLastEventAt).getTime())  < HEARTBEAT_WINDOW_MS
    : false;

  const discordBotActive = discordBotLastEventAt
    ? (now - new Date(discordBotLastEventAt).getTime()) < HEARTBEAT_WINDOW_MS
    : false;

  // ── Twitch ─────────────────────────────────────────────────────────────────
  const twitchOauthDone  = !!ws.twitch_connected_at;
  const twitchOauthValid = !!(ws.twitch_access_token && ws.twitch_refresh_token);
  // Bot active counts as connected even if OAuth timestamp was never written
  const twitchConnected  = twitchOauthDone || twitchBotActive;

  let twitchReason: string;
  if (!twitchConnected) {
    twitchReason = 'Twitch OAuth ikke gjennomført — gå gjennom onboarding';
  } else if (twitchBotActive && twitchOauthValid) {
    twitchReason = `Tilkoblet${ws.twitch_login ? ` som ${ws.twitch_login}` : ''} — bot aktiv`;
  } else if (twitchBotActive && !twitchOauthValid) {
    twitchReason = 'Bot kjører, men OAuth-tokens mangler — koble til på nytt';
  } else if (twitchOauthValid && !twitchBotActive) {
    twitchReason = 'OAuth tilkoblet, men bot har ikke sendt hendelse på 12t';
  } else {
    twitchReason = 'Koblet til via OAuth, men bot-status ukjent';
  }

  // ── Discord ────────────────────────────────────────────────────────────────
  const discordOauthDone     = !!ws.discord_connected_at;
  const discordGuildSet      = !!ws.discord_guild_id;
  const discordConnected     = discordOauthDone || (discordGuildSet && discordBotActive);
  const channelsConfigured   = !!(
    ws.live_channel_id || ws.settings_json?.kanalPreferanser?.live
  );
  const discordCanPost       = discordBotActive && channelsConfigured;

  let discordReason: string;
  if (!discordConnected) {
    discordReason = 'Discord OAuth ikke gjennomført — gå gjennom onboarding';
  } else if (!discordBotActive) {
    discordReason = 'Discord-server koblet, men bot har ikke sendt hendelse på 12t';
  } else if (!channelsConfigured) {
    discordReason = 'Bot aktiv, men ingen kanaler valgt — konfigurer under Innstillinger';
  } else {
    discordReason = `Bot aktiv i ${ws.discord_guild_name ?? 'Discord-server'} — klar til å poste`;
  }

  return {
    twitch: {
      connected:        twitchConnected,
      oauthDone:        twitchOauthDone,
      oauthValid:       twitchOauthValid,
      botWatching:      twitchBotActive,
      login:            ws.twitch_login ?? null,
      lastEventAt:      twitchBotLastEventAt,
      reason:           twitchReason,
    },
    discord: {
      connected:          discordConnected,
      oauthDone:          discordOauthDone,
      botInGuild:         discordBotActive,
      channelsConfigured: channelsConfigured,
      canPost:            discordCanPost,
      guildName:          ws.discord_guild_name ?? null,
      lastEventAt:        discordBotLastEventAt,
      reason:             discordReason,
    },
    checks: {
      twitchConnected,
      discordConnected,
      liveChannelSet:      channelsConfigured,
      onboardingComplete:  !!ws.onboarding_completed_at,
      alphaEnabled:        !!ws.alpha_enabled,
    },
    readyForRuntime:
      twitchConnected &&
      discordConnected &&
      channelsConfigured &&
      !!ws.onboarding_completed_at &&
      !!ws.alpha_enabled,
  };
}

export type IntegrationStatus = ReturnType<typeof evaluateIntegrationStatus>;
