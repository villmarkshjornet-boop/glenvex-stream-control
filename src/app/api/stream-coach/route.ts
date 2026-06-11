import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';
import { getCreatorContext, buildContextPrompt } from '@/lib/ai/creatorContext';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function calcStreamScore(stream: any, audience: any) {
  const peak = stream.peak_viewers ?? 0;
  const avg = stream.avg_viewers ?? 0;
  const chat = stream.chat_messages ?? 0;
  const duration = stream.duration_minutes ?? 0;
  const followers = stream.followers_gained ?? 0;
  const subs = stream.subs_gained ?? 0;
  const raids = stream.raids_during ?? 0;

  const viewers = Math.min(20, (peak / 30) * 20);
  const retention = peak > 0 ? Math.min(20, (avg / peak) * 20) : 0;
  const chatPerHour = duration > 0 ? chat / (duration / 60) : 0;
  const chatScore = Math.min(20, (chatPerHour / 80) * 20);
  const growthScore = Math.min(20, (followers / 4) * 15 + (subs / 3) * 5);
  const communityScore = Math.min(20, (raids / 2) * 10 + (audience?.subscribers ?? 0) * 0.5);

  const total = Math.round(viewers + retention + chatScore + growthScore + communityScore);
  const grade = total >= 80 ? 'S' : total >= 65 ? 'A' : total >= 50 ? 'B' : total >= 35 ? 'C' : 'D';

  return {
    total: Math.min(100, total),
    grade,
    breakdown: {
      viewers: Math.round(viewers),
      retention: Math.round(retention),
      chat: Math.round(chatScore),
      growth: Math.round(growthScore),
      community: Math.round(communityScore),
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const workspaceId = getWorkspaceId();
    const url = new URL(req.url);
    const requestedStreamId = url.searchParams.get('streamId');

    // ── Last workspace brand ─────────────────────────────────────────────────
    let brandName = 'streameren';
    if (db) {
      const { data: wsRow } = await db.from('workspaces').select('brand_name').eq('id', workspaceId).single();
      if (wsRow?.brand_name) {
        brandName = wsRow.brand_name;
      } else {
        void db.from('system_events').insert({ workspace_id: workspaceId, source: 'stream_coach', event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT', title: 'Stream Coach: workspace mangler brand_name', severity: 'warning', metadata: { workspaceId } });
      }
    }

    // ── Hent stream-historikk ────────────────────────────────────────────────
    let history: any[] = [];
    if (db) {
      const cutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
      const { data } = await db
        .from('stream_history')
        .select('*')
        .eq('workspace_id', workspaceId)
        .gte('started_at', cutoff)
        .order('started_at', { ascending: false })
        .limit(20);
      history = data ?? [];
    }

    if (history.length === 0) return NextResponse.json({ history: [], analyse: null, audience: null, streamScore: null });

    // Velg stream å analysere
    const selectedStream = requestedStreamId
      ? (history.find(s => s.id === requestedStreamId || s.stream_id === requestedStreamId) ?? history[0])
      : history[0];

    // ── Hent publikumsdata fra ai_agent_events ───────────────────────────────
    let audienceData: any = null;
    let retentionCurve: Array<{ ts: string; count: number; minuteFromStart: number }> | null = null;

    if (db && selectedStream) {
      const streamTwitchId = selectedStream.stream_id || selectedStream.id;

      const [audienceRes, retentionRes] = await Promise.all([
        db.from('ai_agent_events')
          .select('metadata, created_at')
          .eq('workspace_id', workspaceId)
          .eq('event_type', 'AUDIENCE_SESSION_COMPLETE')
          .filter('metadata->>stream_id', 'eq', streamTwitchId)
          .order('created_at', { ascending: false })
          .limit(1),

        db.from('ai_agent_events')
          .select('metadata, created_at')
          .eq('workspace_id', workspaceId)
          .eq('event_type', 'RETENTION_CURVE')
          .filter('metadata->>stream_id', 'eq', streamTwitchId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      if (audienceRes.data && audienceRes.data.length > 0) {
        const meta = audienceRes.data[0].metadata as any;
        audienceData = {
          viewers: (meta.viewers ?? []) as any[],
          total: meta.total ?? 0,
          newViewers: meta.new_viewers ?? 0,
          returningViewers: meta.returning_viewers ?? 0,
          subscribers: meta.subscribers ?? 0,
          moderators: meta.moderators ?? 0,
          vips: meta.vips ?? 0,
          activeChattters: meta.active_chatters ?? 0,
          topChattters: meta.top_chatters ?? [],
        };
        audienceData.lurkers = audienceData.total - audienceData.activeChattters;
      }

      if (retentionRes.data && retentionRes.data.length > 0) {
        const meta = retentionRes.data[0].metadata as any;
        const snapshots: Array<{ ts: string; count: number }> = meta.snapshots ?? [];
        const streamStart = selectedStream.started_at ? new Date(selectedStream.started_at).getTime() : 0;

        retentionCurve = snapshots.map(s => ({
          ts: s.ts,
          count: s.count,
          minuteFromStart: streamStart > 0 ? Math.round((new Date(s.ts).getTime() - streamStart) / 60_000) : 0,
        })).filter(s => s.minuteFromStart >= 0);
      }
    }

    // ── Stream score ─────────────────────────────────────────────────────────
    const streamScore = calcStreamScore(selectedStream, audienceData);

    // ── AI-analyse ───────────────────────────────────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    let analyse: any = null;

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const ctx = await getCreatorContext({ limit: 15 }).catch(() => null);
      const contextPrompt = ctx ? buildContextPrompt(ctx) : '';

      const audiencePart = audienceData
        ? `
Publikumsdata:
- Totalt observert: ${audienceData.total} chattere
- Nye brukere: ${audienceData.newViewers} (${audienceData.total > 0 ? Math.round(audienceData.newViewers / audienceData.total * 100) : 0}%)
- Returnerende: ${audienceData.returningViewers}
- Subscribers: ${audienceData.subscribers}
- Topp chattere: ${audienceData.topChattters.slice(0, 5).map((t: any) => `${t.username} (${t.messages} mld)`).join(', ') || 'ingen data'}`
        : '';

      const retentionPart = retentionCurve && retentionCurve.length > 1
        ? `
Retention-kurve (${retentionCurve.length} snapshots):
- Start: ${retentionCurve[0]?.count ?? 0} seere
- Slutt: ${retentionCurve[retentionCurve.length - 1]?.count ?? 0} seere
- Peak: ${Math.max(...retentionCurve.map(r => r.count))} seere`
        : '';

      const streamData = `Stream: ${selectedStream.game ?? 'Ukjent'} – "${selectedStream.title ?? ''}"
Dato: ${selectedStream.started_at ? new Date(selectedStream.started_at).toLocaleDateString('no-NO') : 'ukjent'}
Peak: ${selectedStream.peak_viewers ?? 0} | Snitt: ${selectedStream.avg_viewers ?? 0} | Varighet: ${selectedStream.duration_minutes ?? 0} min
Chat: ${selectedStream.chat_messages ?? 0} | Followers +${selectedStream.followers_gained ?? 0} | Subs +${selectedStream.subs_gained ?? 0} | Raids: ${selectedStream.raids_during ?? 0}
Score: ${streamScore.total}/100 (${streamScore.grade})${audiencePart}${retentionPart}`;

      const historiskDel = history.slice(0, 5).map((s: any) =>
        `- ${s.game ?? 'Ukjent'}: peak ${s.peak_viewers ?? 0}, snitt ${s.avg_viewers ?? 0}, ${s.chat_messages ?? 0} mld, ${s.duration_minutes ?? 0} min`
      ).join('\n');

      try {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Du er ${brandName} sin personlige stream-coach. Analyser denne streamen og gi konkrete, norske tilbakemeldinger.

${contextPrompt ? `${contextPrompt}\n\n` : ''}${streamData}

Siste ${Math.min(5, history.length)} streams for kontekst:
${historiskDel}

Returner KUN gyldig JSON:
{
  "fungerteBra": ["observasjon 1", "observasjon 2", "observasjon 3"],
  "fungerteIkke": ["observasjon 1", "observasjon 2"],
  "anbefalinger": ["konkret anbefaling 1", "konkret anbefaling 2", "konkret anbefaling 3"],
  "toppInsikt": "Én setning om det viktigste funnet fra denne streamen",
  "audienceObservasjon": "Én setning om publikumsbildet (kun hvis du har data, ellers tom streng)",
  "retentionObservasjon": "Én setning om publikums-retention (kun hvis du har data, ellers tom streng)"
}

Krav: Bruk KUN data fra denne streamen. Ingen generiske råd. Vær spesifikk.`,
          }],
          max_tokens: 500,
          temperature: 0.6,
          response_format: { type: 'json_object' },
        });

        analyse = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      } catch {
        analyse = null;
      }
    }

    // ── Historisk analyse (siste 5 streams) ──────────────────────────────────
    let historiskAnalyse: any = null;
    if (apiKey && history.length >= 3) {
      const openai = new OpenAI({ apiKey });
      try {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Analyser disse ${Math.min(10, history.length)} streamene for ${brandName} og finn mønstre:
${history.slice(0, 10).map((s: any) => `- ${s.game ?? '?'} (${new Date(s.started_at).toLocaleDateString('no-NO')}): peak ${s.peak_viewers ?? 0}, snitt ${s.avg_viewers ?? 0}, ${s.chat_messages ?? 0} mld, +${s.followers_gained ?? 0} flw`).join('\n')}

Returner KUN gyldig JSON:
{
  "fungerteBra": ["mønster 1", "mønster 2"],
  "fungerteIkke": ["mønster 1", "mønster 2"],
  "børGjentas": ["konkret anbefaling 1", "konkret anbefaling 2"],
  "børUnngås": ["konkret advarsel 1"],
  "toppInsikt": "Én setning om det viktigste historiske mønsteret"
}`,
          }],
          max_tokens: 400,
          temperature: 0.5,
          response_format: { type: 'json_object' },
        });
        historiskAnalyse = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      } catch {
        historiskAnalyse = null;
      }
    }

    // ── Log til system_events ─────────────────────────────────────────────────
    logSystemEvent({
      source: 'stream_coach',
      event_type: 'COACH_REPORT_GENERATED',
      title: `Stream Coach rapport: ${selectedStream.game ?? 'ukjent'} — Score ${streamScore.total}/100 (${streamScore.grade})`,
      severity: 'info',
      metadata: {
        workspaceId,
        streamId: selectedStream.stream_id || selectedStream.id,
        score: streamScore.total,
        grade: streamScore.grade,
        hasAudienceData: !!audienceData,
        hasRetentionData: !!retentionCurve,
        viewersObserved: audienceData?.total ?? 0,
      },
    }).catch(() => {});

    return NextResponse.json({
      history,
      selectedStream,
      audience: audienceData,
      retentionCurve,
      streamScore,
      analyse,
      historiskAnalyse,
    });
  } catch {
    return NextResponse.json({ history: [], analyse: null, audience: null, streamScore: null });
  }
}

