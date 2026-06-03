import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'community-memory.json');

function load() {
  try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch {}
  return [];
}

function save(data: any[]) {
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
  const body = await req.json();
  const data = load();
  const ny = { ...body, id: randomUUID(), dato: new Date().toISOString() };
  data.unshift(ny);
  save(data);
  return NextResponse.json(ny);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  save(load().filter((n: any) => n.id !== id));
  return NextResponse.json({ ok: true });
}
