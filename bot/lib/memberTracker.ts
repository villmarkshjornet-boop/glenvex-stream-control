import fs from 'fs';
import path from 'path';
import { logSystemEvent } from './systemEvents';

const FILE = path.join(process.cwd(), 'data', 'members.json');
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

export interface MemberProfile {
  id: string;
  username: string;
  displayName: string;
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

const XP_PER_MESSAGE  = 5;
const XP_PER_LEVEL    = 500;
const DEFAULT_COOLDOWN_MS = 60_000;

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

// ─── Supabase sync ───────────────────────────────────────────────────────────

function syncToSupabase(m: MemberProfile): void {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  const payload = {
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
  };

  fetch(`${sbUrl}/rest/v1/community_members`, {
    method: 'POST',
    headers: {
      apikey:           sbKey,
      Authorization:    `Bearer ${sbKey}`,
      'Content-Type':   'application/json',
      Prefer:           'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  }).then(async (r) => {
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn(`[MemberTracker] syncToSupabase feilet for ${m.username}: ${r.status} ${body.slice(0, 200)}`);
    }
  }).catch((err: any) => {
    console.warn(`[MemberTracker] syncToSupabase nettverksfeil for ${m.username}:`, err?.message);
  });
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

export async function lasterMedlemmerFraSupabase(): Promise<void> {
  // Alltid last fra Supabase ved oppstart — Railway-disken er ephemeral, filen kan eksistere
  // fra tidligere i samme container men er utdatert. Merge inn Supabase-data i lokal fil.
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/community_members?workspace_id=eq.${WORKSPACE_ID}&select=*`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (!res.ok) {
      console.warn(`[MemberTracker] Supabase-henting feilet: ${res.status}`);
      return;
    }
    const rows = await res.json() as any[];
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

export function upsertMember(id: string, username: string, displayName: string): MemberProfile {
  const members = load();
  if (!members[id]) {
    members[id] = {
      id, username, displayName, twitchId: null, xp: 0, level: 1,
      messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
      subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
      streakDays: 0, lastStreakDate: null,
      joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
      lastWelcomed: null, badges: [],
    };
  } else {
    members[id].lastSeen = new Date().toISOString();
    members[id].displayName = displayName;
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
): { leveledUp: boolean; newLevel: number } | null {

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
  m.xp += XP_PER_MESSAGE;
  m.messages += 1;
  m.level = levelFromXP(m.xp);
  m.lastSeen = new Date().toISOString();

  if (m.messages === 1)   addBadge(m, 'Første melding');
  if (m.messages === 100) addBadge(m, '100 Meldinger');
  if (m.messages === 500) addBadge(m, '500 Meldinger');

  // Streak
  updateStreak(m);

  members[id] = m;
  computeScores(m);
  save(members);
  syncToSupabase(m);

  logSystemEvent({
    source:     'community_manager',
    event_type: 'COMMUNITY_XP_GRANTED',
    title:      `XP tildelt: ${displayName} +${XP_PER_MESSAGE} XP (Total: ${m.xp}, Level ${m.level})`,
    severity:   'info',
    metadata:   { userId: id, username: displayName, xpGranted: XP_PER_MESSAGE, totalXp: m.xp, level: m.level, messages: m.messages },
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

  return { leveledUp, newLevel: m.level };
}

// ─── Other XP actions ─────────────────────────────────────────────────────────

export function addSub(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, subs: (m.subs || 0) + 1, xp: m.xp + 200 };
  if (members[id].subs === 1) addBadge(members[id], 'Første Sub');
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
  members[id] = { ...m, voiceMinutes: (m.voiceMinutes || 0) + minutes, xp: m.xp + minutes };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  if (minutes >= 5) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
      title: `XP tildelt (voice): ${displayName} +${minutes} XP (${minutes} min)`,
      severity: 'info',
      metadata: { userId: id, username: displayName, xpGranted: minutes, reason: 'voice', minutes, totalXp: members[id].xp },
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
  members[id] = { ...members[id], streamsAttended: (m.streamsAttended || 0) + 1, xp: m.xp + 50 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_XP_GRANTED',
    title: `XP tildelt (stream-deltakelse): ${displayName} +50 XP`,
    severity: 'info',
    metadata: { userId: id, username: displayName, xpGranted: 50, reason: 'stream_attendance', totalXp: members[id].xp },
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

function addBadge(m: MemberProfile, badge: string) {
  if (!m.badges.includes(badge)) m.badges.push(badge);
}
