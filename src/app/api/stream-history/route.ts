import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'stream-history.json');

export async function GET() {
  try {
    if (!fs.existsSync(FILE)) return NextResponse.json([]);
    return NextResponse.json(JSON.parse(fs.readFileSync(FILE, 'utf-8')));
  } catch {
    return NextResponse.json([]);
  }
}
