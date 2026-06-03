import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'goals.json');

export interface Goal {
  type: 'followers' | 'subscribers' | 'viewers';
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

function load(): Goal[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: Goal[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const data = await req.json() as Goal[];
  save(data);
  return NextResponse.json({ ok: true });
}
