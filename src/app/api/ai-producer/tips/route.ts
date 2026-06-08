import { NextRequest, NextResponse } from 'next/server';
import { logSystemEvent } from '@/lib/systemEvents';
import { logAgentEvent, logAgentDecision } from '@/lib/ai/eventLogger';

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

    // Feed executed tips back into ai_agent_events so LearningAggregator can learn from them
    if (status === 'done') {
      await logAgentEvent({
        source: 'ai_producer',
        event_type: 'RECOMMENDATION_EXECUTED',
        message_text: tipTekst.slice(0, 200),
        importance_score: 8,
        metadata: { streamGame, streamViewers },
      });
    }

    // Log to ai_agent_decisions for effect tracking — feedback_score closes the loop
    await logAgentDecision({
      agent_type: 'ai_producer',
      decision_type: 'recommendation_outcome',
      input_context: { tipTekst: tipTekst.slice(0, 200), streamGame: streamGame ?? null, streamViewers: streamViewers ?? null },
      decision_summary: title,
      outcome: status === 'done' ? 'executed' : 'dismissed',
      feedback_score: status === 'done' ? 1 : 0,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
