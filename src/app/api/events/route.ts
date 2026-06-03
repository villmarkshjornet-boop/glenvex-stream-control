import { NextResponse } from 'next/server';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await hentBotData('events');
    return NextResponse.json(data ?? { weekNumber: 0, raids: [], giftSubs: [] });
  } catch {
    return NextResponse.json({ weekNumber: 0, raids: [], giftSubs: [] });
  }
}
