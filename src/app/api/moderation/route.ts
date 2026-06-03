import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'moderation.json');

function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return { health: 80, positiv: 60, nøytral: 30, negativ: 10, varsler: [], siste: [] };
}

export async function GET() {
  return NextResponse.json(load());
}
