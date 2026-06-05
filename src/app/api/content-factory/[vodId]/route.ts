import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

function sjekkFlag() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }
  return null;
}

// GET /api/content-factory/[vodId] – Full status for én VOD
export async function GET(
  _req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  const feil = sjekkFlag();
  if (feil) return feil;

  const { vodId } = params;

  const [
    { hentVod },
    { hentHighlights },
    { hentCopyForVod },
    { hentReviewKø },
    { hentPipelineLogs },
  ] = await Promise.all([
    import('@/lib/content-factory/vod/vodService'),
    import('@/lib/content-factory/analysis/highlightDiscovery'),
    import('@/lib/content-factory/copywriter/copywriterService'),
    import('@/lib/content-factory/review/reviewQueue'),
    import('@/lib/content-factory/jobs/pipelineLogger'),
  ]);

  const [vod, highlights, copy, kø, logs] = await Promise.all([
    hentVod(vodId),
    hentHighlights(vodId),
    hentCopyForVod(vodId),
    hentReviewKø({ vodId }),
    hentPipelineLogs(vodId),
  ]);

  if (!vod) return NextResponse.json({ error: 'VOD ikke funnet' }, { status: 404 });

  return NextResponse.json({ vod, highlights, copy, kø, logs });
}

// PATCH /api/content-factory/[vodId] – Restart et steg
export async function PATCH(
  req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  const feil = sjekkFlag();
  if (feil) return feil;

  const { steg, audioUrl } = await req.json() as { steg: string; audioUrl?: string };
  const { restartSteg } = await import('@/lib/content-factory/jobs/orchestrator');

  try {
    await restartSteg(params.vodId, steg as any, { audioUrl });
    return NextResponse.json({ ok: true, steg });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
