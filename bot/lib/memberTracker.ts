import fs from 'fs';
import path from 'path';
import { getBotDb, WORKSPACE_ID } from './supabase';

const FILE = path.join(process.cwd(), 'data', 'members.json');

export interface MemberProfile {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  messages: number;
  streamsWatched: number;
  subs: number;
  giftSubs: number;
  raids: number;
  joinedAt: string;
  lastSeen: string;
  lastWelcomed: string | null;
  badges: string[];
}

const XP_PER_MESSAGE = 5;
const XP_PER_LEVEL = 500;
const MESSAGE_COOLDOWN_MS = 60_000; // 1 min mellom XP for samme bruker
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

function syncToSupabase(member: MemberProfile): void {
  const db = getBotDb();
  if (!db) return;
  (async () => {
    try {
      await db.from('community_members').upsert({
        workspace_id: WORKSPACE_ID,
        discord_id: member.id,
        username: member.username,
        display_name: member.displayName,
        xp: member.xp,
        level: member.level,
        messages: member.messages,
        subs: member.subs,
        gift_subs: member.giftSubs,
        raids: member.raids,
        badges: member.badges,
        last_seen: member.lastSeen,
        last_welcomed: member.lastWelcomed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,discord_id' });
    } catch {}
  })();
}

export function getMember(id: string): MemberProfile | null {
  return load()[id] ?? null;
}

export function getAllMembers(): MemberProfile[] {
  return Object.values(load()).sort((a, b) => b.xp - a.xp);
}

export function upsertMember(id: string, username: string, displayName: string): MemberProfile {
  const members = load();
  if (!members[id]) {
    members[id] = {
      id, username, displayName, xp: 0, level: 1, messages: 0,
      streamsWatched: 0, subs: 0, giftSubs: 0, raids: 0,
      joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
      lastWelcomed: null, badges: [],
    };
  } else {
    members[id].lastSeen = new Date().toISOString();
    members[id].displayName = displayName;
  }
  save(members);
  return members[id];
}

export function addMessageXP(id: string, username: string, displayName: string): { leveledUp: boolean; newLevel: number } | null {
  const last = messageCooldowns.get(id);
  if (last && Date.now() - last < MESSAGE_COOLDOWN_MS) return null;
  messageCooldowns.set(id, Date.now());

  const members = load();
  const m = members[id] ?? { id, username, displayName, xp: 0, level: 1, messages: 0, streamsWatched: 0, subs: 0, giftSubs: 0, raids: 0, joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), lastWelcomed: null, badges: [] };

  const oldLevel = m.level;
  m.xp += XP_PER_MESSAGE;
  m.messages += 1;
  m.level = levelFromXP(m.xp);
  m.lastSeen = new Date().toISOString();

  if (m.messages === 1) addBadge(m, 'Første melding');
  if (m.messages === 100) addBadge(m, '100 Meldinger');
  if (m.messages === 500) addBadge(m, '500 Meldinger');

  members[id] = m;
  save(members);
  syncToSupabase(m).catch(() => {});

  const leveledUp = m.level > oldLevel;
  return { leveledUp, newLevel: m.level };
}

export function addSub(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, subs: (m.subs || 0) + 1, xp: m.xp + 200 };
  if (members[id].subs === 1) addBadge(members[id], 'Første Sub');
  save(members);
}

export function addGiftSub(id: string, username: string, displayName: string, count: number) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, giftSubs: (m.giftSubs || 0) + count, xp: m.xp + count * 100 };
  save(members);
}

export function addRaid(id: string, username: string, displayName: string) {
  const members = load();
  const m = upsertMember(id, username, displayName);
  members[id] = { ...m, raids: (m.raids || 0) + 1, xp: m.xp + 500 };
  save(members);
}

export function setLastWelcomed(id: string) {
  const members = load();
  if (members[id]) {
    members[id].lastWelcomed = new Date().toISOString();
    save(members);
  }
}

function addBadge(m: MemberProfile, badge: string) {
  if (!m.badges.includes(badge)) m.badges.push(badge);
}
