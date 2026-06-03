import { NextRequest, NextResponse } from 'next/server';
import { hentBotData } from '@/lib/botData';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'glencoins.json');

interface Wallet {
  userId: string;
  brukernavn: string;
  coins: number;
  totaltTjent: number;
  historikk: { type: string; mengde: number; dato: string }[];
}

function load(): Record<string, Wallet> {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return {};
}

function save(data: Record<string, Wallet>) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export async function GET() {
  // Sync coins fra member XP hvis tilgjengelig
  const members = await hentBotData('members') ?? {};
  const wallets = load();

  // Auto-sync fra member tracker
  for (const [id, m] of Object.entries(members) as any[]) {
    if (!wallets[id]) {
      wallets[id] = {
        userId: id,
        brukernavn: m.displayName ?? m.username,
        coins: Math.floor(m.xp / 10), // 1 coin per 10 XP
        totaltTjent: Math.floor(m.xp / 10),
        historikk: [],
      };
    }
  }

  const leaderboard = Object.values(wallets).sort((a, b) => b.coins - a.coins);
  const totalCoins = leaderboard.reduce((s, w) => s + w.coins, 0);

  return NextResponse.json({ leaderboard, totalCoins, wallets });
}

export async function POST(req: NextRequest) {
  const { userId, brukernavn, mengde, type } = await req.json() as {
    userId: string; brukernavn: string; mengde: number; type: 'gi' | 'trekk';
  };

  const wallets = load();
  if (!wallets[userId]) {
    wallets[userId] = { userId, brukernavn, coins: 0, totaltTjent: 0, historikk: [] };
  }

  const endring = type === 'gi' ? mengde : -mengde;
  wallets[userId].coins = Math.max(0, wallets[userId].coins + endring);
  if (type === 'gi') wallets[userId].totaltTjent += mengde;
  wallets[userId].historikk.unshift({ type, mengde: endring, dato: new Date().toISOString() });
  wallets[userId].historikk = wallets[userId].historikk.slice(0, 50);

  save(wallets);
  return NextResponse.json({ ok: true, wallet: wallets[userId] });
}
