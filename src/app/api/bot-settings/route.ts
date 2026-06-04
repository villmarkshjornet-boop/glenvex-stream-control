import { NextRequest, NextResponse } from 'next/server';
import { getBotSettings, saveBotSettings } from '@/lib/botMemory';
import { getRecentMemory } from '@/lib/botMemory';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = getBotSettings();
  const memory = getRecentMemory(undefined, 20);
  return NextResponse.json({ settings, memory });
}

export async function PATCH(req: NextRequest) {
  const updates = await req.json();
  saveBotSettings(updates);
  return NextResponse.json({ ok: true, settings: getBotSettings() });
}
