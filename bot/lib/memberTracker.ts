import fs from 'fs';
import path from 'path';

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
  joinedAt: string;
  lastSeen: string;
  lastWelcomed: string | null;
  badges: string[];
}

const XP_PER_MESSAGE = 5;
const XP_PER_LEVEL = 500;
const MESSAGE_COOLDOWN_MS = 60_000;
const messageCooldowns = new Map<string, number>();

export function levelFromXP(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpToNextLevel(xp: number): number {
  const currentLevelXP = (levelFromXP(xp) - 1) * XP_PER_LEVEL;
  return XP_PER_LEVEL - (xp - currentLevelXP);
}

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

// ── Supabase REST API – upsert ett member (fire-and-forget) ──────────────────
function syncToSupabase(m: MemberProfile): void {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  const payload = {
    discord_id: m.id,
    workspace_id: WORKSPACE_ID,
    username: m.username,
    display_name: m.displayName,
    twitch_id: m.twitchId ?? null,
    xp: m.xp,
    level: m.level,
    messages: m.messages,
    reactions: m.reactions,
    voice_minutes: m.voiceMinutes,
    streams_attended: m.streamsAttended,
    subs: m.subs,
    gift_subs: m.giftSubs,
    raids: m.raids,
    engagement_score: m.engagementScore,
    community_score: m.communityScore,
    badges: m.badges,
    last_seen: m.lastSeen,
    last_welcomed: m.lastWelcomed,
    joined_at: m.joinedAt,
  };

  fetch(`${sbUrl}/rest/v1/community_members`, {
    method: 'POST',
    headers: {
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// ── Startup: last inn fra Supabase hvis lokal fil mangler ─────────────────────
export async function lasterMedlemmerFraSupabase(): Promise<void> {
  if (fs.existsSync(FILE)) return; // lokal fil finnes – ingen import nødvendig
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;

  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/community_members?workspace_id=eq.${WORKSPACE_ID}&select=*`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    if (!res.ok) return;
    const rows = await res.json() as any[];
    if (!rows || rows.length === 0) return;

    const members: Record<string, MemberProfile> = {};
    for (const r of rows) {
      members[r.discord_id] = {
        id: r.discord_id,
        username: r.username,
        displayName: r.display_name,
        twitchId: r.twitch_id ?? null,
        xp: r.xp ?? 0,
        level: r.level ?? 1,
        messages: r.messages ?? 0,
        reactions: r.reactions ?? 0,
        voiceMinutes: r.voice_minutes ?? 0,
        streamsWatched: 0,
        streamsAttended: r.streams_attended ?? 0,
        subs: r.subs ?? 0,
        giftSubs: r.gift_subs ?? 0,
        raids: r.raids ?? 0,
        engagementScore: r.engagement_score ?? 0,
        communityScore: r.community_score ?? 0,
        joinedAt: r.joined_at ?? r.created_at ?? new Date().toISOString(),
        lastSeen: r.last_seen ?? new Date().toISOString(),
        lastWelcomed: r.last_welcomed ?? null,
        badges: r.badges ?? [],
      };
    }
    save(members);
    console.log(`[MemberTracker] Gjenopprettet ${rows.length} membres fra Supabase etter Railway-restart`);
  } catch (err: any) {
    console.error('[MemberTracker] Supabase-import feilet:', err.message);
  }
}

export function getMember(id: string): MemberProfile | null {
  return load()[id] ?? null;
}

export function getAllMembers(): MemberProfile[] {
  return Object.values(load()).sort((a, b) => b.xp - a.xp);
}

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

export function upsertMember(id: string, username: string, displayName: string): MemberProfile {
  const members = load();
  if (!members[id]) {
    members[id] = {
      id, username, displayName, twitchId: null, xp: 0, level: 1,
      messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
      subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
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

export function addMessageXP(id: string, username: string, displayName: string): { leveledUp: boolean; newLevel: number } | null {
  const last = messageCooldowns.get(id);
  if (last && Date.now() - last < MESSAGE_COOLDOWN_MS) return null;
  messageCooldowns.set(id, Date.now());

  const members = load();
  const m: MemberProfile = members[id] ?? {
    id, username, displayName, twitchId: null, xp: 0, level: 1,
    messages: 0, reactions: 0, voiceMinutes: 0, streamsWatched: 0, streamsAttended: 0,
    subs: 0, giftSubs: 0, raids: 0, engagementScore: 0, communityScore: 0,
    joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    lastWelcomed: null, badges: [],
  };

  const oldLevel = m.level;
  m.xp += XP_PER_MESSAGE;
  m.messages += 1;
  m.level = levelFromXP(m.xp);
  m.lastSeen = new Date().toISOString();

  if (m.messages === 1) addBadge(m, 'Første melding');
  if (m.messages === 100) addBadge(m, '100 Meldinger');
  if (m.messages === 500) addBadge(m, '500 Meldinger');

  members[id] = m;
  computeScores(m);
  save(members);
  syncToSupabase(m);

  return { leveledUp: m.level > oldLevel, newLevel: m.level };
}

export function addSub(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, subs: (m.subs || 0) + 1, xp: m.xp + 200 };
  if (members[id].subs === 1) addBadge(members[id], 'Første Sub');
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
}

export function addGiftSub(id: string, username: string, displayName: string, count: number) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, giftSubs: (m.giftSubs || 0) + count, xp: m.xp + count * 100 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
}

export function addRaid(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, raids: (m.raids || 0) + 1, xp: m.xp + 500 };
  computeScores(members[id]);
  save(members);
  syncToSupabase(members[id]);
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
