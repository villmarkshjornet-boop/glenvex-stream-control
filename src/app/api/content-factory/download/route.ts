/**
 * Download Center for Content Factory
 * Returnerer signerte nedlastings-URLs for ferdige assets
 * KREVER: CONTENT_FACTORY_ENABLED=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const vodId = new URL(req.url).searchParams.get('vodId');
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  // Hent alt tilhørende VOD-en
  const [vodsRes, highlightsRes, assetsRes, copyRes, køRes] = await Promise.all([
    vodId
      ? db.from('content_vods').select('*').eq('id', vodId).single()
      : db.from('content_vods').select('*').eq('workspace_id', getWorkspaceId()).order('created_at', { ascending: false }),
    vodId ? db.from('content_highlights').select('*').eq('vod_id', vodId).order('rank') : Promise.resolve({ data: [] }),
    vodId ? db.from('content_assets').select('*').eq('vod_id', vodId) : Promise.resolve({ data: [] }),
    vodId ? db.from('content_copy').select('*').eq('vod_id', vodId) : Promise.resolve({ data: [] }),
    vodId ? db.from('content_review_queue').select('*').eq('vod_id', vodId).eq('status', 'PENDING') : Promise.resolve({ data: [] }),
  ]);

  if (vodId) {
    const vod = (vodsRes as any).data;
    const highlights = (highlightsRes as any).data ?? [];
    const assets = (assetsRes as any).data ?? [];
    const copy = (copyRes as any).data ?? [];
    const kø = (køRes as any).data ?? [];

    // Bygg nedlastingspakke per highlight
    const pakker = highlights.map((h: any) => {
      const hAssets = assets.filter((a: any) => a.highlight_id === h.id);
      const hCopy = copy.filter((c: any) => c.highlight_id === h.id);

      return {
        highlight: {
          id: h.id,
          rank: h.rank,
          tittel: h.title,
          score: h.score,
          kategori: h.category,
          begrunnelse: h.begrunnelse,
          start: h.start_time,
          slutt: h.end_time,
        },
        videoer: hAssets.map((a: any) => ({
          type: a.type,
          format: a.format,
          status: a.status,
          url: a.storage_url,
          path: a.storage_path,
          størrelse: a.file_size_bytes,
        })),
        tekster: {
          youtube: hCopy.find((c: any) => c.platform === 'youtube'),
          tiktok: hCopy.find((c: any) => c.platform === 'tiktok'),
          instagram: hCopy.find((c: any) => c.platform === 'instagram'),
          discord: hCopy.find((c: any) => c.platform === 'discord'),
        },
      };
    });

    return NextResponse.json({
      vod,
      pakker,
      køStatus: { venter: kø.length },
      sammendrag: {
        antallHighlights: highlights.length,
        antallAssets: assets.length,
        antallTekster: copy.length,
        venterGodkjenning: kø.length,
      },
    });
  }

  // Uten vodId – returner liste over alle VODs
  return NextResponse.json({ vods: (vodsRes as any).data ?? [] });
}
