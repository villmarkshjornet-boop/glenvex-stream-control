import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'events.json');

interface Raid {
  username: string;
  viewers: number;
  timestamp: string;
}

interface GiftSub {
  username: string;
  count: number;
  timestamp: string;
}

interface EventData {
  weekNumber: number;
  raids: Raid[];
  giftSubs: GiftSub[];
}

function currentWeek(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

function load(): EventData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as EventData;
      if (raw.weekNumber !== currentWeek()) {
        return { weekNumber: currentWeek(), raids: [], giftSubs: [] };
      }
      return raw;
    }
  } catch {}
  return { weekNumber: currentWeek(), raids: [], giftSubs: [] };
}

function save(data: EventData) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function trackRaid(username: string, viewers: number) {
  const data = load();
  data.raids.push({ username, viewers, timestamp: new Date().toISOString() });
  save(data);
  // Raids lagres i lokal fil – nok for statistikk
}

export function trackGiftSub(username: string, count: number) {
  const data = load();
  const existing = data.giftSubs.find(g => g.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.count += count;
  } else {
    data.giftSubs.push({ username, count, timestamp: new Date().toISOString() });
  }
  save(data);
}

export function getWeeklyData(): EventData {
  return load();
}

export function topRaids(n = 3): Raid[] {
  return load().raids.sort((a, b) => b.viewers - a.viewers).slice(0, n);
}

export function topGiftSubs(n = 3): GiftSub[] {
  return load().giftSubs.sort((a, b) => b.count - a.count).slice(0, n);
}
