import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';
import { getCreatorContext, buildContextPrompt } from '@/lib/ai/creatorContext';
import { calcStreamScore, buildFallbackFromEvents } from '@/lib/streamScore';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

    // ── Metrikk-berikelse: fyll 0-felt fra råeventer når stream_history mangler data ─────
    // Bakgrunn:
    //   chat_messages i stream_history teller Discord-meldinger (incrementChatMessages() kalles
    //   fra Discord-handler, ikke Twitch-handler). Twitch-chat telles i audienceTracker og
    //   ligger i AUDIENCE_SESSION_COMPLETE.metadata.viewers[].messagesSent.
    //
    //   followers_gained er alltid 0 fordi endSession(0) kalles med hardkodet 0.
    //   Ekte follower-data er bare i system_events (FOLLOW_RECEIVED, metadata.antallNye).
    const metrics: Record<string, { value: number; source: string; confidence: 'high' | 'medium' | 'low' }> = {
      peakViewers:    { value: selectedStream?.peak_viewers    ?? 0, source: 'stream_history', confidence: 'high' },
      avgViewers:     { value: selectedStream?.avg_viewers     ?? 0, source: 'stream_history', confidence: 'high' },
      durationMinutes:{ value: selectedStream?.duration_minutes ?? 0, source: 'stream_history', confidence: 'high' },
      subsGained:     { value: selectedStream?.subs_gained     ?? 0, source: 'stream_history', confidence: 'high' },
      chatMessages:   { value: selectedStream?.chat_messages   ?? 0, source: 'stream_history', confidence: selectedStream?.chat_messages > 0 ? 'high' : 'low' },
      followersGained:{ value: selectedStream?.followers_gained ?? 0, source: 'stream_history', confidence: selectedStream?.followers_gained > 0 ? 'high' : 'low' },
    };

    if (selectedStream && db) {
      // ── Chat: bruk AUDIENCE_SESSION_COMPLETE som primærkilde (Twitch chat telles her) ──
      if (metrics.chatMessages.value === 0 && audienceData) {
        const chatFromAudience = (audienceData.viewers as any[]).reduce(
          (sum: number, v: any) => sum + (v.messagesSent ?? v.messages_sent ?? 0), 0
        );
        if (chatFromAudience > 0) {
          void db.from('system_events').insert({
            workspace_id: workspaceId, source: 'stream_coach',
            event_type: 'STREAM_COACH_METRIC_MISMATCH',
            title: `Stream Coach: chat_messages=0 i stream_history, men ${chatFromAudience} Twitch-meldinger i audience-data`,
            severity: 'warning',
            metadata: {
              workspaceId, streamId: knownStreamId, metric: 'chatMessages',
              displayedValue: 0, rawEventCount: chatFromAudience,
              sourceUsed: 'audience_session_complete',
              streamWindowStart: selectedStream.started_at, streamWindowEnd: selectedStream.ended_at,
            },
          });
          metrics.chatMessages = { value: chatFromAudience, source: 'audience_session_complete', confidence: 'high' };
        }
      }

      // ── Følgere: tell FOLLOW_RECEIVED-events innen streamens tidsvindu ───────────────
      if (metrics.followersGained.value === 0 && selectedStream.started_at) {
        const streamWindowEnd = selectedStream.ended_at
          ? new Date(new Date(selectedStream.ended_at).getTime() + 60 * 60_000).toISOString()
          : new Date(new Date(selectedStream.started_at).getTime() + 12 * 3600_000).toISOString();

        const { data: followEvents } = await db
          .from('system_events')
          .select('metadata, created_at')
          .eq('workspace_id', workspaceId)
          .eq('event_type', 'FOLLOW_RECEIVED')
          .gte('created_at', selectedStream.started_at)
          .lte('created_at', streamWindowEnd)
          .limit(500);

        const rawFollowCount = (followEvents ?? []).reduce(
          (sum: number, e: any) => sum + ((e.metadata?.antallNye as number) ?? 1), 0
        );

        if (rawFollowCount > 0) {
          void db.from('system_events').insert({
            workspace_id: workspaceId, source: 'stream_coach',
            event_type: 'STREAM_COACH_METRIC_MISMATCH',
            title: `Stream Coach: followers_gained=0 i stream_history, men ${rawFollowCount} følger-events i system_events`,
            severity: 'warning',
            metadata: {
              workspaceId, streamId: knownStreamId, metric: 'followersGained',
              displayedValue: 0, rawEventCount: rawFollowCount,
              sourceUsed: 'system_events_FOLLOW_RECEIVED',
              streamWindowStart: selectedStream.started_at, streamWindowEnd,
            },
          });
          metrics.followersGained = { value: rawFollowCount, source: 'system_events', confidence: 'medium' };
        }
      }

      // ── Oppdater selectedStream med berikede verdier (påvirker både KPI-display og AI-tekst) ─
      if (metrics.chatMessages.source !== 'stream_history' || metrics.followersGained.source !== 'stream_history') {
        selectedStream = {
          ...selectedStream,
          chat_messages: metrics.chatMessages.value,
          followers_gained: metrics.followersGained.value,
        };
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

    // ── Write Stream Coach learning to ai_agent_memory ──────────────────────
    if (db && analyse && knownStreamId) {
      const learningPoints: Array<{ key: string; summary: string; type: string; positive: boolean }> = [];

      if (Array.isArray(analyse.fungerteBra) && analyse.fungerteBra.length > 0) {
        learningPoints.push({
          key:      `coach_positive_${knownStreamId}`,
          summary:  (analyse.fungerteBra as string[]).join(' | ').slice(0, 200),
          type:     'stream_positive',
          positive: true,
        });
      }
      if (Array.isArray(analyse.fungerteIkke) && analyse.fungerteIkke.length > 0) {
        learningPoints.push({
          key:      `coach_negative_${knownStreamId}`,
          summary:  (analyse.fungerteIkke as string[]).join(' | ').slice(0, 200),
          type:     'stream_negative',
          positive: false,
        });
      }
      if (typeof analyse.toppInsikt === 'string' && analyse.toppInsikt.length > 0) {
        learningPoints.push({
          key:      `coach_insight_${knownStreamId}`,
          summary:  analyse.toppInsikt.slice(0, 200),
          type:     'stream_insight',
          positive: true,
        });
      }

      for (const lp of learningPoints) {
        try {
          await db.from('ai_agent_memory').upsert({
            workspace_id:     workspaceId,
            agent_type:       'stream_coach',
            memory_type:      lp.type,
            key:              lp.key,
            summary:          lp.summary,
            confidence_score: 0.7,
            metadata:         { streamId: knownStreamId, positive: lp.positive, source: 'stream_coach' },
            updated_at:       new Date().toISOString(),
          }, { onConflict: 'workspace_id,agent_type,memory_type,key' });
        } catch {}
      }

      if (learningPoints.length > 0) {
        try {
          await db.from('system_events').insert({
            workspace_id: workspaceId,
            source:       'stream_coach',
            event_type:   'STREAM_COACH_LEARNING_SAVED',
            title:        `Stream Coach lagret ${learningPoints.length} læringspunkter fra stream`,
            severity:     'info',
            metadata:     { streamId: knownStreamId, learningPoints: learningPoints.map(l => l.key) },
          });
        } catch {}
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
      metrics,
      diagnostics: {
        historyFound:        historyFoundInDb,
        audienceEventsFound: !!audienceData,
        fallbackUsed,
        source:              fallbackUsed ? 'ai_agent_events_fallback' : 'stream_history',
        hasAudienceData:     !!audienceData,
        hasRetentionData:    !!retentionCurve,
        hasHistory:          history.length > 0,
        metricSources: {
          chatMessages:    metrics.chatMessages.source,
          followersGained: metrics.followersGained.source,
        },
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

