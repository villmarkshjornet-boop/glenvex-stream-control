import { NextRequest, NextResponse } from 'next/server';
import { getLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
  const type = searchParams.get('type');

  let logs = getLogs();

  if (type) {
    logs = logs.filter((l) => l.type === type);
  }

  return NextResponse.json(logs.slice(0, limit));
}
