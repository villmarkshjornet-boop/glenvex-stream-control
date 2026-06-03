import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DATA_FILE = path.join(process.cwd(), 'data', 'events.json');

export async function GET() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return NextResponse.json({ weekNumber: 0, raids: [], giftSubs: [] });
    }
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return NextResponse.json(raw);
  } catch {
    return NextResponse.json({ weekNumber: 0, raids: [], giftSubs: [] });
  }
}
