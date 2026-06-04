import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

async function getSettingsFromDb(): Promise<any | null> {
  if (!isDbAvailable()) return null;
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', getWorkspaceId())
    .single();
  return data?.settings_json ?? null;
}

async function saveSettingsToDb(settings: any): Promise<boolean> {
  if (!isDbAvailable()) return false;
  const db = getDb();
  if (!db) return false;
  const { error } = await db
    .from('workspaces')
    .update({ settings_json: settings, updated_at: new Date().toISOString() })
    .eq('id', getWorkspaceId());
  return !error;
}

export async function GET() {
  // Prøv Supabase først, fallback til fil
  const dbSettings = await getSettingsFromDb();
  if (dbSettings && Object.keys(dbSettings).length > 0) {
    const fileSettings = getSettings();
    return NextResponse.json({ ...fileSettings, ...dbSettings });
  }
  return NextResponse.json(getSettings());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Lagre i Supabase (primær)
    const dbOk = await saveSettingsToDb(body);

    // Lagre i fil (fallback/Railway)
    const updated = saveSettings(body);

    addLog('info', `Innstillinger oppdatert${dbOk ? ' (Supabase)' : ' (fil)'}`, 'OK');
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
}
