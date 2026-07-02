import fs from 'fs';
import path from 'path';
import { logSystemEvent } from './systemEvents';
import { createClient } from '@supabase/supabase-js';
import { awardCoins, xpToCoins, COIN_RATES } from './coinService';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
}

const FILE = path.join(process.cwd(), 'data', 'members.json');
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

export interface MemberProfile {
  id: string;
  username: string;
  displayName: string;
  nickname: string | null;     // server-specific nickname (null = not set)
  topRole: string;             // OWNER | ADMIN | MODERATOR | VIP | SUBSCRIBER | BOOSTER | MEMBER
  twitchId: string | null;
  xp: number;
  level: number;
  messages: number;
  reactions: number;
  voiceMinutes: number;
  streamsWatched: number;
  streamsAttended: number;
  subs: number;
  giftSubs: number;
  raids: number;
  engagementScore: number;
  communityScore: number;
  streakDays: number;
  lastStreakDate: string | null;
  joinedAt: string;
  lastSeen: string;
  lastWelcomed: string | null;
  badges: string[];
}

const XP_PER_MESSAGE  = 15;
const XP_PER_LEVEL    = 250;
const DEFAULT_COOLDOWN_MS = 30_000;
const XP_DAGLIG_BONUS = 50;   // første melding per dag
const XP_LANG_MELDING = 10;   // bonus for meldinger >60 tegn
const XP_STREAK_MULT  = 0.1;  // 10% bonus per streak-dag (maks 50%)

// Per-user cooldown timestamps
const messageCooldowns = new Map<string, number>();

// Per-user last content (normalized) — catches repeated-text spam
const lastContentCache = new Map<string, string>();

// ─── File I/O ─────────────────────────────────────────────────────────────────

function load(): Record<string, MemberProfile> {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

function save(data: Record<string, MemberProfile>) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

// ─── Supabase sync (JS-klient — håndterer schema-feil riktig) ────────────────

function syncToSupabase(m: MemberProfile): void {
  const sb = getSb();
  if (!sb) return;

  const full = {
    discord_id:       m.id,
    workspace_id:     WORKSPACE_ID,
    username:         m.username,
    display_name:     m.displayName,
    twitch_id:        m.twitchId ?? null,
    xp:               m.xp,
    level:            m.level,
    messages:         m.messages,
    reactions:        m.reactions,
    voice_minutes:    m.voiceMinutes,
    streams_attended: m.streamsAttended,
    subs:             m.subs,
    gift_subs:        m.giftSubs,
    raids:            m.raids,
    engagement_score: m.engagementScore,
    community_score:  m.communityScore,
    streak_days:      m.streakDays,
    last_streak_date: m.lastStreakDate,
    badges:           m.badges,
    last_seen:        m.lastSeen,
    last_welcomed:    m.lastWelcomed,
    joined_at:        m.joinedAt,
    updated_at:       new Date().toISOString(),
  };

  sb.from('community_members').upsert(full, { onConflict: 'workspace_id,discord_id' })
  .then(({ error }) => {
    if (!error) return;
    // Fallback: prøv minimal upsert (bare kjerne-kolonner, garantert å eksistere)
    console.warn(`[MemberTracker] Full sync feilet for ${m.username}: ${error.message} — prøver minimal`);
    sb.from('community_members').upsert({
      discord_id:   m.id,
      workspace_id: WORKSPACE_ID,
      username:     m.username,
      display_name: m.displayName,
      xp:           m.xp,
      level:        m.level,
      messages:     m.messages,
      badges:       m.badges,
      last_seen:    m.lastSeen,
      joined_at:    m.joinedAt,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'workspace_id,discord_id' }).then(({ error: e2 }) => {
      if (e2) console.error(`[MemberTracker] Minimal sync OGSÅ feilet for ${m.username}: ${e2.message}`);
      else console.log(`[MemberTracker] Minimal sync OK for ${m.username} (XP: ${m.xp})`);
    }, () => {});
  }, (err: any) => {
    console.warn(`[MemberTracker] Sync nettverksfeil for ${m.username}:`, err?.message);
  });
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

export async function lasterMedlemmerFraSupabase(): Promise<void> {
  // Alltid last fra Supabase ved oppstart — Railway-disken er ephemeral.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const sb = getSb();
    if (!sb) return;
    const { data: rows, error } = await sb
      .from('community_members')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID);
    if (error) { console.warn(`[MemberTracker] Supabase-henting feilet: ${error.message}`); return; }
    if (!rows) return;
    if (!rows || rows.length === 0) {
      console.log('[MemberTracker] Ingen members i Supabase — starter fra scratch');
      return;
    }

    // Merge: Supabase er autoritativ. Behold lokal data som Supabase ikke kjenner.
    const existing = fs.existsSync(FILE) ? load() : {};
    const members: Record<string, MemberProfile> = { ...existing };
    for (const r of rows) {
      members[r.discord_id] = {
        id:               r.discord_id,
        username:         r.username,
        displayName:      r.display_name,
        nickname:         r.nickname ?? null,
        topRole:          r.top_role ?? 'MEMBER',
        twitchId:         r.twitch_id ?? null,
        xp:               r.xp ?? 0,
        level:            r.level ?? 1,
        messages:         r.messages ?? 0,
        reactions:        r.reactions ?? 0,
        voiceMinutes:     r.voice_minutes ?? 0,
        streamsWatched:   0,
        streamsAttended:  r.streams_attended ?? 0,
        subs:             r.subs ?? 0,
        giftSubs:         r.gift_subs ?? 0,
        raids:            r.raids ?? 0,
        engagementScore:  r.engagement_score ?? 0,
        communityScore:   r.community_score ?? 0,
        streakDays:       r.streak_days ?? 0,
        lastStreakDate:   r.last_streak_date ?? null,
        joinedAt:         r.joined_at ?? r.created_at ?? new Date().toISOString(),
        lastSeen:         r.last_seen ?? new Date().toISOString(),
        lastWelcomed:    r.last_welcomed ?? null,
        badges:           r.badges ?? [],
      };
    }
    save(members);
    console.log(`[MemberTracker] Gjenopprettet ${rows.length} membres fra Supabase etter Railway-restart`);
  } catch (err: any) {
    console.error('[MemberTracker] Supabase-import feilet:', err.message);
  }
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export function getMember(id: string): MemberProfile | null {
  return load()[id] ?? null;
}

export function getAllMembers(): MemberProfile[] {
  return Object.values(load()).sort((a, b) => b.xp - a.xp);
}

// ─── Score calculation ────────────────────────────────────────────────────────

function computeScores(m: MemberProfile): void {
  m.engagementScore = Math.min(100, Math.round(
    Math.min(m.messages / 10, 30) +
    Math.min(m.reactions / 20, 15) +
    Math.min(m.voiceMinutes / 60, 20) +
    Math.min(m.streamsAttended * 2, 20) +
    Math.min((m.subs + m.giftSubs * 2 + m.raids * 3) * 3, 15)
  ));
  m.communityScore = Math.min(100, Math.round(
    m.engagementScore * 0.5 +
    Math.min(m.level * 2, 25) +
    Math.min(m.badges.length * 5, 25)
  ));
}

// ─── Level helpers ────────────────────────────────────────────────────────────

export function levelFromXP(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpToNextLevel(xp: number): number {
  const currentLevelXP = (levelFromXP(xp) - 1) * XP_PER_LEVEL;
  return XP_PER_LEVEL - (xp - currentLevelXP);
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export function upsertMember(
  id: string,
  username: string,
  displayName: string,
  opts?: { guildJoinedAt?: string; topRole?: string; nickname?: string | null },
): MemberProfile {
  const members = load();
  if (!members[id]) {
    members[id] = {
      id, username, displayName,
      nickname:  opts?.nickname ?? null,
      topRole:   opts?.topRole  ?? 'MEMBER',
      twitchId: null, xp: 0, level: 1,
      messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
      subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
      streakDays: 0, lastStreakDate: null,
      joinedAt: opts?.guildJoinedAt ?? new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      lastWelcomed: null, badges: [],
    };
  } else {
    members[id].lastSeen    = new Date().toISOString();
    members[id].displayName = displayName;
    if (opts?.nickname  !== undefined) members[id].nickname  = opts.nickname;
    if (opts?.topRole)                 members[id].topRole   = opts.topRole;
    // Always update joinedAt if we receive the real Discord guild value
    if (opts?.guildJoinedAt)           members[id].joinedAt  = opts.guildJoinedAt;
    // Init missing fields on existing profiles (migration safety)
    if (!members[id].nickname  && members[id].nickname  !== null) members[id].nickname  = null;
    if (!members[id].topRole)                                      members[id].topRole   = 'MEMBER';
  }
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  return members[id];
}

// ─── Streak update ────────────────────────────────────────────────────────────

function updateStreak(m: MemberProfile): boolean {
  const todayISO = new Date().toISOString().slice(0, 10);
  const yesterdayISO = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  if (m.lastStreakDate === todayISO) return false; // already counted today

  const prevStreak = m.streakDays;
  if (!m.lastStreakDate || m.lastStreakDate < yesterdayISO) {
    m.streakDays = 1; // reset (broke streak or first time)
  } else if (m.lastStreakDate === yesterdayISO) {
    m.streakDays += 1; // consecutive day
  }
  m.lastStreakDate = todayISO;

  if (m.streakDays !== prevStreak) {
    logSystemEvent({
      source:     'community_manager',
      event_type: 'COMMUNITY_STREAK_UPDATED',
      title:      `Streak oppdatert: ${m.displayName} – ${m.streakDays} dager på rad`,
      severity:   'info',
      metadata:   { userId: m.id, username: m.displayName, streakDays: m.streakDays, prevStreak },
    });
  }
  return true;
}

// ─── Content normalization (for duplicate-text detection) ─────────────────────

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
}

// ─── addMessageXP ─────────────────────────────────────────────────────────────

export function addMessageXP(
  id: string,
  username: string,
  displayName: string,
  content: string,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  minLength = 4,
): { leveledUp: boolean; newLevel: number; xpGitt: number; dagligBonus: boolean; nyeBadges: string[] } | null {

  // Bot command filter
  if (content.startsWith('/') || content.startsWith('!')) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_XP_SKIPPED_SPAM',
      title: `XP hoppet over: ${displayName} – bot-kommando`,
      severity: 'info',
      metadata: { userId: id, username: displayName, reason: 'bot_command' },
    });
    return null;
  }

  const normalized = normalizeContent(content);

  // Short message filter
  if (normalized.length < minLength) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_XP_SKIPPED_SPAM',
      title: `XP hoppet over: ${displayName} – for kort melding (${normalized.length} tegn)`,
      severity: 'info',
      metadata: { userId: id, username: displayName, reason: 'short_message', length: normalized.length },
    });
    return null;
  }

  // Duplicate content filter (same text as last message)
  const lastContent = lastContentCache.get(id);
  if (lastContent && lastContent === normalized) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_XP_SKIPPED_SPAM',
      title: `XP hoppet over: ${displayName} – gjentatt innhold`,
      severity: 'info',
      metadata: { userId: id, username: displayName, reason: 'duplicate_content' },
    });
    return null;
  }
  lastContentCache.set(id, normalized);

  // Cooldown filter (no event logged — expected normal behavior)
  const last = messageCooldowns.get(id);
  if (last && Date.now() - last < cooldownMs) return null;
  messageCooldowns.set(id, Date.now());

  // Grant XP
  const members = load();
  const m: MemberProfile = members[id] ?? {
    id, username, displayName, twitchId: null, xp: 0, level: 1,
    messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
    subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
    streakDays: 0, lastStreakDate: null,
    joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    lastWelcomed: null, badges: [],
  };

  const oldLevel = m.level;

  // Beregn XP med bonuser
  let xpTildelt = XP_PER_MESSAGE;

  // Lang melding-bonus
  if (normalized.length > 60) xpTildelt += XP_LANG_MELDING;

  // Daglig-bonus: første melding i dag
  const i_dag = new Date().toISOString().slice(0, 10);
  const sisteAktivDag = m.lastSeen?.slice(0, 10);
  const dagligBonus = sisteAktivDag !== i_dag;
  if (dagligBonus) xpTildelt += XP_DAGLIG_BONUS;

  // Streak-multiplikator (maks 50% bonus)
  const streakBonus = Math.min(0.5, m.streakDays * XP_STREAK_MULT);
  xpTildelt = Math.round(xpTildelt * (1 + streakBonus));

  m.xp += xpTildelt;
  m.messages += 1;
  m.level = levelFromXP(m.xp);
  m.lastSeen = new Date().toISOString();

  const nyeBadges = checkAllBadges(m);
  updateStreak(m);

  members[id] = m;
  computeScores(m);
  save(members);
  syncToSupabase(m);

  // Fire-and-forget coin awards (coins are proportional to XP, never replace XP)
  const coinsEarned = xpToCoins(xpTildelt);
  if (coinsEarned > 0) {
    awardCoins(id, coinsEarned, 'discord_message', { xpEarned: xpTildelt }).catch(() => {});
  }
  if (dagligBonus) {
    awardCoins(id, COIN_RATES.DAILY_BONUS, 'daily_bonus', { username: displayName }).catch(() => {});
  }

  logSystemEvent({
    source:     'community_manager',
    event_type: 'COMMUNITY_XP_GRANTED',
    title:      `XP tildelt: ${displayName} +${xpTildelt} XP (Total: ${m.xp}, Level ${m.level})`,
    severity:   'info',
    metadata:   { userId: id, username: displayName, xpGranted: xpTildelt, totalXp: m.xp, level: m.level, messages: m.messages, dagligBonus },
  });

  const leveledUp = m.level > oldLevel;
  if (leveledUp) {
    logSystemEvent({
      source:     'community_manager',
      event_type: 'COMMUNITY_LEVEL_UP',
      title:      `Level-up: ${displayName} → Level ${m.level}`,
      severity:   'info',
      metadata:   { userId: id, username: displayName, newLevel: m.level, oldLevel, totalXp: m.xp },
    });
  }

  return { leveledUp, newLevel: m.level, xpGitt: xpTildelt, dagligBonus, nyeBadges };
}

// ─── Twitch XP (bruker tw_-prefiks for å unngå kollisjon med Discord snowflakes) ──

export function addTwitchMessageXP(
  twitchUserId: string,
  twitchUsername: string,
  content: string,
): { leveledUp: boolean; newLevel: number; xpGitt: number; dagligBonus: boolean; nyeBadges: string[] } | null {

  if (!content || content.length < 2) return null;

  const id          = `tw_${twitchUserId}`;
  const displayName = twitchUsername;
  const normalized  = content.trim().toLowerCase();

  const last = messageCooldowns.get(id);
  if (last && Date.now() - last < DEFAULT_COOLDOWN_MS) return null;
  messageCooldowns.set(id, Date.now());

  const members = load();
  const m: MemberProfile = members[id] ?? {
    id, username: twitchUsername, displayName,
    twitchId: twitchUserId, xp: 0, level: 1,
    messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
    subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
    streakDays: 0, lastStreakDate: null,
    joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    lastWelcomed: null, badges: [],
  };

  const oldLevel = m.level;

  let xpTildelt = XP_PER_MESSAGE;
  if (normalized.length > 60) xpTildelt += XP_LANG_MELDING;

  const i_dag        = new Date().toISOString().slice(0, 10);
  const dagligBonus  = m.lastSeen?.slice(0, 10) !== i_dag;
  if (dagligBonus) xpTildelt += XP_DAGLIG_BONUS;

  const streakBonus = Math.min(0.5, m.streakDays * XP_STREAK_MULT);
  xpTildelt = Math.round(xpTildelt * (1 + streakBonus));

  m.xp       += xpTildelt;
  m.messages += 1;
  m.level     = levelFromXP(m.xp);
  m.lastSeen  = new Date().toISOString();

  const nyeBadges = checkAllBadges(m);
  updateStreak(m);

  members[id] = m;
  computeScores(m);
  save(members);
  syncToSupabase(m);

  const twitchCoins = xpToCoins(xpTildelt);
  if (twitchCoins > 0) {
    awardCoins(id, twitchCoins, 'twitch_message', { xpEarned: xpTildelt }).catch(() => {});
  }
  if (dagligBonus) {
    awardCoins(id, COIN_RATES.DAILY_BONUS, 'daily_bonus', { username: twitchUsername }).catch(() => {});
  }

  const leveledUp = m.level > oldLevel;
  return { leveledUp, newLevel: m.level, xpGitt: xpTildelt, dagligBonus, nyeBadges };
}

// ─── Other XP actions ─────────────────────────────────────────────────────────

export function addSub(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, subs: (m.subs || 0) + 1, xp: m.xp + 200 };
  checkAllBadges(members[id]);
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
    title: `XP tildelt (sub): ${displayName} +200 XP`,
    severity: 'info',
    metadata: { userId: id, username: displayName, xpGranted: 200, reason: 'sub', totalXp: members[id].xp },
  });
}

export function addGiftSub(id: string, username: string, displayName: string, count: number) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  const xpGained = count * 100;
  members[id] = { ...m, giftSubs: (m.giftSubs || 0) + count, xp: m.xp + xpGained };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
    title: `XP tildelt (gift subs): ${displayName} +${xpGained} XP (${count} gifts)`,
    severity: 'info',
    metadata: { userId: id, username: displayName, xpGranted: xpGained, reason: 'gift_sub', count, totalXp: members[id].xp },
  });
}

export function addRaid(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, raids: (m.raids || 0) + 1, xp: m.xp + 500 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
    title: `XP tildelt (raid): ${displayName} +500 XP`,
    severity: 'info',
    metadata: { userId: id, username: displayName, xpGranted: 500, reason: 'raid', totalXp: members[id].xp },
  });
}

export function addReaction(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, reactions: (m.reactions || 0) + 1, xp: m.xp + 2 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
}

export function addVoiceMinutes(id: string, username: string, displayName: string, minutes: number) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  const voiceXP = minutes * 3;
  members[id] = { ...m, voiceMinutes: (m.voiceMinutes || 0) + minutes, xp: m.xp + voiceXP };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);

  const voiceCoins = Math.floor(minutes / 10) * COIN_RATES.VOICE_PER_10MIN;
  if (voiceCoins > 0) {
    awardCoins(id, voiceCoins, 'voice', { minutes }).catch(() => {});
  }

  if (minutes >= 5) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
      title: `XP tildelt (voice): ${displayName} +${voiceXP} XP (${minutes} min)`,
      severity: 'info',
      metadata: { userId: id, username: displayName, xpGranted: voiceXP, reason: 'voice', minutes, totalXp: members[id].xp },
    });
  }
}

export function addStreamAttendance(id: string, username: string, displayName: string) {
  const members = load();
  const m = getMember(id);
  if (!m) { upsertMember(id, username, displayName); return; }
  const today = new Date().toISOString().slice(0, 10);
  const lastAttendDate = (m as any)._lastAttendDate;
  if (lastAttendDate === today) return;
  (members[id] as any)._lastAttendDate = today;
  members[id] = { ...members[id], streamsAttended: (m.streamsAttended || 0) + 1, xp: m.xp + 100 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  awardCoins(id, COIN_RATES.STREAM_ATTENDANCE, 'stream_attendance', { username: displayName }).catch(() => {});
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
    title: `XP tildelt (stream-deltakelse): ${displayName} +100 XP`,
    severity: 'info',
    metadata: { userId: id, username: displayName, xpGranted: 100, reason: 'stream_attendance', totalXp: members[id].xp },
  });
}

export function setLastWelcomed(id: string) {
  const members = load();
  if (members[id]) {
    members[id].lastWelcomed = new Date().toISOString();
    save(members);
    syncToSupabase(members[id]);
  }
}

export function syncMember(m: MemberProfile): void {
  const members = load();
  members[m.id] = m;
  save(members);
  syncToSupabase(m);
}

export function deductXP(id: string, antall: number): void {
  const members = load();
  if (!members[id]) return;
  members[id].xp = Math.max(0, members[id].xp - antall);
  save(members);
  syncToSupabase(members[id]);
}

export function setXP(id: string, xp: number): MemberProfile | null {
  const members = load();
  if (!members[id]) return null;
  members[id].xp    = Math.max(0, xp);
  members[id].level = levelFromXP(members[id].xp);
  save(members);
  syncToSupabase(members[id]);
  return members[id];
}

function addBadge(m: MemberProfile, badge: string) {
  if (!m.badges.includes(badge)) m.badges.push(badge);
}

// ─── Badge-system (komplett) ─────────────────────────────────────────────────

export interface BadgeDef {
  id: string;
  emoji: string;
  navn: string;
  beskrivelse: string;
  sjekk: (m: MemberProfile) => boolean;
}

export const ALLE_BADGES: BadgeDef[] = [
  // Meldinger
  { id: 'første_melding',   emoji: '💬', navn: 'Første melding',   beskrivelse: 'Send din første melding',          sjekk: m => m.messages >= 1   },
  { id: '10_meldinger',     emoji: '📣', navn: '10 Meldinger',      beskrivelse: '10 meldinger sendt',               sjekk: m => m.messages >= 10  },
  { id: '100_meldinger',    emoji: '🗨️', navn: '100 Meldinger',    beskrivelse: '100 meldinger sendt',              sjekk: m => m.messages >= 100 },
  { id: '500_meldinger',    emoji: '📢', navn: '500 Meldinger',     beskrivelse: '500 meldinger sendt',              sjekk: m => m.messages >= 500 },
  { id: '1000_meldinger',   emoji: '🏆', navn: '1000 Meldinger',    beskrivelse: '1000 meldinger sendt',             sjekk: m => m.messages >= 1000 },
  // Voice
  { id: 'voice_start',      emoji: '🎙️', navn: 'Voice-deltaker',   beskrivelse: 'Første 5 min i voice-kanal',       sjekk: m => m.voiceMinutes >= 5   },
  { id: 'voice_veteran',    emoji: '🎧', navn: 'Voice Veteran',      beskrivelse: '60 minutter i voice totalt',       sjekk: m => m.voiceMinutes >= 60  },
  { id: 'voice_legend',     emoji: '🎵', navn: 'Voice Legend',       beskrivelse: '300 minutter i voice totalt',      sjekk: m => m.voiceMinutes >= 300 },
  // Streams
  { id: 'stream_fan',       emoji: '📺', navn: 'Stream-fan',         beskrivelse: 'Første stream du deltok i',        sjekk: m => m.streamsAttended >= 1  },
  { id: 'stream_supporter', emoji: '⭐', navn: 'Stream Supporter',   beskrivelse: '5 streams deltatt',                sjekk: m => m.streamsAttended >= 5  },
  { id: 'stream_fanatic',   emoji: '🌟', navn: 'Stream Fanatic',     beskrivelse: '20 streams deltatt',               sjekk: m => m.streamsAttended >= 20 },
  // Subs & support
  { id: 'subscriber',       emoji: '💜', navn: 'Subscriber',         beskrivelse: 'Første gang du subbet',            sjekk: m => m.subs >= 1       },
  { id: 'gifter',           emoji: '🎁', navn: 'Gifter',             beskrivelse: 'Første gang du giftet en sub',     sjekk: m => m.giftSubs >= 1   },
  { id: 'generøs_gifter',   emoji: '💝', navn: 'Generøs Gifter',    beskrivelse: '10 gifted subs totalt',             sjekk: m => m.giftSubs >= 10  },
  // Raids
  { id: 'raider',           emoji: '🚀', navn: 'Raider',             beskrivelse: 'Deltatt i første raid',            sjekk: m => m.raids >= 1  },
  { id: 'warlord',          emoji: '⚔️', navn: 'Warlord',           beskrivelse: '5 raids gjennomført',               sjekk: m => m.raids >= 5  },
  // Streak
  { id: 'på_rekke',         emoji: '🔥', navn: 'På Rekke',           beskrivelse: '7 dager aktiv på rad',             sjekk: m => m.streakDays >= 7  },
  { id: 'ustoppelig',       emoji: '⚡', navn: 'Ustoppelig',         beskrivelse: '30 dager aktiv på rad',             sjekk: m => m.streakDays >= 30 },
  // XP milepæler
  { id: 'veteran',          emoji: '🥉', navn: 'Veteran',            beskrivelse: '1 000 XP opptjent',                sjekk: m => m.xp >= 1000  },
  { id: 'elite',            emoji: '🥈', navn: 'Elite',              beskrivelse: '5 000 XP opptjent',                sjekk: m => m.xp >= 5000  },
  { id: 'legend',           emoji: '🥇', navn: 'Legend',             beskrivelse: '10 000 XP opptjent',               sjekk: m => m.xp >= 10000 },
  { id: 'champion',         emoji: '👑', navn: 'Champion',           beskrivelse: '25 000 XP opptjent',               sjekk: m => m.xp >= 25000 },
];

export function checkAllBadges(m: MemberProfile): string[] {
  const nye: string[] = [];
  for (const b of ALLE_BADGES) {
    if (b.sjekk(m) && !m.badges.includes(b.navn)) {
      m.badges.push(b.navn);
      nye.push(b.emoji + ' ' + b.navn);
    }
  }
  return nye;
}

export function nesteBadge(m: MemberProfile): { badge: BadgeDef; pct: number; mangler: string } | null {
  for (const b of ALLE_BADGES) {
    if (b.sjekk(m)) continue; // allerede oppnådd
    // Beregn progresjon mot denne badgen basert på nøkkeltype
    const pct = badgeProsent(m, b);
    const mangler = badgeMangler(m, b);
    return { badge: b, pct, mangler };
  }
  return null;
}

function badgeProsent(m: MemberProfile, b: BadgeDef): number {
  const id = b.id;
  if (id.includes('melding'))    return Math.min(99, (m.messages   / badgeTerskel(id, 'melding'))   * 100);
  if (id.includes('voice'))      return Math.min(99, (m.voiceMinutes / badgeTerskel(id, 'voice'))   * 100);
  if (id.includes('stream'))     return Math.min(99, (m.streamsAttended / badgeTerskel(id,'stream'))* 100);
  if (id.includes('raid'))       return Math.min(99, (m.raids / badgeTerskel(id, 'raid'))           * 100);
  if (id.includes('streak') || id === 'på_rekke' || id === 'ustoppelig')
                                  return Math.min(99, (m.streakDays / badgeTerskel(id, 'streak'))   * 100);
  if (id === 'veteran')          return Math.min(99, (m.xp / 1000)  * 100);
  if (id === 'elite')            return Math.min(99, (m.xp / 5000)  * 100);
  if (id === 'legend')           return Math.min(99, (m.xp / 10000) * 100);
  if (id === 'champion')         return Math.min(99, (m.xp / 25000) * 100);
  return 0;
}

function badgeTerskel(id: string, type: string): number {
  const t: Record<string, number> = {
    første_melding: 1, '10_meldinger': 10, '100_meldinger': 100, '500_meldinger': 500, '1000_meldinger': 1000,
    voice_start: 5, voice_veteran: 60, voice_legend: 300,
    stream_fan: 1, stream_supporter: 5, stream_fanatic: 20,
    raider: 1, warlord: 5,
    på_rekke: 7, ustoppelig: 30,
  };
  return t[id] ?? 1;
}

function badgeMangler(m: MemberProfile, b: BadgeDef): string {
  const id = b.id;
  if (id.includes('melding')) { const t = badgeTerskel(id,'melding'); return `${t - m.messages} meldinger til`; }
  if (id.includes('voice'))   { const t = badgeTerskel(id,'voice');   return `${t - m.voiceMinutes} min voice til`; }
  if (id.includes('stream'))  { const t = badgeTerskel(id,'stream');  return `${t - m.streamsAttended} streams til`; }
  if (id.includes('raid'))    { const t = badgeTerskel(id,'raid');    return `${t - m.raids} raids til`; }
  if (id === 'på_rekke')      return `${7  - m.streakDays} dager til`;
  if (id === 'ustoppelig')    return `${30 - m.streakDays} dager til`;
  if (id === 'veteran')       return `${1000  - m.xp} XP til`;
  if (id === 'elite')         return `${5000  - m.xp} XP til`;
  if (id === 'legend')        return `${10000 - m.xp} XP til`;
  if (id === 'champion')      return `${25000 - m.xp} XP til`;
  if (id === 'subscriber')    return 'Subskriber for første gang';
  if (id === 'gifter')        return 'Gift en sub';
  return '?';
}
