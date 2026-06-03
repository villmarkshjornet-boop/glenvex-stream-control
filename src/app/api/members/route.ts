import { NextResponse } from 'next/server';
import { hentBotData } from '@/lib/botData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await hentBotData('members');
    if (!data) return NextResponse.json([]);
    const members = Object.values(data).sort((a: any, b: any) => b.xp - a.xp);
    return NextResponse.json(members);
  } catch {
    return NextResponse.json([]);
  }
}
