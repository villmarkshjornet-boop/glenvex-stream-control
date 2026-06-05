/**
 * Content Factory Phase 2
 * Kalles av klienten etter at Railway (Phase 1) er ferdig.
 * Input: vodId + signedUrl fra Supabase Storage
 * Kjører: Whisper → Highlights → Ranking → Copywriting → Queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { hentVod, oppdaterVodStatus } from '@/lib/content-factory/vod/vodService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { vodId, signedUrl } = await req.json() as { vodId: string; signedUrl: string };

  if (!vodId || !signedUrl) {
    return NextResponse.json({ error: 'vodId og signedUrl kreves' }, { status: 400 });
  }

  const vod = await hentVod(vodId);
  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  const steg: { steg: string; status: string; melding?: string }[] = [];

  // TRANSCRIBE
  try {
    const { transkriber } = await import('@/lib/content-factory/transcripts/whisperService');
    await transkriber(vodId, signedUrl);
    steg.push({ steg: 'TRANSCRIBE', status: 'OK' });
  } catch (err) {
    steg.push({ steg: 'TRANSCRIBE', status: 'FEILET', melding: (err as Error).message });
    return NextResponse.json({ steg, antallHighlights: 0, antallCopy: 0 });
  }

  // DISCOVER
  let highlights: any[] = [];
  try {
    const { oppdagHighlights } = await import('@/lib/content-factory/analysis/highlightDiscovery');
    highlights = await oppdagHighlights(vodId);
    steg.push({ steg: 'DISCOVER', status: 'OK', melding: `${highlights.length} highlights` });
  } catch (err) {
    steg.push({ steg: 'DISCOVER', status: 'FEILET', melding: (err as Error).message });
  }

  // RANK
  try {
    const { rangerHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
    await rangerHighlights(vodId);
    steg.push({ steg: 'RANK', status: 'OK' });
  } catch (err) {
    steg.push({ steg: 'RANK', status: 'FEILET', melding: (err as Error).message });
  }

  // COPYWRITE
  let copy: any[] = [];
  try {
    const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
    const { genererCopyForAlle } = await import('@/lib/content-factory/copywriter/copywriterService');
    const topp = await hentToppHighlights(vodId, 10);
    copy = await genererCopyForAlle(vodId, topp, vod.title ?? '', vod.category ?? '');
    steg.push({ steg: 'COPYWRITE', status: 'OK', melding: `${copy.length} tekster` });
  } catch (err) {
    steg.push({ steg: 'COPYWRITE', status: 'FEILET', melding: (err as Error).message });
  }

  // QUEUE
  try {
    const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
    const { leggIReviewKø } = await import('@/lib/content-factory/review/reviewQueue');
    const topp = await hentToppHighlights(vodId, 10);
    await leggIReviewKø(vodId, topp.map(h => ({ highlightId: h.id, type: `highlight_${h.category}` })));
    steg.push({ steg: 'QUEUE', status: 'OK' });
  } catch (err) {
    steg.push({ steg: 'QUEUE', status: 'FEILET', melding: (err as Error).message });
  }

  await oppdaterVodStatus(vodId, 'COMPLETE');

  return NextResponse.json({
    ok: true,
    steg,
    antallHighlights: highlights.length,
    antallCopy: copy.length,
  });
}
