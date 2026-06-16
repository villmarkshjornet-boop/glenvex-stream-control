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

async function buildFallbackFromEvents(db: NonNullable<ReturnType<typeof getDb>>, workspaceId: string) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: events } = await db
    .from('ai_agent_events')
    .select('event_type, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .in('event_type', ['AUDIENCE_SESSION_COMPLETE', 'RETENTION_CURVE', 'AUDIENCE_SNAPSHOT', 'active_chatter', 'stream_offline'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  if (!events || events.length === 0) return null;

  const withStreamId = events.find(e => (e.metadata as any)?.stream_id);
  const targetStreamId: string | null = withStreamId ? (withStreamId.metadata as any).stream_id : null;

  // Grupper events som hører til samme stream: match på stream_id hvis tilgjengelig,
  // ellers fall tilbake til et 6-timers tidsvindu fra siste event som proxy for "samme stream".
  const grouped = targetStreamId
    ? events.filter(e => (e.metadata as any)?.stream_id === targetStreamId)
    : events.filter(e => new Date(events[0].created_at).getTime() - new Date(e.created_at).getTime() <= 6 * 3600_000);

  if (grouped.length === 0) return null;

  const sessionComplete = grouped.find(e => e.event_type === 'AUDIENCE_SESSION_COMPLETE');
  const retention = grouped.find(e => e.event_type === 'RETENTION_CURVE');
  const snapshot = grouped.find(e => e.event_type === 'AUDIENCE_SNAPSHOT');
  const offline = grouped.find(e => e.event_type === 'stream_offline');

  const meta = ((sessionComplete ?? snapshot)?.metadata ?? {}) as any;
  const retentionMeta = (retention?.metadata ?? {}) as any;
  const snapshots: Array<{ ts: string; count: number }> = retentionMeta.snapshots ?? [];

  const oldestEvent = grouped[grouped.length - 1];
  const startedAt = snapshots[0]?.ts ?? oldestEvent.created_at;
  const endedAt = offline?.created_at ?? sessionComplete?.created_at ?? grouped[0].created_at;

  const durationMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));
  const peak = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.count)) : (meta.total ?? 0);
  const avg = snapshots.length > 0 ? Math.round(snapshots.reduce((sum, s) => sum + s.count, 0) / snapshots.length) : (meta.total ?? 0);
  const chatMessages = Array.isArray(meta.viewers)
    ? meta.viewers.reduce((sum: number, v: any) => sum + (v.messagesSent ?? v.messages_sent ?? 0), 0)
    : (meta.active_chatters ?? 0);

  const syntheticStream = {
    id: targetStreamId ?? `fallback-${oldestEvent.created_at}`,
    stream_id: targetStreamId,
    title: meta.title ?? '',
    game: meta.game ?? '',
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: durationMinutes,
    peak_viewers: peak,
    avg_viewers: avg,
    chat_messages: chatMessages,
    followers_gained: 0,
    subs_gained: meta.subscribers ?? 0,
    raids_during: 0,
  };

  const audienceData = (sessionComplete || snapshot) ? {
    viewers: meta.viewers ?? [],
    total: meta.total ?? 0,
    newViewers: meta.new_viewers ?? 0,
    returningViewers: meta.returning_viewers ?? 0,
    subscribers: meta.subscribers ?? 0,
    moderators: meta.moderators ?? 0,
    vips: meta.vips ?? 0,
    activeChattters: meta.active_chatters ?? 0,
    topChattters: meta.top_chatters ?? [],
    lurkers: (meta.total ?? 0) - (meta.active_chatters ?? 0),
  } : null;

  const retentionCurve = snapshots.length > 0
    ? snapshots.map(s => ({
        ts: s.ts,
        count: s.count,
        minuteFromStart: Math.round((new Date(s.ts).getTime() - new Date(startedAt).getTime()) / 60_000),
      })).filter(s => s.minuteFromStart >= 0)
    : null;

  return { syntheticStream, audienceData, retentionCurve };
}

export async function GET(req: NextRequest) {
  const workspaceId = getWorkspaceId();
  const db = getDb();
  let knownStreamId: string | null = null;

  try {
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

    const historyFoundInDb = history.length > 0;
    let fallbackUsed = false;
    let selectedStream: any = null;
    let audienceData: any = null;
    let retentionCurve: Array<{ ts: string; count: number; minuteFromStart: number }> | null = null;

    if (!historyFoundInDb) {
      const fallback = db ? await buildFallbackFromEvents(db, workspaceId) : null;

      if (!fallback) {
        void db?.from('system_events').insert({
          workspace_id: workspaceId, source: 'stream_coach', event_type: 'STREAM_COACH_NO_DATA_AVAILABLE',
          title: 'Stream Coach: ingen stream_history og ingen audience-events siste 7 dager', severity: 'warning',
          metadata: { workspaceId },
        });
        return NextResponse.json({
          history: [], selectedStream: null, audience: null, retentionCurve: null,
          streamScore: null, analyse: null, historiskAnalyse: null,
          diagnostics: {
            historyFound: false,
            audienceEventsFound: false,
            fallbackUsed: false,
            reason: 'Ingen stream-data funnet for workspace',
          },
        });
      }

      void db?.from('system_events').insert({
        workspace_id: workspaceId, source: 'stream_coach', event_type: 'STREAM_COACH_NO_HISTORY_BUT_EVENTS_FOUND',
        title: 'Stream Coach: ingen stream_history, men fant audience-events siste 7 dager', severity: 'info',
        metadata: { workspaceId, streamId: fallback.syntheticStream.stream_id },
      });

      selectedStream = fallback.syntheticStream;
      audienceData = fallback.audienceData;
      retentionCurve = fallback.retentionCurve;
      history = [selectedStream];
      fallbackUsed = true;
      knownStreamId = selectedStream.stream_id;

      void db?.from('system_events').insert({
        workspace_id: workspaceId, source: 'stream_coach', event_type: 'STREAM_COACH_FALLBACK_USED',
        title: 'Stream Coach: bruker fallback-rapport bygget fra ai_agent_events (stream_history mangler)', severity: 'info',
        metadata: { workspaceId, streamId: selectedStream.stream_id },
      });
    } else {
      // Velg stream å analysere
      selectedStream = requestedStreamId
        ? (history.find(s => s.id === requestedStreamId || s.stream_id === requestedStreamId) ?? history[0])
        : history[0];
      knownStreamId = selectedStream.stream_id || selectedStream.id;

      // ── Hent publikumsdata fra ai_agent_events ───────────────────────────────
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
    }

    // ── Stream score ─────────────────────────────────────────────────────────
    const streamScore = calcStreamScore(selectedStream, audienceData);

    // ── AI-analyse ───────────────────────────────────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    let analyse: any = null;

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const ctx = await getCreatorContext({ limit: 15 }).catch((err: any) => {
        console.error('[stream-coach] getCreatorContext failed:', err?.message);
        return null;
      });
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
      } catch (err: any) {
        console.error('[stream-coach] OpenAI stream-analyse failed:', err?.message);
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
      } catch (err: any) {
        console.error('[stream-coach] OpenAI historisk-analyse failed:', err?.message);
        historiskAnalyse = null;
      }
    }

    // ── Diagnostics: log when audience data is missing ───────────────────────
    if (!audienceData) {
      void db?.from('system_events').insert({
        workspace_id: workspaceId,
        source:       'stream_coach',
        event_type:   'STREAM_COACH_NO_AUDIENCE_DATA',
        title:        'Stream Coach: ingen audience-data – bot var sannsynligvis ikke aktiv under streamen',
        severity:     'warning',
        metadata:     { workspaceId, streamId: selectedStream.stream_id || selectedStream.id, streamTitle: selectedStream.title },
      });
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
        fallbackUsed,
      },
    }).catch((err: any) => console.error('[stream-coach] logSystemEvent COACH_REPORT_GENERATED failed:', err?.message));

    return NextResponse.json({
      history,
      selectedStream,
      audience: audienceData,
      retentionCurve,
      streamScore,
      analyse,
      historiskAnalyse,
      diagnostics: {
        historyFound:        historyFoundInDb,
        audienceEventsFound: !!audienceData,
        fallbackUsed,
        source:              fallbackUsed ? 'ai_agent_events_fallback' : 'stream_history',
        hasAudienceData:     !!audienceData,
        hasRetentionData:    !!retentionCurve,
        hasHistory:          history.length > 0,
        noAudienceDataReason: !audienceData
          ? 'Ingen audience-data funnet. Boten var sannsynligvis ikke aktiv under streamen – AUDIENCE_SESSION_COMPLETE event mangler.'
          : null,
      },
    });
  } catch (err: any) {
    console.error('[stream-coach] GET failed:', err);
    void db?.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'stream_coach',
      event_type: 'STREAM_COACH_FAILED',
      title: `Stream Coach feilet: ${err?.message?.slice(0, 150) ?? 'ukjent feil'}`,
      severity: 'error',
      metadata: { workspaceId, streamId: knownStreamId, error: err?.message, stack: err?.stack?.slice(0, 2000) },
    });
    return NextResponse.json({
      history: [], selectedStream: null, audience: null, retentionCurve: null,
      streamScore: null, analyse: null, historiskAnalyse: null,
      diagnostics: {
        historyFound: false,
        audienceEventsFound: false,
        fallbackUsed: false,
        error: err?.message ?? 'Ukjent feil i Stream Coach',
      },
    }, { status: 500 });
  }
}

