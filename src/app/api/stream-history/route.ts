import { NextResponse } from 'next/server';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await hentBotData('stream-history');
  return NextResponse.json(data ?? []);
}
