import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'members.json');

export async function GET() {
  try {
    if (!fs.existsSync(FILE)) return NextResponse.json([]);
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    const members = Object.values(data).sort((a: any, b: any) => b.xp - a.xp);
    return NextResponse.json(members);
  } catch {
    return NextResponse.json([]);
  }
}
