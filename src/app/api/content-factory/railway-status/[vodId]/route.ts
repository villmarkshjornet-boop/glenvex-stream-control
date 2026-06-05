import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const botApiUrl = process.env.BOT_API_URL;
  const vodId = params.vodId;

  // Prøv Railway direkte (lokal fil-status)
  if (botApiUrl) {
    try {
      const res = await fetch(`${botApiUrl}/content-factory/status/${vodId}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = await res.json();
        // Ikke returner UNKNOWN fra Railway – fall gjennom til Supabase
        if (data.status && data.status !== 'UNKNOWN') {
          return NextResponse.json(data);
        }
      }
    } catch {
      // Fall gjennom til Supabase-fallback
    }
  }

  // Fallback: les fra Supabase content_vods
  try {
    const db = getDb();
    if (!db) return NextResponse.json({ status: 'UNKNOWN', melding: 'Supabase ikke tilkoblet' });

    const { data } = await db
      .from('content_vods')
      .select('status, status_message, current_step, progress_percent, error_message')
      .eq('id', vodId)
      .single();

    if (!data) return NextResponse.json({ status: 'UNKNOWN', melding: 'VOD ikke funnet' });

    // Map Supabase-status til Railway-format
    const statusMap: Record<string, string> = {
      ANALYZING: 'DOWNLOADING',
      TRANSCRIBED: 'COMPLETE',
      COMPLETE: 'COMPLETE',
      FAILED: 'FAILED',
      PENDING: 'PENDING',
    };

    return NextResponse.json({
      status: statusMap[data.status] ?? data.status,
      melding: data.status_message ?? data.error_message ?? '',
      sisteOppdatering: new Date().toISOString(),
      transcribed: data.status === 'TRANSCRIBED' || data.status === 'COMPLETE',
      _kilde: 'supabase',
    });
  } catch {
    return NextResponse.json({ status: 'UNKNOWN', melding: 'Kunne ikke hente status' });
  }
}
