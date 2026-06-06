/**
 * Dashboard LIVE – rask poll (kun Supabase, ingen eksterne API-kall).
 * Returnerer aktive jobber, stream-syklus sjekkliste, siste resultater og streamplan.
 * Brukes med 5s polling fra dashboard.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const DAGNAVN = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

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
  const now = new Date();
  let dagerTil = dagIdx - now.getDay();
  if (dagerTil < 0) dagerTil += 7;
  if (dagerTil === 0) {
    const c = new Date(now);
    c.setHours(timer, min, 0, 0);
    if (c <= now) dagerTil = 7;
  }
  const d = new Date(now);
  d.setDate(d.getDate() + dagerTil);
  d.setHours(timer, min, 0, 0);
  return d;
}

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const cutoff7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  // ── Parallelle Supabase-kall ──────────────────────────────────────────────
  const [vodsRes, highlightsRes, insightsRes, workspaceRes] = await Promise.all([
    db.from('content_vods')
      .select('id,title,status,created_at,current_step,progress_percent,status_message,error_message')
      .eq('workspace_id', getWorkspaceId())
      .order('created_at', { ascending: false })
      .limit(20),

    // Alle highlights siste 7 dager (ingen clip_status-filter – ellers telles ikke nye highlights)
    db.from('content_highlights')
      .select('id,vod_id,title,start_time,clip_status,clip_url_16_9,clip_url_9_16,clip_error,updated_at,created_at')
      .gt('created_at', cutoff7d)
      .order('created_at', { ascending: false })
      .limit(300),

    db.from('ai_agent_insights')
      .select('title,summary,confidence_score,created_at')
      .eq('workspace_id', getWorkspaceId())
      .order('created_at', { ascending: false })
      .limit(3),

    db.from('workspaces')
      .select('settings_json')
      .eq('id', getWorkspaceId())
      .single(),
  ]);

  const vods: any[] = vodsRes.data ?? [];
  const highlights: any[] = highlightsRes.data ?? [];
  const nyesteInnsikter: any[] = insightsRes.data ?? [];
  const streamplan: any[] = workspaceRes.data?.settings_json?.streamplan ?? [];

  // TEMP DEBUG
  console.log('[DEBUG] vodsRes.error:', vodsRes.error?.message);
  console.log('[DEBUG] vods.length:', vods.length);
  console.log('[DEBUG] vods ids:', vods.map(v => v.id + '|' + v.created_at).join(', '));
  console.log('[DEBUG] highlightsRes.error:', highlightsRes.error?.message);

  // ── Aktive jobber ────────────────────────────────────────────────────────
  const aktiveVods = vods.filter(v => ['PENDING', 'ANALYZING', 'TRANSCRIBED'].includes(v.status));
  const clippingNå = highlights.filter(h => h.clip_status === 'CLIPPING').length;
  const readyForClip = highlights.filter(h => h.clip_status === 'READY_FOR_CLIP').length;

  const activeJobs: { agent: string; task: string; progress: number; href: string }[] = [];

  for (const v of aktiveVods.slice(0, 3)) {
    const melding =
      v.status === 'TRANSCRIBED'
        ? '✓ Transkribering ferdig – Phase 2 starter...'
        : (v.status_message ?? v.current_step ?? v.status);
    activeJobs.push({
      agent: 'Content Factory',
      task: melding.slice(0, 80),
      progress: v.progress_percent ?? 10,
      href: '/content-factory-admin',
    });
  }

  if (clippingNå > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `Klipper ${clippingNå} highlight${clippingNå > 1 ? 's' : ''}`, progress: 50, href: '/content-factory-admin/highlights' });
  } else if (readyForClip > 0) {
    activeJobs.push({ agent: 'Clip Worker', task: `${readyForClip} klipp venter i kø`, progress: 0, href: '/content-factory-admin/highlights' });
  }

  // ── Streamplan / neste stream ─────────────────────────────────────────────
  const aktiveStreamdager = streamplan.filter((d: any) => d.aktiv);
  const idag = new Date().getDay();
  const nesteStream = aktiveStreamdager.find((d: any) => DAGNAVN.indexOf(d.dag) >= idag) ?? aktiveStreamdager[0] ?? null;
  const nesteTidspunkt = nesteStreamTidspunkt(nesteStream);
  const msTilNeste = nesteTidspunkt ? nesteTidspunkt.getTime() - Date.now() : null;

  // ── Sjekkliste (siste 72t) ────────────────────────────────────────────────
  const cutoff72t = new Date(Date.now() - 72 * 3600_000).toISOString();
  const sisteVod = vods.find(v => v.created_at > cutoff72t) ?? null;
  // Alle highlights for siste VOD (inkludert de uten clip_status)
  const sisteVodHighlights = sisteVod ? highlights.filter(h => h.vod_id === sisteVod.id) : [];
  const harKlipp = sisteVodHighlights.some(h => h.clip_status === 'CLIPPED');
  const syklus = workspaceRes.data?.settings_json?.stream_syklus ?? {};

  const sjekkliste = [
    { label: 'Streamplan lagret', done: aktiveStreamdager.length > 0, href: '/streamplan' },
    { label: 'Discord varslet', done: !!syklus.discord_varslet_at, href: '/discord' },
    { label: 'Pre-Hype planlagt', done: !!syklus.pre_hype_sendt_at, href: '/pre-live' },
    { label: 'Stream startet', done: !!syklus.stream_start_at, href: '/live-overvaking' },
    { label: 'VOD oppdaget', done: !!sisteVod, href: '/content-factory-admin' },
    { label: 'Transkribering ferdig', done: !!sisteVod && ['TRANSCRIBED', 'COMPLETE'].includes(sisteVod.status), href: '/content-factory-admin' },
    { label: 'Highlights generert', done: sisteVodHighlights.length > 0, href: '/content-factory-admin/highlights' },
    { label: 'Klipp generert', done: harKlipp, href: '/content-factory-admin/highlights' },
    { label: 'Klar for publisering', done: harKlipp, href: '/innhold/publisering' },
  ];

  // ── Siste resultater – vis de 8 nyeste VODsene uansett status ──────────────
  const visibleVods = vods.slice(0, 8);

  const sisteResultater = visibleVods.map(v => {
    const vH = highlights.filter(h => h.vod_id === v.id);
    return {
      id: v.id,
      title: v.title,
      status: v.status,
      progressPercent: v.progress_percent ?? null,
      statusMessage: v.status_message ?? null,
      errorMessage: v.error_message ?? null,
      createdAt: v.created_at,
      highlights: vH.length,
      klipp: vH.filter(h => h.clip_status === 'CLIPPED').length,
      readyForClip: vH.filter(h => h.clip_status === 'READY_FOR_CLIP').length,
      clipping: vH.filter(h => h.clip_status === 'CLIPPING').length,
    };
  });

  // ── Clip-status for eget panel på dashbordet ──────────────────────────────
  const sisteKlippede = highlights
    .filter(h => h.clip_status === 'CLIPPED' && (h.clip_url_16_9 || h.clip_url_9_16))
    .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
    .slice(0, 5)
    .map(h => {
      const vodTitle = vods.find(v => v.id === h.vod_id)?.title ?? null;
      return {
        id: h.id,
        vodId: h.vod_id,
        title: h.title ?? null,
        vodTitle,
        clip_url_16_9: h.clip_url_16_9 ?? null,
        clip_url_9_16: h.clip_url_9_16 ?? null,
        clippedAt: h.updated_at ?? h.created_at,
      };
    });

  const clipStatus = {
    clipping: clippingNå,
    readyForClip,
    sisteKlippede,
  };

  // ── Live hendelser fra bot ────────────────────────────────────────────────
  const liveEvents: any[] = (workspaceRes.data?.settings_json?.live_events ?? []).slice(0, 30);

  return NextResponse.json({
    nyesteInnsikter: nyesteInnsikter.map(i => ({
      title: i.title,
      summary: i.summary,
      confidenceScore: i.confidence_score,
      createdAt: i.created_at,
    })),
    activeJobs,
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
    sjekkliste,
    sisteResultater,
    clipStatus,
    liveEvents,
    ts: new Date().toISOString(),
  });
}
