/**
 * Content Factory API – IKKE offentlig
 * Kun tilgjengelig når CONTENT_FACTORY_ENABLED=true
 * Ingen UI-entrypoints. Ingen navigasjon.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';

function sjekkFlag() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json(
      { error: 'Content Factory er ikke aktivert', kode: 'FEATURE_DISABLED' },
      { status: 403 }
    );
  }
  return null;
}

// GET /api/content-factory – Status og VOD-liste
export async function GET() {
  const feil = sjekkFlag();
  if (feil) return feil;

  const { hentAlleVods } = await import('@/lib/content-factory/vod/vodService');
  const vods = await hentAlleVods();

  return NextResponse.json({
    status: 'active',
    feature: 'content-factory',
    versjon: '1.0.0-alpha',
    vods,
  });
}

// POST /api/content-factory – Start pipeline for en VOD
export async function POST(req: NextRequest) {
  const feil = sjekkFlag();
  if (feil) return feil;

  const body = await req.json() as {
    streamId: string;
    audioUrl?: string;
    antallHighlights?: number;
    streamData?: any;
  };

  if (!body.streamId) {
    return NextResponse.json({ error: 'streamId kreves' }, { status: 400 });
  }

  try {
    const { kjørFullPipeline } = await import('@/lib/content-factory/jobs/orchestrator');
    const resultat = await kjørFullPipeline({
      streamId: body.streamId,
      audioUrl: body.audioUrl,
      antallHighlights: body.antallHighlights ?? 10,
      streamData: body.streamData,
    });

    return NextResponse.json(resultat);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
