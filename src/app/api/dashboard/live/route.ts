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

  // ── Parallelle Supabase-kall ──────────────────────────────────────────────
  const [vodsRes, highlightsRes, workspaceRes] = await Promise.all([
    db.from('content_vods')
      .select('id,title,status,created_at,current_step,progress_percent,status_message,error_message')
      .eq('workspace_id', getWorkspaceId())
      .order('created_at', { ascending: false })
      .limit(20),

    db.from('content_highlights')
      .select('id,vod_id,clip_status,created_at')
      .in('clip_status', ['READY_FOR_CLIP', 'CLIPPING', 'CLIPPED'])
      .order('created_at', { ascending: false })
      .limit(100),

    db.from('workspaces')
      .select('settings_json')
      .eq('id', getWorkspaceId())
      .single(),
  ]);

  const vods: any[] = vodsRes.data ?? [];
  const highlights: any[] = highlightsRes.data ?? [];
  const streamplan: any[] = workspaceRes.data?.settings_json?.streamplan ?? [];

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
  const sisteVodHighlights = sisteVod ? highlights.filter(h => h.vod_id === sisteVod.id) : [];
  const harKlipp = sisteVodHighlights.some(h => h.clip_status === 'CLIPPED');

  const sjekkliste = [
    { label: 'Streamplan lagret', done: aktiveStreamdager.length > 0, href: '/streamplan' },
    { label: 'Discord varslet', done: false, href: '/discord' },
    { label: 'Pre-Hype planlagt', done: false, href: '/pre-live' },
    { label: 'Stream startet', done: false, href: '/live-overvaking' },
    { label: 'VOD oppdaget', done: !!sisteVod, href: '/content-factory-admin' },
    { label: 'Transkribering ferdig', done: !!sisteVod && ['TRANSCRIBED', 'COMPLETE'].includes(sisteVod.status), href: '/content-factory-admin' },
    { label: 'Highlights generert', done: sisteVodHighlights.length > 0, href: '/content-factory-admin/highlights' },
    { label: 'Klipp generert', done: harKlipp, href: '/content-factory-admin/highlights' },
    { label: 'Klar for publisering', done: harKlipp, href: '/innhold/publisering' },
  ];

  // ── Siste resultater ──────────────────────────────────────────────────────
  const ferdigeVods = vods.filter(v => v.status === 'COMPLETE').slice(0, 5);
  const sisteResultater = ferdigeVods.map(v => {
    const vH = highlights.filter(h => h.vod_id === v.id);
    return {
      id: v.id,
      title: v.title,
      createdAt: v.created_at,
      highlights: vH.length,
      klipp: vH.filter(h => h.clip_status === 'CLIPPED').length,
    };
  });

  return NextResponse.json({
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
    ts: new Date().toISOString(),
  });
}
