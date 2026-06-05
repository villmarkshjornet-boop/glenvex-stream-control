/**
 * Content Factory Phase 2
 * Kjøres etter at Railway Phase 1 er COMPLETE.
 * Leser transkripsjon fra Supabase → Highlights → Ranking → Copywriting → Queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { hentVod, oppdaterVodStatus } from '@/lib/content-factory/vod/vodService';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId, stegKun } = await req.json() as { vodId: string; stegKun?: string };

  if (!vodId) {
    return NextResponse.json({ error: 'vodId kreves' }, { status: 400 });
  }

  const vod = await hentVod(vodId);
  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  const steg: { steg: string; status: string; melding?: string }[] = [];

  // Sjekk at transkripsjon finnes
  const db = getDb();
  const antall = db ? await db.from('content_transcripts').select('id', { count: 'exact', head: true })
    .eq('vod_id', vodId).then(r => r.count ?? 0) : 0;

  if ((antall as number) === 0) {
    return NextResponse.json({
      ok: false,
      error: `Ingen transkripsjon funnet for ${vodId}. Railway Phase 1 må fullføres først.`,
      steg: [{ steg: 'TRANSCRIBE', status: 'FEILET', melding: 'Ingen data i Supabase' }],
    });
  }

  steg.push({ steg: 'TRANSCRIBE', status: 'OK', melding: `${antall} segmenter` });

  // Kun ett steg om gangen for å unngå timeout
  if (!stegKun || stegKun === 'DISCOVER') {
    try {
      const { oppdagHighlights } = await import('@/lib/content-factory/analysis/highlightDiscovery');
      const highlights = await oppdagHighlights(vodId);
      steg.push({ steg: 'DISCOVER', status: 'OK', melding: `${highlights.length} highlights` });
    } catch (err) {
      steg.push({ steg: 'DISCOVER', status: 'FEILET', melding: (err as Error).message });
      return NextResponse.json({ ok: false, steg });
    }
  }

  if (!stegKun || stegKun === 'RANK') {
    try {
      const { rangerHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
      await rangerHighlights(vodId);
      steg.push({ steg: 'RANK', status: 'OK' });
    } catch (err) {
      steg.push({ steg: 'RANK', status: 'FEILET', melding: (err as Error).message });
    }
  }

  if (!stegKun || stegKun === 'COPYWRITE') {
    try {
      const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
      const { genererCopyForAlle } = await import('@/lib/content-factory/copywriter/copywriterService');
      const topp = await hentToppHighlights(vodId, 5);
      const copy = await genererCopyForAlle(vodId, topp, vod.title ?? '', vod.category ?? '');
      steg.push({ steg: 'COPYWRITE', status: 'OK', melding: `${copy.length} tekster` });
    } catch (err) {
      steg.push({ steg: 'COPYWRITE', status: 'FEILET', melding: (err as Error).message });
    }
  }

  if (!stegKun || stegKun === 'QUEUE') {
    try {
      const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
      const { leggIReviewKø } = await import('@/lib/content-factory/review/reviewQueue');
      const topp = await hentToppHighlights(vodId, 5);
      await leggIReviewKø(vodId, topp.map(h => ({ highlightId: h.id, type: `highlight_${h.category}` })));
      steg.push({ steg: 'QUEUE', status: 'OK', melding: `${topp.length} items` });
    } catch (err) {
      steg.push({ steg: 'QUEUE', status: 'FEILET', melding: (err as Error).message });
    }
  }

  await oppdaterVodStatus(vodId, 'COMPLETE');

  const highlights = db ? await db.from('content_highlights').select('id').eq('vod_id', vodId).then(r => r.data?.length ?? 0) : 0;
  const copy = db ? await db.from('content_copy').select('id').eq('vod_id', vodId).then(r => r.data?.length ?? 0) : 0;

  return NextResponse.json({ ok: true, steg, antallHighlights: highlights, antallCopy: copy });
}
