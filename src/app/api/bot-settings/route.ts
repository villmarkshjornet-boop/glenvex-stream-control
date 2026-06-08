import { NextRequest, NextResponse } from 'next/server';
import { getBotSettings, saveBotSettings } from '@/lib/botMemory';
import { getRecentMemory } from '@/lib/botMemory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = getBotSettings();
  const memory = getRecentMemory(undefined, 20);
  return NextResponse.json({ settings, memory });
}

export async function PATCH(req: NextRequest) {
  const updates = await req.json();
  saveBotSettings(updates);

  // Sync to Supabase so Railway bot picks up changes via botKanalPreferanser
  const db = getDb();
  if (db) {
    try {
      const wsId = getWorkspaceId();
      const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
      const current = (data as any)?.settings_json ?? {};
      const botSettings = { ...(current.botSettings ?? {}), ...updates };
      await db.from('workspaces')
        .update({ settings_json: { ...current, botSettings }, updated_at: new Date().toISOString() })
        .eq('id', wsId);
    } catch {}
  }

  return NextResponse.json({ ok: true, settings: getBotSettings() });
}
