import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

// ── GET — list tips for a stream ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isDbAvailable()) return NextResponse.json({ tips: [] }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ tips: [] }, { status: 503 });

  const wsId     = getWorkspaceId();
  const streamId = req.nextUrl.searchParams.get('streamId') ?? '';
  if (!streamId) return NextResponse.json({ tips: [] });

  const { data, error } = await db
    .from('stream_coach_tips')
    .select('*')
    .eq('workspace_id', wsId)
    .eq('stream_id', streamId)
    .order('sort_order');

  if (error) return NextResponse.json({ tips: [], error: error.message }, { status: 500 });
  return NextResponse.json({ tips: data ?? [] });
}

// ── POST — generate 3 tips for a stream (idempotent) ─────────────────────────

interface GenerateBody {
  streamId:   string;
  game?:      string;
  score?:     { total: number; breakdown: Record<string, number> };
  toppInsikt?: string;
  avgViewers?: number;
  chatMessages?: number;
}

export async function POST(req: NextRequest) {
  if (!isDbAvailable()) return NextResponse.json({ ok: false, error: 'DB not available' }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB not initialized' }, { status: 503 });

  const wsId = getWorkspaceId();
  const body: GenerateBody = await req.json();
  const { streamId, game, score, toppInsikt, avgViewers, chatMessages } = body;

  if (!streamId) return NextResponse.json({ ok: false, error: 'streamId required' }, { status: 400 });

  // Idempotency: return existing tips if already generated
  const { data: existing } = await db
    .from('stream_coach_tips')
    .select('id')
    .eq('workspace_id', wsId)
    .eq('stream_id', streamId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { data: tips } = await db
      .from('stream_coach_tips')
      .select('*')
      .eq('workspace_id', wsId)
      .eq('stream_id', streamId)
      .order('sort_order');
    return NextResponse.json({ ok: true, tips: tips ?? [], source: 'cached' });
  }

  // Determine which dimensions are weakest
  const breakdown = score?.breakdown ?? {};
  const weakest = Object.entries(breakdown)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([k]) => k);

  const apiKey = process.env.OPENAI_API_KEY;
  let rawTips: Array<{ tip: string; category: string }> = [];

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const prompt =
        `Du er en erfaren Twitch-coach. Basert på følgende stream-data, lag NØYAKTIG 3 konkrete, handlingsorienterte tips for å forbedre neste stream.\n\n` +
        `Spill: ${game ?? 'ukjent'}\n` +
        `Stream Score: ${score?.total ?? '?'}/100\n` +
        `Score-fordeling:\n` +
        Object.entries(breakdown).map(([k, v]) => `  ${k}: ${v}/20`).join('\n') + '\n' +
        `Svakeste dimensjoner: ${weakest.join(', ')}\n` +
        (toppInsikt ? `AI-innsikt: ${toppInsikt}\n` : '') +
        `Snitt-seere: ${avgViewers ?? 0}, Chat-meldinger: ${chatMessages ?? 0}\n\n` +
        `Svar med JSON-array med NØYAKTIG 3 objekter:\n` +
        `[{"tip": "konkret handlingsbeskrivelse (maks 120 tegn)", "category": "viewers|chat|retention|growth|community"}]\n` +
        `Tipsene skal være spesifikke og målbare, IKKE generelle råd. Én konkret handling per tips.`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `${prompt}\nSvar med JSON: { "tips": [...] }` }],
        max_tokens: 400,
        temperature: 0.7,
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      if (Array.isArray(parsed.tips)) {
        rawTips = parsed.tips.slice(0, 3);
      }
    } catch {}
  }

  // Fallback tips based on weakest dimensions
  if (rawTips.length < 3) {
    const fallbackByDim: Record<string, { tip: string; category: string }> = {
      viewers:   { tip: 'Promoter neste stream på Discord med @here minst 30 min før du går live', category: 'viewers' },
      chat:      { tip: 'Sett opp en Twitch-belønning (kanalpoeng) som trigger en morsom chat-reaksjon', category: 'chat' },
      retention: { tip: 'Planlegg et engasjerende høydepunkt midt i streamen (giveaway, utfordring, Q&A)', category: 'retention' },
      growth:    { tip: 'Raid en annen kanal etter streamen og be dem raider tilbake neste gang', category: 'growth' },
      community: { tip: 'Start neste stream med å nevne Discord-communityet og be om tilbakemelding', category: 'community' },
    };
    const defaults = [
      { tip: 'Promoter neste stream på Discord med @here minst 30 min før du går live', category: 'viewers' },
      { tip: 'Sett et klart mål for streamen og del det med chatten i starten', category: 'retention' },
      { tip: 'Spør chatten om tilbakemelding på slutten av streamen via en rask poll', category: 'community' },
    ];

    while (rawTips.length < 3) {
      const dim = weakest[rawTips.length] ?? '';
      rawTips.push(fallbackByDim[dim] ?? defaults[rawTips.length] ?? defaults[0]);
    }
  }

  const metrics = { avgViewers, chatMessages, score: score?.total, breakdown };

  const rows = rawTips.slice(0, 3).map((t, i) => ({
    workspace_id:   wsId,
    stream_id:      streamId,
    tip_text:       t.tip,
    tip_category:   t.category,
    sort_order:     i,
    metrics_before: metrics,
  }));

  const { data: inserted, error } = await db
    .from('stream_coach_tips')
    .insert(rows)
    .select('*');

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tips: inserted ?? [], source: 'generated' });
}
