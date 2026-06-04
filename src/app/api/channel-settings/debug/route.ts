import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getPartnerKanalId, getAnnonseringsKanalId, getChatKanalId, getStreamplanKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Hva er lagret i Supabase?
  let supabaseData: any = null;
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', getWorkspaceId())
        .single();
      supabaseData = data?.settings_json ?? null;
    }
  }

  // Hva velger systemet for hver kanal?
  const [partner, announce, chat, streamplan] = await Promise.all([
    getPartnerKanalId(),
    getAnnonseringsKanalId(),
    getChatKanalId(),
    getStreamplanKanalId(),
  ]);

  return NextResponse.json({
    workspaceId: getWorkspaceId(),
    supabaseHarData: !!supabaseData,
    lagretISupabase: supabaseData?.kanalPreferanser ?? null,
    valgtKanal: { partner, announce, chat, streamplan },
  });
}
