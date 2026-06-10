/**
 * Dashboard API – én fetch gir all data til kontrollsenteret.
 * Aggregerer: health, aktive jobber, streamstatus, sjekkliste, siste resultater.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getStreamInfo, checkTwitchApiHealth } from '@/lib/twitch';
import { checkDiscordBotHealth } from '@/lib/discord';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const DAGNAVN = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hentStreamplan(db: any) {
  try {
    const { data } = await db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single();
    const plan = data?.settings_json?.streamplan;
    if (Array.isArray(plan) && plan.length > 0) return plan;
  } catch {}
  return [];
}

function finnNesteStream(plan: any[]) {
  const idag = new Date().getDay();
  const aktive = plan.filter((d: any) => d.aktiv);
  if (!aktive.length) return null;
  const fremover = aktive.filter((d: any) => DAGNAVN.indexOf(d.dag) >= idag);
  return fremover[0] ?? aktive[0];
}

function nesteStreamTidspunkt(neste: any): Date | null {
  if (!neste) return null;
  const dagIdx = DAGNAVN.indexOf(neste.dag);
  if (dagIdx < 0) return null;
  const [timer, min] = (neste.tid ?? '20:00').split(':').map(Number);
  const now = new Date();
  const idag = now.getDay();
  let dagerTil = dagIdx - idag;
  if (dagerTil < 0) dagerTil += 7;
  if (dagerTil === 0) {
    const candidat = new Date(now);
    candidat.setHours(timer, min, 0, 0);
    if (candidat <= now) dagerTil = 7;
  }
  const d = new Date(now);
  d.setDate(d.getDate() + dagerTil);
  d.setHours(timer, min, 0, 0);
  return d;
}

function formaterNedtelling(ms: number): string {
  if (ms <= 0) return 'Nå';
  const timer = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  if (timer >= 24) return `${Math.floor(timer / 24)}d ${timer % 24}t`;
  if (timer > 0) return `${timer}t ${min}m`;
  return `${min}m`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const botApiUrl = process.env.BOT_API_URL;

  // ── Parallelle datahenting ──────────────────────────────────────────────────
  const [
    twitchHealthRes,
    discordHealthRes,
    streamRes,
    railwayRes,
    vodsRes,
    highlightsRes,
    streamplanRes,
    audienceEventsRes,
  ] = await Promise.allSettled([
    checkTwitchApiHealth(),
    checkDiscordBotHealth(),
    getStreamInfo(),
    botApiUrl
      ? fetch(botApiUrl, { signal: AbortSignal.timeout(6_000) }).then(r => ({ ok: r.ok, status: r.status }))
      : Promise.resolve(null),
    db.from('content_vods')
      .select('id,title,status,created_at,current_step,progress_percent,status_message,error_message')
      .eq('workspace_id', getWorkspaceId())
      .order('created_at', { ascending: false })
      .limit(15),
    db.from('content_highlights')
      .select('id,vod_id,clip_status,created_at')
      .eq('workspace_id', getWorkspaceId())
      .in('clip_status', ['READY_FOR_CLIP', 'CLIPPING', 'CLIPPED'])
      .order('created_at', { ascending: false })
      .limit(50),
    hentStreamplan(db),
    db.from('system_events')
      .select('event_type,metadata,created_at,title')
      .eq('workspace_id', getWorkspaceId())
      .in('event_type', ['AUDIENCE_TRACKING_HEARTBEAT', 'AUDIENCE_TRACKING_STOPPED', 'COACH_REPORT_GENERATED'])
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  // ── Health ──────────────────────────────────────────────────────────────────
  const twitchOk = twitchHealthRes.status === 'fulfilled' && twitchHealthRes.value;
  const discordOk = discordHealthRes.status === 'fulfilled' && discordHealthRes.value;
  const stream = streamRes.status === 'fulfilled' ? streamRes.value : null;
  const railwayOk = railwayRes.status === 'fulfilled' && railwayRes.value?.ok === true;
  const supabaseOk = vodsRes.status === 'fulfilled' && !vodsRes.value?.error;
  const openaiOk = !!process.env.OPENAI_API_KEY;

  const vods: any[] = vodsRes.status === 'fulfilled' ? (vodsRes.value?.data ?? []) : [];
  const highlights: any[] = highlightsRes.status === 'fulfilled' ? (highlightsRes.value?.data ?? []) : [];
  const streamplan: any[] = streamplanRes.status === 'fulfilled' ? (streamplanRes.value ?? []) : [];
  const audienceEvents: any[] = audienceEventsRes.status === 'fulfilled' ? (audienceEventsRes.value?.data ?? []) : [];

  const latestHeartbeat = audienceEvents.find(e => e.event_type === 'AUDIENCE_TRACKING_HEARTBEAT');
  const latestStopped = audienceEvents.find(e => e.event_type === 'AUDIENCE_TRACKING_STOPPED');
  const latestCoachReport = audienceEvents.find(e => e.event_type === 'COACH_REPORT_GENERATED');

  const HEARTBEAT_MAX_AGE_MS = 5 * 60_000;
  const heartbeatAge = latestHeartbeat ? Date.now() - new Date(latestHeartbeat.created_at).getTime() : Infinity;
  const isTrackingActive =
    !!latestHeartbeat &&
    heartbeatAge < HEARTBEAT_MAX_AGE_MS &&
    (!latestStopped || latestHeartbeat.created_at > latestStopped.created_at);

  const audienceTracking = {
    isActive: isTrackingActive,
    totalObserved: latestHeartbeat?.metadata?.totalObserved ?? 0,
    subscribers: latestHeartbeat?.metadata?.subscribers ?? 0,
    lastViewerCount: latestHeartbeat?.metadata?.lastViewerCount ?? 0,
    lastHeartbeat: latestHeartbeat?.created_at ?? null,
    analysisComplete: !!latestStopped && !!latestCoachReport &&
      latestCoachReport.created_at > latestStopped.created_at &&
      latestCoachReport.metadata?.streamId === latestStopped.metadata?.streamId,
    lastAnalysis: latestCoachReport?.created_at ?? null,
  };

  // ── Aktive jobber ───────────────────────────────────────────────────────────
  const aktiveVods = vods.filter(v => ['ANALYZING', 'PENDING'].includes(v.status));
  const clippingCount = highlights.filter(h => h.clip_status === 'CLIPPING').length;
  const clippedCount = highlights.filter(h => h.clip_status === 'CLIPPED').length;
  const readyCount = highlights.filter(h => h.clip_status === 'READY_FOR_CLIP').length;

  const activeJobs: { agent: string; task: string; progress: number; href: string }[] = [];

  if (stream?.isLive) {
    activeJobs.push({ agent: 'AI Producer', task: `Analyserer live stream – ${stream.viewerCount ?? 0} seere`, progress: 100, href: '/ai-producer' });
  }
  for (const v of aktiveVods.slice(0, 2)) {
    const step = v.current_step ?? v.status;
    const melding = v.status_message ?? step;
    activeJobs.push({
      agent: 'Content Factory',
      task: melding.slice(0, 70),
      progress: v.progress_percent ?? 10,
      href: '/content-factory-admin',
    });
  }
  if (clippingCount > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `Genererer ${clippingCount} klipp`, progress: 50, href: '/content-factory-admin/highlights' });
  } else if (readyCount > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `${readyCount} klipp venter i kø`, progress: 0, href: '/content-factory-admin/highlights' });
  }
  if (discordOk) {
    activeJobs.push({ agent: 'Discord Manager', task: 'Bot aktiv – lytter på events', progress: 100, href: '/discord' });
  }
  if (isTrackingActive) {
    activeJobs.push({
      agent: 'Audience Tracker',
      task: `Sporer publikum – ${audienceTracking.totalObserved} brukere observert`,
      progress: 100,
      href: '/stream-coach',
    });
  } else if (audienceTracking.analysisComplete) {
    activeJobs.push({
      agent: 'Stream Coach',
      task: 'Analyse ferdig – rapport tilgjengelig',
      progress: 100,
      href: '/stream-coach',
    });
  }

  // ── Streamstatus ────────────────────────────────────────────────────────────
  const nesteStream = finnNesteStream(streamplan);
  const nesteTidspunkt = nesteStreamTidspunkt(nesteStream);
  const msTilNeste = nesteTidspunkt ? nesteTidspunkt.getTime() - Date.now() : null;

  const streamStatus = {
    isLive: stream?.isLive ?? false,
    viewers: stream?.viewerCount ?? 0,
    game: stream?.game ?? null,
    title: stream?.title ?? null,
    thumbnailUrl: stream?.thumbnailUrl ?? null,
    nesteStream: nesteStream
      ? {
          dag: nesteStream.dag,
          tid: nesteStream.tid,
          spill: nesteStream.spill,
          tittel: nesteStream.tittel ?? null,
          nedtelling: msTilNeste != null ? formaterNedtelling(msTilNeste) : null,
          tidspunkt: nesteTidspunkt?.toISOString() ?? null,
        }
      : null,
  };

  // ── Sjekkliste for gjeldende syklus ─────────────────────────────────────────
  // Finn siste relevante VOD (siste 72t)
  const cutoff72t = new Date(Date.now() - 72 * 3600_000).toISOString();
  const sisteVod = vods.find(v => v.created_at > cutoff72t) ?? null;

  const harStreamplan = streamplan.some((d: any) => d.aktiv);
  const harVod = !!sisteVod;
  const erTranskribert = sisteVod?.status === 'COMPLETE' || (sisteVod?.current_step && sisteVod.current_step !== 'DOWNLOAD' && sisteVod.current_step !== 'TRANSCRIBING');
  const harHighlights = highlights.some(h => {
    // sjekk om highlight tilhører siste VOD
    return sisteVod ? h.vod_id === sisteVod.id : true;
  });
  const harKlipp = highlights.some(h => h.clip_status === 'CLIPPED');

  const sjekkliste = [
    { label: 'Streamplan lagret', done: harStreamplan, href: '/streamplan' },
    { label: 'Discord varslet', done: false, href: '/discord' }, // Discord-varslet status hentes ikke
    { label: 'Pre-Hype planlagt', done: false, href: '/streamplan' },
    { label: stream?.isLive ? 'Stream er live' : 'Stream startet', done: !!stream?.isLive, href: '/' },
    { label: 'VOD oppdaget', done: harVod, href: '/content-factory-admin' },
    { label: 'Transkribering ferdig', done: harVod && (sisteVod?.status === 'COMPLETE'), href: '/content-factory-admin' },
    { label: 'Highlights generert', done: harHighlights, href: '/content-factory-admin/highlights' },
    { label: 'Klipp generert', done: harKlipp, href: '/content-factory-admin/highlights' },
    { label: 'Klar for publisering', done: harKlipp, href: '/innhold/publisering' },
  ];

  // ── Siste resultater (5 siste COMPLETE VODs) ─────────────────────────────────
  const ferdigeVods = vods.filter(v => v.status === 'COMPLETE').slice(0, 5);

  // Tell highlights + klipp per VOD
  const vodIds = ferdigeVods.map(v => v.id);
  let alleHighlights: any[] = [];
  if (vodIds.length > 0) {
    const { data: hData } = await db
      .from('content_highlights')
      .select('id,vod_id,clip_status')
      .in('vod_id', vodIds);
    alleHighlights = hData ?? [];
  }

  const sisteResultater = ferdigeVods.map(v => {
    const vHighlights = alleHighlights.filter(h => h.vod_id === v.id);
    const vKlipp = vHighlights.filter(h => h.clip_status === 'CLIPPED').length;
    return {
      id: v.id,
      title: v.title,
      createdAt: v.created_at,
      highlights: vHighlights.length,
      klipp: vKlipp,
      status: v.status,
    };
  });

  return NextResponse.json({
    health: {
      twitch: { ok: twitchOk, melding: twitchOk ? 'Online' : 'Frakoblet' },
      discord: { ok: discordOk, melding: discordOk ? 'Bot aktiv' : 'Bot offline' },
      scheduler: { ok: discordOk, melding: discordOk ? 'Schedulers kjører' : 'Offline' },
      contentFactory: { ok: railwayOk, melding: railwayOk ? 'Railway online' : 'Railway offline' },
      clipWorker: { ok: railwayOk, melding: railwayOk ? `${clippingCount > 0 ? `${clippingCount} aktive` : 'Venter'}` : 'Offline' },
      supabase: { ok: supabaseOk, melding: supabaseOk ? 'Tilkoblet' : 'Feil' },
      openai: { ok: openaiOk, melding: openaiOk ? 'Nøkkel OK' : 'Nøkkel mangler' },
    },
    activeJobs,
    streamStatus,
    audienceTracking,
    sjekkliste,
    sisteResultater,
    meta: { hentetKl: new Date().toISOString() },
  });
}
