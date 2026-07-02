/**
 * Compliance Engine — centralized outbound message gating for GLENVEX Creator OS.
 *
 * ALL messages sent to Discord or Twitch must pass checkCompliance() before being sent.
 * The engine is pure in-memory (no DB calls) so it is fast and safe to call synchronously
 * from any send path.
 *
 * Rules implemented:
 *   R1  twitch_rate_limit     — max 18 messages per 30-second rolling window per workspace
 *   R2  promo_frequency       — max 1 partner_promo per channel per 15 minutes
 *   R3  message_repetition    — same first-50-chars sent to same channel in last 10 minutes
 *   R4  suspicious_link       — flag (warn, don't block) URLs outside allowed domain list
 *   R5  ai_hallucination_check— block AI self-disclosure phrases that break character
 *   R6  spam_pattern          — block excessive exclamation marks, all-caps walls, word repeats
 */

import { logSystemEvent } from './systemEvents';

// ── Public types ──────────────────────────────────────────────────────────────

export type MessageChannel =
  | 'twitch_chat'
  | 'discord_channel'
  | 'discord_dm'
  | 'discord_embed';

export type MessageCategory =
  | 'partner_promo'
  | 'ai_reply'
  | 'live_announcement'
  | 'community'
  | 'system'
  | 'hype'
  | 'social';

export interface ComplianceCheckInput {
  content: string;
  channel: MessageChannel;
  category: MessageCategory;
  workspaceId: string;
  metadata?: Record<string, unknown>;
}

export interface ComplianceResult {
  allowed: boolean;
  reason?: string;      // human-readable reason if blocked
  ruleId?: string;      // which rule blocked it
  throttleMs?: number;  // suggest waiting this long before retry
}

// ── Allowed domains (Rule 4) ──────────────────────────────────────────────────

const ALLOWED_DOMAINS = new Set([
  'twitch.tv',
  'discord.com',
  'discord.gg',
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
]);

// ── In-memory state ───────────────────────────────────────────────────────────

// Rule 1: Twitch rate limit — rolling window of timestamps per workspace
const _twitchTimestamps = new Map<string, number[]>();

// Rule 2: Last promo time per workspace+channel key
const _lastPromoTime = new Map<string, number>();

// Rule 3: Recent message prefixes per workspace+channel key (last 5 messages)
const _recentPrefixes = new Map<string, { prefix: string; ts: number }[]>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function block(ruleId: string, reason: string, throttleMs?: number, input?: ComplianceCheckInput): ComplianceResult {
  console.log(`[COMPLIANCE_BLOCKED] ruleId=${ruleId} channel=${input?.channel ?? '?'} category=${input?.category ?? '?'}`);
  if (input) {
    logSystemEvent({
      source: 'compliance_engine',
      event_type: 'COMPLIANCE_BLOCKED',
      title: `Compliance blocked: ${ruleId}`,
      severity: 'info',
      metadata: {
        ruleId,
        channel: input.channel,
        category: input.category,
        contentPreview: input.content.slice(0, 80),
        workspaceId: input.workspaceId,
      },
    });
  }
  return { allowed: false, reason, ruleId, throttleMs };
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    // Strip leading "www."
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ── Rule implementations ──────────────────────────────────────────────────────

/** R1: Twitch rate limit — max 18 messages per 30-second rolling window */
function checkTwitchRateLimit(input: ComplianceCheckInput): ComplianceResult | null {
  if (input.channel !== 'twitch_chat') return null;

  const now = Date.now();
  const WINDOW_MS = 30_000;
  const MAX_MSGS = 18;

  const key = input.workspaceId;
  let timestamps = _twitchTimestamps.get(key) ?? [];
  // Prune entries outside the window
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);

  if (timestamps.length >= MAX_MSGS) {
    const oldest = timestamps[0];
    const waitMs = WINDOW_MS - (now - oldest) + 100;
    _twitchTimestamps.set(key, timestamps);
    return block(
      'twitch_rate_limit',
      `Twitch rate limit: ${timestamps.length} messages in the last 30s (max ${MAX_MSGS})`,
      waitMs,
      input,
    );
  }

  timestamps.push(now);
  _twitchTimestamps.set(key, timestamps);
  return null;
}

/** R2: Partner promo frequency — max 1 per channel per 15 minutes */
function checkPromoFrequency(input: ComplianceCheckInput): ComplianceResult | null {
  if (input.category !== 'partner_promo') return null;

  const COOLDOWN_MS = 15 * 60_000;
  const key = `${input.workspaceId}::${input.channel}`;
  const last = _lastPromoTime.get(key) ?? 0;
  const elapsed = Date.now() - last;

  if (last > 0 && elapsed < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - elapsed;
    return block(
      'promo_frequency',
      `Partner promo cooldown: last promo was ${Math.round(elapsed / 1000)}s ago (min 15 min)`,
      waitMs,
      input,
    );
  }

  _lastPromoTime.set(key, Date.now());
  return null;
}

/** R3: Message repetition — same first-50-chars within last 10 minutes on same channel */
function checkMessageRepetition(input: ComplianceCheckInput): ComplianceResult | null {
  const WINDOW_MS = 10 * 60_000;
  const PREFIX_LEN = 50;

  const key = `${input.workspaceId}::${input.channel}`;
  const now = Date.now();
  let entries = _recentPrefixes.get(key) ?? [];

  // Prune old entries
  entries = entries.filter(e => now - e.ts < WINDOW_MS);

  const incomingPrefix = input.content.slice(0, PREFIX_LEN).trim();

  const duplicate = entries.find(e => e.prefix === incomingPrefix);
  if (duplicate) {
    const agoSec = Math.round((now - duplicate.ts) / 1000);
    return block(
      'message_repetition',
      `Duplicate message detected: same content sent ${agoSec}s ago to ${input.channel}`,
      undefined,
      input,
    );
  }

  // Record this message (keep last 5)
  entries.push({ prefix: incomingPrefix, ts: now });
  if (entries.length > 5) entries = entries.slice(-5);
  _recentPrefixes.set(key, entries);

  return null;
}

/** R4: Suspicious link detection — warn only (does not block) */
function checkSuspiciousLink(input: ComplianceCheckInput): void {
  const URL_REGEX = /https?:\/\/[^\s]+/gi;
  const matches = input.content.match(URL_REGEX);
  if (!matches) return;

  for (const url of matches) {
    const domain = extractDomain(url);
    if (!domain) continue;

    // Accept if the domain or a parent matches the allowed list
    const domainParts = domain.split('.');
    const isAllowed = ALLOWED_DOMAINS.has(domain)
      || (domainParts.length > 2 && ALLOWED_DOMAINS.has(domainParts.slice(-2).join('.')));

    if (!isAllowed) {
      console.log(`[COMPLIANCE_SUSPICIOUS_LINK] domain=${domain} channel=${input.channel} category=${input.category}`);
      logSystemEvent({
        source: 'compliance_engine',
        event_type: 'COMPLIANCE_SUSPICIOUS_LINK',
        title: `Suspicious link detected: ${domain}`,
        severity: 'warning',
        metadata: {
          domain,
          url: url.slice(0, 200),
          channel: input.channel,
          category: input.category,
          contentPreview: input.content.slice(0, 80),
          workspaceId: input.workspaceId,
        },
      });
    }
  }
}

/** R5: AI hallucination markers — block messages that break character */
const AI_HALLUCINATION_PHRASES = [
  'as an ai',
  'as a language model',
  "i don't have access to real-time",
  'i cannot browse the internet',
  'my knowledge cutoff',
];

function checkAiHallucination(input: ComplianceCheckInput): ComplianceResult | null {
  const lower = input.content.toLowerCase();
  for (const phrase of AI_HALLUCINATION_PHRASES) {
    if (lower.includes(phrase)) {
      return block(
        'ai_hallucination_check',
        `AI self-disclosure phrase detected: "${phrase}"`,
        undefined,
        input,
      );
    }
  }
  return null;
}

/** R6: Spam patterns — excessive exclamation, all-caps walls, word repetition */
function checkSpamPattern(input: ComplianceCheckInput): ComplianceResult | null {
  const content = input.content;

  // > 5 consecutive exclamation marks
  if (/!{6,}/.test(content)) {
    return block(
      'spam_pattern',
      'Excessive exclamation marks (> 5 consecutive)',
      undefined,
      input,
    );
  }

  // ALL CAPS and > 100 chars (ignoring whitespace, punctuation, emojis)
  const lettersOnly = content.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 100 && lettersOnly === lettersOnly.toUpperCase() && lettersOnly.length > 0) {
    return block(
      'spam_pattern',
      'All-caps message longer than 100 characters',
      undefined,
      input,
    );
  }

  // Same word repeated > 4 times
  const words = content.toLowerCase().match(/\b\w+\b/g) ?? [];
  const wordCount = new Map<string, number>();
  for (const w of words) {
    const count = (wordCount.get(w) ?? 0) + 1;
    if (count > 4) {
      return block(
        'spam_pattern',
        `Word "${w}" repeated more than 4 times`,
        undefined,
        input,
      );
    }
    wordCount.set(w, count);
  }

  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Gate an outbound message through all compliance rules.
 * Returns { allowed: true } if the message may be sent, or { allowed: false, ... } with details.
 *
 * Rule evaluation order is fail-fast: the first blocked rule is returned immediately.
 * Rule 4 (suspicious link) is always evaluated but only warns — it never blocks.
 */
export function checkCompliance(input: ComplianceCheckInput): ComplianceResult {
  // R1 — Twitch rate limit (only for twitch_chat channel)
  const r1 = checkTwitchRateLimit(input);
  if (r1) return r1;

  // R2 — Partner promo frequency
  const r2 = checkPromoFrequency(input);
  if (r2) return r2;

  // R3 — Message repetition
  const r3 = checkMessageRepetition(input);
  if (r3) return r3;

  // R4 — Suspicious link (warn only, never blocks)
  checkSuspiciousLink(input);

  // R5 — AI hallucination markers
  const r5 = checkAiHallucination(input);
  if (r5) return r5;

  // R6 — Spam patterns
  const r6 = checkSpamPattern(input);
  if (r6) return r6;

  return { allowed: true };
}
