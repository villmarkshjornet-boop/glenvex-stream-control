/**
 * Dashboard LIVE – rask poll (5s).
 * Returnerer aktive jobber, stream-syklus, siste resultater, system events og debug-data.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { calcStreamScore, buildFallbackFromEvents } from '@/lib/streamScore';
import { getPartners } from '@/lib/partners';
import { tidSiden } from '@/components/dashboard/helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const DAGNAVN = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

function osloNow(): { day: number; minuteOfDay: number; utcOffsetHours: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Oslo',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[parts.find(p => p.type === 'weekday')?.value ?? 'Mon'] ?? 0;
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  const utcOffsetHours = ((hour - new Date().getUTCHours()) + 24) % 24; // 1 or 2
  return { day, minuteOfDay: hour * 60 + minute, utcOffsetHours };
}

function formaterNedtelling(ms: number): string {
  if (ms <= 0) return 'Nå';
  const timer = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  const sek = Math.floor((ms % 60_000) / 1000);
  if (timer >= 24) return `${Math.floor(timer / 24)}d ${timer % 24}t`;
  if (timer > 0) return `${timer}t ${min}m`;
  return `${min}m ${sek}s`;
}

function nesteStreamTidspunkt(neste: any): Date | null {
  if (!neste) return null;
  const dagIdx = DAGNAVN.indexOf(neste.dag);
  if (dagIdx < 0) return null;
  const [timer, min] = (neste.tid ?? '20:00').split(':').map(Number);
  const oslo = osloNow();
  let dagerTil = dagIdx - oslo.day;
  if (dagerTil < 0) dagerTil += 7;
  if (dagerTil === 0) {
    const streamMin = timer * 60 + min;
    if (streamMin <= oslo.minuteOfDay) dagerTil = 7;
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dagerTil);
  // Convert Oslo stream time to UTC for accurate countdown
  d.setUTCHours(timer - oslo.utcOffsetHours, min, 0, 0);
  return d;
}

const CURRENT_STEP_LABEL: Record<string, string> = {
  DOWNLOAD:     'Laster ned video...',
  TRANSCRIBING: 'Deepgram transkriberer...',
  DISCOVER:     'Oppdager highlights...',
  RANK:         'Rangerer highlights...',
  COPYWRITE:    'Skriver copy...',
  QUEUE:        'Setter i review-kø...',
  COMPLETE:     'Fullført',
};

function stepLabel(vod: any): string {
  if (vod.status_message) return vod.status_message.slice(0, 100);
  if (vod.current_step && CURRENT_STEP_LABEL[vod.current_step]) return CURRENT_STEP_LABEL[vod.current_step];
  return vod.current_step ?? vod.status;
}

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const ws = getWorkspaceId();
  const cutoff7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const cutoff1h = new Date(Date.now() - 60 * 60_000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();

  const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  // ── Parallelle Supabase-kall ──────────────────────────────────────────────
  const [vodsRes, highlightsRes, insightsRes, workspaceRes, systemEventsRes, subsystemEventsRes, decisionsRes, aiMemoryRes, aiEventsCountRes, streamHistoryRes, partners] = await Promise.all([
    db.from('content_vods')
      .select('id,title,status,created_at,current_step,progress_percent,error_message,status_message,updated_at')
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(20),

    db.from('content_highlights')
      .select('id,vod_id,title,clip_status,clip_url,vertical_clip_url,thumbnail_status,thumbnail_reject_count,thumbnail_error,thumbnail_ctr_score,updated_at,created_at')
      .gt('created_at', cutoff7d)
      .order('created_at', { ascending: false })
      .limit(300),

    db.from('ai_agent_insights')
      .select('title,summary,confidence_score,created_at')
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(5),

    db.from('workspaces')
      .select('settings_json')
      .eq('id', ws)
      .single(),

    db.from('system_events')
      .select('id,source,event_type,title,description,severity,metadata,created_at')
      .eq('workspace_id', ws)
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(100),

    // Siste event per subsystem (siste 24t) for kontrollsenter-widgets
    db.from('system_events')
      .select('source,event_type,title,severity,created_at')
      .eq('workspace_id', ws)
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(500),

    // Siste AI-beslutninger for effect tracking (siste 30 dager)
    db.from('ai_agent_decisions')
      .select('agent_type,decision_type,decision_summary,outcome,feedback_score,created_at,input_context')
      .eq('workspace_id', ws)
      .gte('created_at', cutoff30d)
      .order('created_at', { ascending: false })
      .limit(30),

    // Siste memory-oppdatering (for AI learning health)
    db.from('ai_agent_memory')
      .select('updated_at')
      .eq('workspace_id', ws)
      .order('updated_at', { ascending: false })
      .limit(1),

    // Antall ai_agent_events siste 60 min
    db.from('ai_agent_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .gte('created_at', cutoff1h),

    // Siste 6 avsluttede streams (kilde for Hero + "Siste streams")
    db.from('stream_history')
      .select('stream_id,title,game,started_at,ended_at,duration_minutes,peak_viewers,avg_viewers,chat_messages,followers_gained,subs_gained,raids_during')
      .eq('workspace_id', ws)
      .order('ended_at', { ascending: false })
      .limit(6),

    // Partnere – for "Fremhev partner"-handling i Action Center
    getPartners(),
  ]);

  const vods: any[]       = vodsRes.data ?? [];
  const highlights: any[] = highlightsRes.data ?? [];
  const nyesteInnsikter   = insightsRes.data ?? [];
  const streamplan: any[] = workspaceRes.data?.settings_json?.streamplan ?? [];
  const syklus: any       = workspaceRes.data?.settings_json?.stream_syklus ?? {};
  const systemEvents: any[] = systemEventsRes.data ?? [];
  const subsystemEvents: any[] = subsystemEventsRes.data ?? [];
  const decisions: any[] = decisionsRes.data ?? [];
  const lastMemoryUpdate: string | null = aiMemoryRes.data?.[0]?.updated_at ?? null;
  const eventsLast60min: number = aiEventsCountRes.count ?? 0;
  const recentStreamsRaw: any[] = streamHistoryRes.data ?? [];

  // ── Aktive VOD-jobber ─────────────────────────────────────────────────────
  const aktiveVods = vods.filter(v =>
    ['PENDING', 'ANALYZING', 'TRANSCRIBED'].includes(v.status)
  );

  // ── Clip/thumbnail-tellinger ──────────────────────────────────────────────
  const clippingNå      = highlights.filter(h => h.clip_status === 'CLIPPING').length;
  const readyForClip    = highlights.filter(h => h.clip_status === 'READY_FOR_CLIP').length;
  const thumbPending    = highlights.filter(h => h.thumbnail_status === 'PENDING').length;
  const thumbGenerating = highlights.filter(h => h.thumbnail_status === 'GENERATING').length;

  // ── Active jobs ──────────────────────────────────────────────────────────
  const activeJobs: { agent: string; task: string; progress: number; href: string; detail?: string }[] = [];

  for (const v of aktiveVods.slice(0, 4)) {
    const isTrans = v.status === 'TRANSCRIBED';
    const task = isTrans
      ? '✓ Transkribert – Phase 2 starter...'
      : stepLabel(v);
    const minutesStuck = (Date.now() - new Date(v.updated_at ?? v.created_at).getTime()) / 60_000;
    const stuckTag = minutesStuck > 20 ? ` ⚠ ${Math.round(minutesStuck)}min uten oppdatering` : '';
    activeJobs.push({
      agent:    'Content Factory',
      task:     task.slice(0, 90),
      detail:   v.title?.slice(0, 60) + stuckTag,
      progress: v.progress_percent ?? 10,
      href:     '/content-factory-admin',
    });
  }

  if (clippingNå > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `Klipper ${clippingNå} highlight${clippingNå > 1 ? 's' : ''}`, progress: 50, href: '/content-factory-admin/highlights' });
  } else if (readyForClip > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `${readyForClip} klipp venter i kø`, progress: 0, href: '/content-factory-admin/highlights' });
  }

  if (thumbGenerating > 0) {
    activeJobs.push({ agent: 'Thumbnail', task: `Genererer ${thumbGenerating} thumbnail${thumbGenerating > 1 ? 's' : ''}`, progress: 50, href: '/content-factory-admin/highlights' });
  } else if (thumbPending > 0) {
    activeJobs.push({ agent: 'Thumbnail', task: `${thumbPending} thumbnails venter i kø`, progress: 0, href: '/content-factory-admin/highlights' });
  }

  // ── Neste stream ─────────────────────────────────────────────────────────
  const aktiveStreamdager = streamplan.filter((d: any) => d.aktiv);
  const idag = osloNow().day; // Oslo-tid – ikke UTC
  const nesteStream = aktiveStreamdager.find((d: any) => DAGNAVN.indexOf(d.dag) >= idag) ?? aktiveStreamdager[0] ?? null;
  const nesteTidspunkt = nesteStreamTidspunkt(nesteStream);
  const msTilNeste = nesteTidspunkt ? nesteTidspunkt.getTime() - Date.now() : null;

  // ── Sistestreams og syklus-kontekst ───────────────────────────────────────
  // siste VOD registrert (72t)
  const cutoff72t = new Date(Date.now() - 72 * 3600_000).toISOString();
  const sisteVod = vods.find(v => v.created_at > cutoff72t) ?? null;
  const sisteVodHighlights = sisteVod ? highlights.filter(h => h.vod_id === sisteVod.id) : [];
  const harKlipp = sisteVodHighlights.some(h => h.clip_status === 'CLIPPED');

  // Transcript count for sisteVod (avgjørende for korrekt status)
  let transcriptCount = 0;
  if (sisteVod) {
    const { count } = await db
      .from('content_transcripts')
      .select('id', { count: 'exact', head: true })
      .eq('vod_id', sisteVod.id);
    transcriptCount = count ?? 0;
  }

  // ── Hero: siste avsluttede stream + datastatus-sjekkliste ────────────────
  // Hvis stream_history mangler raden, fall tilbake til ai_agent_events (samme logikk som Stream Coach)
  // slik at vi aldri viser "ingen stream" når det faktisk finnes ekte data om streamen.
  let sisteStream: any = recentStreamsRaw[0] ?? null;
  let heroFallbackUsed = false;
  let fallbackAudience: any = null;
  if (!sisteStream) {
    const fallback = await buildFallbackFromEvents(db, ws);
    if (fallback) {
      sisteStream = fallback.syntheticStream;
      fallbackAudience = fallback.audienceData;
      heroFallbackUsed = true;
    }
  }

  let heroStreamEventsRes: any = { data: [] };
  let heroAgentEventsRes: any = { data: [] };
  if (sisteStream?.stream_id) {
    [heroStreamEventsRes, heroAgentEventsRes] = await Promise.all([
      db.from('system_events')
        .select('event_type,metadata,created_at')
        .eq('workspace_id', ws)
        .in('event_type', ['COACH_REPORT_GENERATED', 'STREAM_COACH_FAILED', 'STREAM_HISTORY_UPSERT_FAILED'])
        .contains('metadata', { streamId: sisteStream.stream_id })
        .order('created_at', { ascending: false })
        .limit(5),
      db.from('ai_agent_events')
        .select('event_type,metadata,created_at')
        .eq('workspace_id', ws)
        .in('event_type', ['AUDIENCE_SESSION_COMPLETE', 'RETENTION_CURVE'])
        .contains('metadata', { stream_id: sisteStream.stream_id })
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
  }

  let heroStream: any = null;
  if (sisteStream) {
    const heroEvents: any[] = heroStreamEventsRes.data ?? [];
    const agentEvents: any[] = heroAgentEventsRes.data ?? [];

    const audienceEvent = agentEvents.find(e => e.event_type === 'AUDIENCE_SESSION_COMPLETE');
    const audienceMeta: any = heroFallbackUsed ? fallbackAudience : (audienceEvent?.metadata ?? null);
    const hasAudienceData = heroFallbackUsed ? !!fallbackAudience : !!audienceEvent;
    const hasRetentionCurve = agentEvents.some(e => e.event_type === 'RETENTION_CURVE');
    const hasChatEvents = (sisteStream.chat_messages ?? 0) > 0;
    const coachFailed = heroEvents.some(e => e.event_type === 'STREAM_COACH_FAILED');
    const historyUpsertFailed = heroEvents.some(e => e.event_type === 'STREAM_HISTORY_UPSERT_FAILED');
    const hasStreamCoach = heroEvents.some(e => e.event_type === 'COACH_REPORT_GENERATED') && !coachFailed;

    const endedAtMs = new Date(sisteStream.ended_at).getTime();
    const vodDetected = vods.some(v => {
      const t = new Date(v.created_at).getTime();
      return t >= endedAtMs - 2 * 3600_000 && t <= endedAtMs + 48 * 3600_000;
    });
    const aiLearningUpdated = nyesteInnsikter.some((i: any) => new Date(i.created_at).getTime() > endedAtMs);

    const score = calcStreamScore(sisteStream, audienceMeta);
    const uniqueChatters = audienceMeta?.total ?? 0;

    const failureReasons: string[] = [];
    if (heroFallbackUsed) failureReasons.push('Stream History-rad mangler – viser estimat fra ai_agent_events');
    if (!hasAudienceData) failureReasons.push('Audience-data mangler');
    if (!hasRetentionCurve) failureReasons.push('Retention-kurve mangler');
    if (!hasStreamCoach && !coachFailed) failureReasons.push('Stream Coach-rapport ikke generert ennå');
    if (coachFailed) failureReasons.push('Stream Coach feilet');
    if (historyUpsertFailed) failureReasons.push('Stream History-lagring feilet (delvis)');
    if (!vodDetected) failureReasons.push('VOD ikke funnet');

    heroStream = {
      streamId: sisteStream.stream_id,
      title: sisteStream.title,
      game: sisteStream.game,
      startedAt: sisteStream.started_at,
      endedAt: sisteStream.ended_at,
      durationMinutes: sisteStream.duration_minutes ?? 0,
      peakViewers: sisteStream.peak_viewers ?? 0,
      avgViewers: sisteStream.avg_viewers ?? 0,
      chatMessages: sisteStream.chat_messages ?? 0,
      uniqueChatters,
      streamScore: score.total,
      grade: score.grade,
      scoreBreakdown: score.breakdown,
      checklist: {
        streamHistory: !heroFallbackUsed,
        audienceData: hasAudienceData,
        retentionCurve: hasRetentionCurve,
        chatEvents: hasChatEvents,
        streamCoach: hasStreamCoach,
        vodDetected,
        aiLearning: aiLearningUpdated,
      },
      ok: failureReasons.length === 0,
      failureReasons,
    };
  }

  // ── Siste streams (for "Siste streams"-widget) ────────────────────────────
  const recentStreams = recentStreamsRaw.map((s: any) => {
    const score = calcStreamScore(s, null);
    const peak = s.peak_viewers ?? 0;
    const avg = s.avg_viewers ?? 0;
    return {
      streamId: s.stream_id,
      title: s.title,
      game: s.game,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      durationMinutes: s.duration_minutes ?? 0,
      peakViewers: peak,
      avgViewers: avg,
      streamScore: score.total,
      grade: score.grade,
      retentionPct: peak > 0 ? Math.round((avg / peak) * 100) : 0,
    };
  });

  // Er vi i post-stream-fase?
  // Ja hvis: stream startet siste 48t ELLER aktiv VOD-jobb eksisterer
  const streamStartAt = syklus.stream_start_at;
  const hasRecentStreamStart = streamStartAt &&
    (Date.now() - new Date(streamStartAt).getTime()) < 48 * 3600_000;
  const inPostStreamPhase = hasRecentStreamStart || aktiveVods.length > 0 || !!sisteVod;

  // Pre-hype status
  const preHypeSendtAt = syklus.pre_hype_sendt_at ?? null;
  const preHypeStatus: 'klar' | 'planlagt' | 'sendt' | 'ikke_planlagt' =
    preHypeSendtAt ? 'sendt' :
    nesteStream    ? 'planlagt' :
                     'ikke_planlagt';

  const nextPreHypeMs = nesteTidspunkt && !preHypeSendtAt
    ? nesteTidspunkt.getTime() - 30 * 60_000 - Date.now()  // 30min før
    : null;

  // ── Sjekkliste ────────────────────────────────────────────────────────────
  const transkripertFerdig = !!sisteVod &&
    ['TRANSCRIBED', 'COMPLETE'].includes(sisteVod.status) &&
    transcriptCount > 0;

  let sjekkliste: { label: string; done: boolean; href: string }[];

  if (!inPostStreamPhase) {
    // Pre-stream modus – vis kun planleggingssteg
    sjekkliste = [
      { label: 'Streamplan lagret',  done: aktiveStreamdager.length > 0, href: '/streamplan' },
      { label: 'Discord varslet',    done: !!syklus.discord_varslet_at, href: '/discord' },
      { label: 'Pre-hype planlagt',  done: !!preHypeSendtAt || !!nesteStream, href: '/streamplan' },
      { label: 'Venter på stream',   done: false, href: '/' },
    ];
  } else {
    // Post-stream modus – vis fullstendig syklus
    sjekkliste = [
      { label: 'Streamplan lagret',      done: aktiveStreamdager.length > 0,     href: '/streamplan' },
      { label: 'Discord varslet',        done: !!syklus.discord_varslet_at,       href: '/discord' },
      { label: 'Pre-hype sendt',         done: !!preHypeSendtAt,                  href: '/streamplan' },
      { label: 'Stream startet',         done: !!streamStartAt,                   href: '/' },
      { label: 'VOD oppdaget',           done: !!sisteVod,                         href: '/content-factory-admin' },
      { label: `Transkribert${transcriptCount > 0 ? ` (${transcriptCount} seg.)` : ''}`,
                                         done: transkripertFerdig,                 href: '/content-factory-admin' },
      { label: 'Highlights generert',    done: sisteVodHighlights.length > 0,     href: '/content-factory-admin/highlights' },
      { label: 'Klipp generert',         done: harKlipp,                          href: '/content-factory-admin/highlights' },
      { label: 'Klar for publisering',   done: harKlipp,                          href: '/innhold/publisering' },
    ];
  }

  // ── Siste resultater (siste 8 VODs) ──────────────────────────────────────
  const sisteResultater = vods.slice(0, 8).map(v => {
    const vH = highlights.filter(h => h.vod_id === v.id);
    const minutesStuck = (Date.now() - new Date(v.updated_at ?? v.created_at).getTime()) / 60_000;
    return {
      id: v.id,
      title: v.title,
      status: v.status,
      progressPercent: v.progress_percent ?? null,
      statusMessage: v.status_message ?? v.current_step ?? null,
      errorMessage: v.error_message ?? null,
      createdAt: v.created_at,
      currentStep: v.current_step ?? null,
      minutesStuck: v.status !== 'COMPLETE' && v.status !== 'ERROR' ? Math.round(minutesStuck) : 0,
      highlights: vH.length,
      klipp: vH.filter(h => h.clip_status === 'CLIPPED').length,
      readyForClip: vH.filter(h => h.clip_status === 'READY_FOR_CLIP').length,
      clipping: vH.filter(h => h.clip_status === 'CLIPPING').length,
      thumbDone: vH.filter(h => h.thumbnail_status === 'DONE').length,
      thumbPending: vH.filter(h => h.thumbnail_status === 'PENDING').length,
      thumbGenerating: vH.filter(h => h.thumbnail_status === 'GENERATING').length,
    };
  });

  // ── Clip status panel ─────────────────────────────────────────────────────
  const sisteKlippede = highlights
    .filter(h => h.clip_status === 'CLIPPED' && (h.clip_url || h.vertical_clip_url))
    .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
    .slice(0, 5)
    .map(h => {
      const vodTitle = vods.find(v => v.id === h.vod_id)?.title ?? null;
      return {
        id: h.id, vodId: h.vod_id, title: h.title ?? null, vodTitle,
        clip_url_16_9: h.clip_url ?? null, clip_url_9_16: h.vertical_clip_url ?? null,
        clippedAt: h.updated_at ?? h.created_at,
      };
    });

  const clipStatus = { clipping: clippingNå, readyForClip, sisteKlippede };

  // ── Trenger oppmerksomhet: ting som faktisk krever handling ──────────────
  const needsAttention: { type: string; severity: 'warning' | 'error'; title: string; detail?: string; href: string; createdAt: string }[] = [];

  for (const h of highlights.filter(h => h.thumbnail_status === 'NEEDS_MANUAL_REVIEW')) {
    needsAttention.push({
      type: 'thumbnail_review',
      severity: 'warning',
      title: `Thumbnail krever manuell gjennomgang: ${h.title ?? h.id.slice(0, 8)}`,
      detail: h.thumbnail_error ?? `${h.thumbnail_reject_count ?? 3} CTR-avvisninger`,
      href: '/content-factory-admin/highlights',
      createdAt: h.updated_at ?? h.created_at,
    });
  }

  for (const v of vods.filter(v => v.status === 'ERROR')) {
    needsAttention.push({
      type: 'vod_failed',
      severity: 'error',
      title: `VOD feilet: ${v.title}`,
      detail: v.error_message ?? undefined,
      href: '/content-factory-admin',
      createdAt: v.updated_at ?? v.created_at,
    });
  }

  const ATTENTION_EVENT_TYPES: Record<string, { severity: 'warning' | 'error'; label: string; href: string }> = {
    VOD_NOT_FOUND:                 { severity: 'warning', label: 'VOD ikke funnet etter stream',           href: '/content-factory-admin' },
    DISCORD_ADMIN_CHANNEL_MISSING: { severity: 'warning', label: 'Discord admin-kanal mangler',             href: '/discord' },
    TWITCH_AUTH_ERROR:             { severity: 'error',   label: 'Twitch-autentisering feilet',             href: '/innstillinger' },
    STREAM_COACH_FAILED:           { severity: 'error',   label: 'Stream Coach feilet',                     href: '/stream-coach' },
    STREAM_HISTORY_UPSERT_FAILED:  { severity: 'error',   label: 'Stream History-lagring feilet',           href: '/stream-coach' },
  };
  for (const [eventType, def] of Object.entries(ATTENTION_EVENT_TYPES)) {
    const e = systemEvents.find((e: any) => e.event_type === eventType);
    if (!e) continue;
    needsAttention.push({
      type: eventType.toLowerCase(),
      severity: def.severity,
      title: def.label,
      detail: e.title,
      href: def.href,
      createdAt: e.created_at,
    });
  }
  needsAttention.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // ── Action Center: én rangert handlingsliste basert på ekte data ─────────
  const readyToPublish = highlights.filter(h => h.clip_status === 'CLIPPED' && h.thumbnail_status === 'DONE');
  const activePartners = (partners as any[]).filter(p => p.aktiv);
  const stalestPartner = activePartners.length > 0
    ? [...activePartners].sort((a, b) => {
        const aT = a.sistePromotert ? new Date(a.sistePromotert).getTime() : 0;
        const bT = b.sistePromotert ? new Date(b.sistePromotert).getTime() : 0;
        return aT - bT;
      })[0]
    : null;

  const actionCenter: { type: string; priority: 'error' | 'warning' | 'action'; title: string; detail?: string; href: string; createdAt: string }[] = [];

  for (const item of needsAttention) {
    actionCenter.push({ type: item.type, priority: item.severity, title: item.title, detail: item.detail, href: item.href, createdAt: item.createdAt });
  }

  if (readyToPublish.length > 0) {
    const sortedReady = [...readyToPublish].sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());
    const newest = sortedReady[0];
    const titler = sortedReady.slice(0, 2).map(h => h.title ?? `#${h.id.slice(0, 6)}`).join(', ');
    actionCenter.push({
      type: 'publish_clips',
      priority: 'action',
      title: `${readyToPublish.length} klipp klare for publisering`,
      detail: `${titler}${readyToPublish.length > 2 ? ' m.fl.' : ''} · sist klippet ${tidSiden(newest.updated_at ?? newest.created_at)}`,
      href: '/content-factory-admin/highlights',
      createdAt: newest.updated_at ?? newest.created_at,
    });
  }

  if (stalestPartner) {
    actionCenter.push({
      type: 'promote_partner',
      priority: 'action',
      title: `Fremhev partner: ${stalestPartner.navn}`,
      detail: stalestPartner.sistePromotert ? `Sist promotert ${tidSiden(stalestPartner.sistePromotert)}` : 'Aldri promotert ennå',
      href: '/partnere',
      createdAt: stalestPartner.sistePromotert ?? stalestPartner.opprettet,
    });
  }

  if (msTilNeste != null && msTilNeste > 0) {
    actionCenter.push({
      type: 'next_stream',
      priority: 'action',
      title: 'Forbered neste stream',
      detail: `${nesteStream.dag} kl. ${nesteStream.tid} – om ${formaterNedtelling(msTilNeste)}`,
      href: '/streamplan',
      createdAt: new Date().toISOString(),
    });
  }

  const ACTION_PRIORITY_ORDER: Record<string, number> = { error: 0, warning: 1, action: 2 };
  actionCenter.sort((a, b) => ACTION_PRIORITY_ORDER[a.priority] - ACTION_PRIORITY_ORDER[b.priority]);

  // ── Debug data ────────────────────────────────────────────────────────────
  const debug = {
    sisteVodId:       sisteVod?.id ?? null,
    sisteVodStatus:   sisteVod?.status ?? null,
    sisteVodStep:     sisteVod?.current_step ?? null,
    sisteVodMsg:      sisteVod?.status_message ?? null,
    transcriptCount,
    highlightCount:   sisteVodHighlights.length,
    clipCount:        sisteVodHighlights.filter(h => h.clip_status === 'CLIPPED').length,
    thumbDoneCount:   sisteVodHighlights.filter(h => h.thumbnail_status === 'DONE').length,
    inPostStreamPhase,
    syklusStreamStart: streamStartAt ?? null,
    preHypeStatus,
    aktiveVods:       aktiveVods.length,
    thumbActive:      thumbPending + thumbGenerating,
  };

  // ── Live hendelser (fra system_events – erstatter live_events) ───────────
  const liveEvents: any[] = (subsystemEvents ?? []).slice(0, 20).map((e: any) => ({
    type: e.event_type, ts: e.created_at, source: e.source, title: e.title,
    severity: e.severity, metadata: e.metadata,
  }));

  // ── Kontrollsenter: subsystem-status fra system_events siste 24t ─────────
  const SUBSYSTEMER = [
    { key: 'live',         label: 'Live Detection',      events: ['LIVE_DETECTED', 'STREAM_OFFLINE_DETECTED', 'POST_STREAM_STARTED', 'LIVE_DETECTION_FAILED'] },
    { key: 'pre_hype',     label: 'Pre-hype',            events: ['PREHYPE_SENT', 'PREHYPE_SCHEDULED', 'STREAM_CYCLE_RESET'] },
    { key: 'vod',          label: 'VOD Pipeline',        events: ['VOD_AUTO_QUEUE_STARTED', 'VOD_NOT_FOUND', 'VOD_LOOKUP_STARTED', 'VOD_DETECTED', 'VOD_PIPELINE_DONE'] },
    { key: 'discovery',    label: 'Highlight Discovery', events: ['DISCOVERY_STARTED', 'DISCOVERY_COMPLETED'] },
    { key: 'ranking',      label: 'Highlight Ranking',   events: ['RANKING_COMPLETED', 'COPYWRITING_COMPLETED'] },
    { key: 'clip_factory', label: 'Clip Factory',        events: ['CLIP_EXTRACTED'] },
    { key: 'thumbnail',    label: 'Thumbnail Generator', events: ['THUMBNAIL_DONE', 'THUMBNAIL_FAILED'] },
    { key: 'aggregator',   label: 'Aggregator',          events: ['LEARNING_AGGREGATION_COMPLETED', 'LEARNING_AGGREGATION_STARTED', 'INSIGHT_CREATED', 'MEMORY_UPDATED'] },
    { key: 'feedback',     label: 'Feedback Loop',       events: ['DECISION_FEEDBACK_LEARNED', 'DECISION_FEEDBACK_ANALYSIS_COMPLETED', 'DECISION_FEEDBACK_CONSUMED'] },
    { key: 'ai_producer',  label: 'AI Producer',         events: ['AI_PRODUCER_ANALYSIS_COMPLETE', 'AI_PRODUCER_RECOMMENDATION_COMPLETED', 'AI_PRODUCER_RECOMMENDATION_DISMISSED'] },
    { key: 'raid',         label: 'Raid Manager',        events: ['RAID_CANDIDATES_CHECKED', 'RAID_RECOMMENDATION_CREATED'] },
    { key: 'discord',      label: 'Discord Bot',         events: ['DISCORD_AI_RESPONSE', 'DISCORD_HISTORY_SYNC_COMPLETED', 'DISCORD_HISTORY_SYNC_FAILED', 'DISCORD_ROLE_ASSIGNED'] },
    { key: 'briefing',     label: 'Stream Briefing',     events: ['PRE_STREAM_BRIEFING_GENERATED'] },
  ];

  const kontrollsenter = SUBSYSTEMER.map(sub => {
    const relevante = subsystemEvents.filter(e => sub.events.includes(e.event_type));
    const siste = relevante[0] ?? null;
    const harFeil = relevante.some(e => e.severity === 'error');
    return {
      key: sub.key,
      label: sub.label,
      status: siste ? (harFeil ? 'feil' : 'ok') : 'ingen_aktivitet',
      sisteKjøring: siste?.created_at ?? null,
      sisteEvent: siste?.event_type ?? null,
      sisteTitle: siste?.title ?? null,
      antall24h: relevante.length,
    };
  });

  // ── Lærdom: effect tracking basert på ai_agent_decisions ─────────────────
  const utførteTiltak = decisions.filter(d => d.outcome === 'executed' || d.feedback_score === 1);
  const avvisteTiltak = decisions.filter(d => d.outcome === 'dismissed' || (d.feedback_score !== null && d.feedback_score === 0));
  const raidAnbefalinger = decisions.filter(d => d.agent_type === 'raid_manager');

  // Confidence-logikk: basert på datamengde
  const totalDatapunkter = decisions.length;
  const confidenceLabel =
    totalDatapunkter < 3  ? 'for_lite_datagrunnlag' :
    totalDatapunkter < 10 ? 'lav' :
    totalDatapunkter < 30 ? 'medium' : 'høy';

  const lærdom = {
    utførteTiltak: utførteTiltak.slice(0, 5).map(d => ({
      summary: d.decision_summary,
      game: d.input_context?.game ?? null,
      executedAt: d.created_at,
      agentType: d.agent_type,
    })),
    avvisteTiltak: avvisteTiltak.slice(0, 3).map(d => ({
      summary: d.decision_summary,
      executedAt: d.created_at,
    })),
    raidHistorikk: raidAnbefalinger.slice(0, 3).map(d => ({
      summary: d.decision_summary,
      executedAt: d.created_at,
    })),
    totalDatapunkter,
    confidenceLabel,
    siste30dager: {
      utført: utførteTiltak.length,
      avvist: avvisteTiltak.length,
      raids: raidAnbefalinger.length,
      analyser: decisions.filter(d => d.decision_type === 'stream_analysis').length,
    },
    notat: totalDatapunkter < 3
      ? 'For lite datagrunnlag for effektanalyse – systemet lærer etter hvert som tiltak utføres.'
      : `${totalDatapunkter} beslutninger loggett siste 30 dager. Confidence: ${confidenceLabel}.`,
  };

  // ── AI Learning health (beregnet fra allerede-hentede data) ──────────────
  const lastAggregation = systemEvents.find(e =>
    e.event_type === 'LEARNING_AGGREGATION_COMPLETED' || e.event_type === 'AGGREGATION_COMPLETE'
  ) ?? null;
  const lastFeedbackRun = systemEvents.find(e =>
    e.event_type === 'DECISION_FEEDBACK_ANALYSIS_COMPLETED' || e.event_type === 'DECISION_FEEDBACK_LEARNED'
  ) ?? null;
  const lastInsight = nyesteInnsikter[0] ?? null;
  const decisionsLast24h = decisions.filter(d => d.created_at >= cutoff24h).length;
  const feedbackDecisionsLast24h = decisions.filter(d =>
    d.created_at >= cutoff24h && (d.outcome === 'executed' || d.outcome === 'dismissed' || d.feedback_score !== null)
  ).length;
  const sisteInnsikt = lastInsight ? { title: lastInsight.title, summary: lastInsight.summary, createdAt: lastInsight.created_at } : null;

  const aiLearning = {
    lastAggregation: lastAggregation?.created_at ?? null,
    lastAggregationTitle: lastAggregation?.title ?? null,
    lastFeedbackRun: lastFeedbackRun?.created_at ?? null,
    lastFeedbackTitle: lastFeedbackRun?.title ?? null,
    lastMemoryUpdate,
    lastInsightAt: lastInsight?.created_at ?? null,
    eventsLast60min,
    decisionsLast24h,
    feedbackDecisionsLast24h,
    sisteInnsikt,
  };

  // ── Event Coverage (per kilde, basert på siste 24t system_events) ────────
  const COVERAGE_DEFS = [
    { key: 'twitch',     label: 'Twitch Bot',      sources: ['twitch_bot'],          windowH: 12, passive: false },
    { key: 'discord',    label: 'Discord Bot',     sources: ['discord_bot'],         windowH: 12, passive: false },
    { key: 'scheduler',  label: 'Scheduler',       sources: ['scheduler'],           windowH: 24, passive: false },
    { key: 'aggregator', label: 'AI Learning',     sources: ['learning_aggregator'], windowH: 12, passive: false },
    { key: 'content',    label: 'Content Factory', sources: ['content_factory'],     windowH: 24, passive: false },
    { key: 'cron',       label: 'Cron Jobs',       sources: ['cron'],                windowH: 24, passive: false },
    { key: 'api',        label: 'API Monitor',     sources: ['api_monitor'],         windowH: 24, passive: true  },
    { key: 'database',   label: 'Database',        sources: ['database'],            windowH: 24, passive: true  },
    { key: 'recovery',   label: 'Recovery Engine', sources: ['recovery_engine'],     windowH: 24, passive: false },
  ];

  // HEARTBEAT-events telles alltid som aktivitet uansett event_type
  // (subsystemEvents inneholder alle events siste 24t — HEARTBEAT er nå blant dem)

  const coverage = COVERAGE_DEFS.map(cs => {
    const events = subsystemEvents.filter((e: any) => cs.sources.includes(e.source));
    const lastSeen: string | null = events[0]?.created_at ?? null;
    const ageH = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) / 3_600_000 : Infinity;
    const status: 'active' | 'stale' | 'offline' | 'passive' =
      cs.passive && !lastSeen ? 'passive' :
      ageH <= cs.windowH      ? 'active'  :
      ageH <= cs.windowH * 3  ? 'stale'   : 'offline';
    const errors24h = events.filter((e: any) => e.severity === 'error' || e.severity === 'critical').length;
    return { key: cs.key, label: cs.label, lastSeen, status, count24h: events.length, passive: cs.passive, errors24h };
  });

  // ── Aktivitetsfeed uten heartbeat-spam ─────────────────────────────────────
  const visibleSystemEvents = systemEvents.filter((e: any) => !/HEARTBEAT/i.test(e.event_type));

  return NextResponse.json({
    nyesteInnsikter: nyesteInnsikter.map(i => ({
      title: i.title, summary: i.summary,
      confidenceScore: i.confidence_score, createdAt: i.created_at,
    })),
    activeJobs,
    nesteStream: nesteStream ? {
      dag: nesteStream.dag, tid: nesteStream.tid, spill: nesteStream.spill,
      tittel: nesteStream.tittel ?? null,
      nedtelling: msTilNeste != null ? formaterNedtelling(msTilNeste) : null,
      tidspunkt: nesteTidspunkt?.toISOString() ?? null,
    } : null,
    preHype: {
      status: preHypeStatus,
      sendtAt: preHypeSendtAt,
      tidTilUtsending: nextPreHypeMs != null && nextPreHypeMs > 0 ? formaterNedtelling(nextPreHypeMs) : null,
    },
    sjekkliste,
    sisteResultater,
    clipStatus,
    systemEvents: visibleSystemEvents,
    liveEvents,
    kontrollsenter,
    lærdom,
    aiLearning,
    coverage,
    heroStream,
    actionCenter,
    recentStreams,
    debug,
    ts: new Date().toISOString(),
  });
}
