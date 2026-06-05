import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { hentVod, oppdaterVodStatus } from '@/lib/content-factory/vod/vodService';
import { getDb } from '@/lib/db';
import { medRetry, sikreJsonParse } from '@/lib/content-factory/utils/retry';
import { logPipeline } from '@/lib/content-factory/jobs/pipelineLogger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function kjørMedRetry<T>(
  stegNavn: string,
  vodId: string,
  fn: () => Promise<T>,
  steg: any[]
): Promise<T | null> {
  const start = Date.now();
  try {
    const res = await medRetry(fn, { maxForsøk: 3, venteMs: 3000 });
    steg.push({ steg: stegNavn, status: 'OK' });
    return res;
  } catch (err) {
    const melding = (err as Error).message?.slice(0, 300) ?? 'Ukjent feil';
    steg.push({ steg: stegNavn, status: 'FEILET', melding });
    await logPipeline({ vodId, step: stegNavn as any, status: 'FAILED', message: melding, durationMs: Date.now() - start });
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  let vodId: string;
  try {
    const body = await req.json();
    vodId = body.vodId;
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  if (!vodId) return NextResponse.json({ error: 'vodId kreves' }, { status: 400 });

  const vod = await hentVod(vodId);
  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  const steg: any[] = [];
  const db = getDb();

  // Sjekk transkripsjon
  const antall = db ? await db.from('content_transcripts')
    .select('id', { count: 'exact', head: true })
    .eq('vod_id', vodId)
    .then(r => r.count ?? 0) : 0;

  if ((antall as number) === 0) {
    return NextResponse.json({
      ok: false,
      error: 'Ingen transkripsjon funnet – Railway Phase 1 må fullføres først',
      steg: [{ steg: 'TRANSCRIBE', status: 'FEILET', melding: `0 segmenter i Supabase for VOD ${vodId}` }],
    });
  }

  steg.push({ steg: 'TRANSCRIBE', status: 'OK', melding: `${antall} segmenter` });

  // DISCOVER med retry
  const highlights = await kjørMedRetry('DISCOVER', vodId, async () => {
    const { oppdagHighlights } = await import('@/lib/content-factory/analysis/highlightDiscovery');
    return oppdagHighlights(vodId);
  }, steg);

  // RANK med retry
  if (highlights && highlights.length > 0) {
    await kjørMedRetry('RANK', vodId, async () => {
      const { rangerHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
      return rangerHighlights(vodId);
    }, steg);
  } else if (!steg.find(s => s.steg === 'RANK')) {
    steg.push({ steg: 'RANK', status: 'HOPPET OVER', melding: 'Ingen highlights å rangere' });
  }

  // COPYWRITE – maks 5 highlights for å unngå timeout
  let antallCopy = 0;
  await kjørMedRetry('COPYWRITE', vodId, async () => {
    const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
    const { genererCopyForAlle } = await import('@/lib/content-factory/copywriter/copywriterService');
    const topp = await hentToppHighlights(vodId, 5);
    const copy = await genererCopyForAlle(vodId, topp, vod.title ?? '', vod.category ?? '');
    antallCopy = copy.length;
    return copy;
  }, steg);

  // QUEUE med retry
  await kjørMedRetry('QUEUE', vodId, async () => {
    const { hentToppHighlights } = await import('@/lib/content-factory/ranking/highlightRanker');
    const { leggIReviewKø } = await import('@/lib/content-factory/review/reviewQueue');
    const topp = await hentToppHighlights(vodId, 5);
    return leggIReviewKø(vodId, topp.map(h => ({
      highlightId: h.id,
      type: `highlight_${h.category ?? 'GENERAL'}`,
    })));
  }, steg);

  await oppdaterVodStatus(vodId, 'COMPLETE');

  const antallHighlights = db
    ? await db.from('content_highlights').select('id', { count: 'exact', head: true }).eq('vod_id', vodId).then(r => r.count ?? 0)
    : 0;

  return NextResponse.json({
    ok: true,
    steg,
    antallHighlights,
    antallCopy,
  });
}
