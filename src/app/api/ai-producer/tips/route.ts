import { NextRequest, NextResponse } from 'next/server';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { tipTekst, status, streamGame, streamViewers } = await req.json() as {
      tipTekst: string;
      status: 'done' | 'dismissed';
      streamGame?: string;
      streamViewers?: number;
    };

    if (!tipTekst || !status) {
      return NextResponse.json({ error: 'tipTekst og status er påkrevd' }, { status: 400 });
    }

    const eventType = status === 'done' ? 'AI_PRODUCER_RECOMMENDATION_COMPLETED' : 'AI_PRODUCER_RECOMMENDATION_DISMISSED';
    const title = status === 'done'
      ? `AI-anbefaling utført: "${tipTekst.slice(0, 60)}"`
      : `AI-anbefaling avvist: "${tipTekst.slice(0, 60)}"`;

    await logSystemEvent({
      source: 'ai_producer',
      event_type: eventType,
      title,
      severity: 'info',
      metadata: { tipTekst, status, streamGame, streamViewers },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
