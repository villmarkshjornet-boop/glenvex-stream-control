/**
 * POST /api/polls/start
 *
 * Dashboard one-click poll start. Inserts a 'requested' row into poll_events
 * which the bot's PollManager picks up on its next 5-minute tick and runs as
 * a Twitch chat + Discord poll. Also logs the decision to ai_agent_decisions
 * so Creator Brain V2 has a record of user-initiated polls.
 */

import { NextResponse }        from 'next/server';
import { getDb }               from '@/lib/db';
import { getWorkspaceId }      from '@/lib/workspace';
import { logAgentDecision }    from '@/lib/ai/eventLogger';

export const dynamic = 'force-dynamic';

interface PollStartBody {
  question: string;
  options:  string[];
}

export async function POST(req: Request) {
  const db = getDb();
  const ws = getWorkspaceId();

  let body: PollStartBody;
  try {
    body = await req.json() as PollStartBody;
  } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 });
  }

  const { question, options } = body;

  if (!question?.trim() || !Array.isArray(options) || options.length < 2) {
    return NextResponse.json(
      { error: 'question og minst 2 options er påkrevd' },
      { status: 400 },
    );
  }

  if (!db) {
    return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 503 });
  }

  // Insert poll request — bot picks this up on next evaluate() tick (max 5 min)
  const { data: pollRow, error } = await db.from('poll_events').insert({
    workspace_id: ws,
    stream_id:    'pending',          // bot fills in real stream_id when it picks up the row
    poll_type:    'STREAM_DIRECTION',
    platform:     'both',
    question:     question.trim(),
    options:      options.map(label => ({ label, twitchVotes: 0, discordVotes: 0 })),
    reason:       'Dashboard-anmodet poll (ett-klikk fra Mission Queue)',
    context:      { source: 'dashboard', requestedAt: new Date().toISOString() },
    status:       'requested',
  }).select('id').single();

  if (error) {
    console.error('[polls/start] insert feilet:', error.message);
    return NextResponse.json({ error: 'Kunne ikke opprette poll' }, { status: 500 });
  }

  // Log to ai_agent_decisions so Creator Brain V2 can learn from user-initiated polls
  await logAgentDecision({
    agent_type:       'mission_queue',
    decision_type:    'poll_start_requested',
    input_context:    { question, options, source: 'dashboard' },
    decision_summary: `Bruker startet poll fra dashboard: "${question}"`,
    outcome:          'requested',
  });

  return NextResponse.json({
    ok:      true,
    pollId:  pollRow?.id ?? null,
    message: 'Poll er satt i kø — boten kjører den innen 5 minutter',
  });
}
