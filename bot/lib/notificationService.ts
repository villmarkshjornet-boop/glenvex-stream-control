/**
 * Notification Service — kortdrop-varsler til Discord og Twitch chat
 *
 * Anti-spam:
 *  - Max 1 varsling per bruker per 10 min
 *  - Max 5 varsler per workspace per 10 min
 *  - Ingen varsling ved cache-hit (gammelt kort)
 */

// ── Rate limiter (in-memory) ──────────────────────────────────────────────────

const userCooldowns = new Map<string, number>();
const wsCooldown = { count: 0, windowStart: 0 };

function isRateLimited(userId: string): boolean {
  const now = Date.now();

  // Per-user: 10 min cooldown
  const lastUser = userCooldowns.get(userId) ?? 0;
  if (now - lastUser < 10 * 60_000) return true;

  // Per-workspace: max 5 per 10 min
  if (now - wsCooldown.windowStart > 10 * 60_000) {
    wsCooldown.count = 0;
    wsCooldown.windowStart = now;
  }
  if (wsCooldown.count >= 5) return true;

  return false;
}

function markUsed(userId: string) {
  userCooldowns.set(userId, Date.now());
  wsCooldown.count++;
}

// ── Rarity emojis ─────────────────────────────────────────────────────────────

const RARITY_EMOJI: Record<string, string> = {
  Common:    '🎴',
  Rare:      '💎',
  Epic:      '🔮',
  Legendary: '✨',
  Mythic:    '⚡',
};

// ── Card drop notification ────────────────────────────────────────────────────

export async function notifyCardDrop(params: {
  userId:           string;
  username:         string;
  rarity:           string;
  title:            string;
  cardType:         string;
  isNewCard:        boolean;
  twitchChatSend?:  (msg: string) => Promise<void>;
  discordSend?:     (msg: string) => Promise<void>;
  twitchEnabled?:   boolean;
  discordEnabled?:  boolean;
}): Promise<void> {
  if (!params.isNewCard) return;
  if (isRateLimited(params.userId)) return;

  markUsed(params.userId);

  const emoji = RARITY_EMOJI[params.rarity] ?? '🎴';
  const name  = params.username;

  let twitchMsg = '';
  if (params.rarity === 'Mythic' || params.cardType === 'sub') {
    twitchMsg = `⚡ MYTHIC CARD DROP! ${name} låste opp ${params.title}! Gratulerer! 🎴`;
  } else if (params.rarity === 'Legendary') {
    twitchMsg = `✨ LEGENDARY CARD DROP! ${name} fikk ${params.title}! Det er historisk! 🎴`;
  } else if (params.rarity === 'Epic') {
    twitchMsg = `🔮 EPIC kortdrop! ${name} trakk et EPIC samlekort! 🎴`;
  } else if (params.rarity === 'Rare') {
    twitchMsg = `💎 ${name} trakk et RARE samlekort! Nice! 🎴`;
  } else {
    twitchMsg = `🎴 ${name} fikk et ${params.rarity} kort: ${params.title}!`;
  }

  if (params.twitchEnabled && params.twitchChatSend) {
    params.twitchChatSend(twitchMsg).catch(() => {});
  }

  if (params.discordEnabled && params.discordSend) {
    params.discordSend(twitchMsg).catch(() => {});
  }
}

// ── Sub card notification ─────────────────────────────────────────────────────

export async function notifySubCard(params: {
  username:         string;
  twitchChatSend?:  (msg: string) => Promise<void>;
  discordSend?:     (msg: string) => Promise<void>;
  twitchEnabled?:   boolean;
  discordEnabled?:  boolean;
}): Promise<void> {
  const msg = `🎴 @${params.username} låste opp et unikt MYTHIC SUB-kort! Takk for støtten! ⚡👑`;

  if (params.twitchEnabled && params.twitchChatSend) {
    params.twitchChatSend(msg).catch(() => {});
  }
  if (params.discordEnabled && params.discordSend) {
    params.discordSend(msg).catch(() => {});
  }
}

// ── Achievement / milestone notification ──────────────────────────────────────

export async function notifySpecialCard(params: {
  username:       string;
  cardType:       'achievement' | 'milestone';
  title:          string;
  rarity:         string;
  coinsBonus:     number;
  discordSend?:   (msg: string) => Promise<void>;
}): Promise<void> {
  if (!params.discordSend) return;

  const emoji = RARITY_EMOJI[params.rarity] ?? '🎴';
  const type  = params.cardType === 'achievement' ? 'Achievement' : 'Milestone';
  const msg   = `${emoji} **${params.username}** låste opp et ${type}-kort: **${params.title}** (+${params.coinsBonus} coins)`;

  params.discordSend(msg).catch(() => {});
}
