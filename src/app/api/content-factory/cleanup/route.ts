import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

// POST /api/content-factory/cleanup
// Setter ANALYZING/PENDING jobber som har stått >30 min uten Railway-aktivitet til FAILED
export async function POST() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min siden

  const { data: staleVods } = await db
    .from('content_vods')
    .select('id,title,created_at')
    .eq('workspace_id', getWorkspaceId())
    .in('status', ['ANALYZING', 'PENDING'])
    .lt('created_at', cutoff);

  if (!staleVods || staleVods.length === 0) {
    return NextResponse.json({ ok: true, ryddet: 0 });
  }

  // Sjekk Railway for hver – sett FAILED kun hvis Railway svarer UNKNOWN eller ikke svarer
  const botApiUrl = process.env.BOT_API_URL;
  let ryddet = 0;

  for (const vod of staleVods) {
    let railwayStatus = 'UNKNOWN';

    if (botApiUrl) {
      try {
        const res = await fetch(`${botApiUrl}/content-factory/status/${vod.id}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const st = await res.json();
          railwayStatus = st.status ?? 'UNKNOWN';
        }
      } catch {}
    }

    // Sett FAILED hvis Railway ikke vet om jobben
    if (railwayStatus === 'UNKNOWN') {
      await db.from('content_vods').update({
        status: 'FAILED',
        error_message: 'Jobb henger: Railway har ingen data for denne VOD-en. Klikk Retry for å starte på nytt.',
        progress_percent: 0,
        current_step: null,
      }).eq('id', vod.id);
      ryddet++;
    }
  }

  return NextResponse.json({ ok: true, ryddet, totaltSjekket: staleVods.length });
}
