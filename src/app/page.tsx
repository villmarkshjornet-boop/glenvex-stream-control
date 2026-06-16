'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { SlowData, LiveData } from '@/components/dashboard/types';
import { tidSiden } from '@/components/dashboard/helpers';
import { Hero } from '@/components/dashboard/Hero';
import { NextStreamCard } from '@/components/dashboard/NextStreamCard';
import { Kontrollsenter } from '@/components/dashboard/Kontrollsenter';
import { RecentStreams } from '@/components/dashboard/RecentStreams';
import { JobMonitor } from '@/components/dashboard/JobMonitor';
import { EventCoverage } from '@/components/dashboard/EventCoverage';
import { DetteVetGlenvex } from '@/components/dashboard/DetteVetGlenvex';
import { AiProducerWidget } from '@/components/dashboard/AiProducerWidget';
import { RecentAiLearning } from '@/components/dashboard/RecentAiLearning';
import { Sjekkliste } from '@/components/dashboard/Sjekkliste';
import { RaidWidget } from '@/components/dashboard/RaidWidget';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { NeedsAttention } from '@/components/dashboard/NeedsAttention';
import { UpcomingActions } from '@/components/dashboard/UpcomingActions';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { QuickActions } from '@/components/dashboard/QuickActions';

export default function Dashboard() {
  const [slow, setSlow]               = useState<SlowData | null>(null);
  const [live, setLive]               = useState<LiveData | null>(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [sistOppdatert, setSistOppdatert] = useState<string | null>(null);
  const [visDebug, setVisDebug]       = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const hentLive = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/live');
      if (res.ok) {
        const d: LiveData = await res.json();
        setLive(d);
        setSistOppdatert(d.ts);
      }
    } catch {}
    setLoadingLive(false);
  }, []);

  const hentSlow = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) setSlow(await res.json());
    } catch {}
    setLoadingSlow(false);
  }, []);

  const hentAlt = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([hentLive(), hentSlow()]);
    setRefreshing(false);
  }, [hentLive, hentSlow]);

  useEffect(() => {
    hentLive();
    hentSlow();
    const liveId = setInterval(hentLive, 5_000);
    const slowId = setInterval(hentSlow, 60_000);
    return () => { clearInterval(liveId); clearInterval(slowId); };
  }, [hentLive, hentSlow]);

  const isLive = slow?.streamStatus?.isLive ?? false;

  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Creator Operations Center</h1>
          <p className="text-[9px] text-g-muted mt-0.5">Creator OS · Ingenting skjer uten at systemet vet om det</p>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[9px] font-black text-red-400">LIVE · {slow?.streamStatus?.viewers ?? 0} seere</span>
            </span>
          )}
          {sistOppdatert && (
            <p className="text-[9px] text-g-muted/50">Live · {tidSiden(sistOppdatert)}</p>
          )}
          <button onClick={hentAlt} disabled={refreshing}
            className={`px-2.5 py-1.5 border rounded text-[9px] transition-all ${
              refreshing
                ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
            }`}>
            {refreshing ? '↻ Laster...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── HERO: Siste stream ───────────────────────────────────────────────── */}
      <Hero heroStream={live?.heroStream} loading={loadingLive} />

      {/* ── NESTE STREAM ─────────────────────────────────────────────────────── */}
      <NextStreamCard
        nesteStream={live?.nesteStream ?? slow?.streamStatus?.nesteStream ?? null}
        preHype={live?.preHype ?? null}
        loading={loadingLive && loadingSlow}
      />

      {/* ── KONTROLLSENTER ──────────────────────────────────────────────────── */}
      <Kontrollsenter data={live?.kontrollsenter} loading={loadingLive} />

      {/* ── Hovedinnhold: venstre (drift) + høyre (feed/varsler) ─────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <RecentStreams streams={live?.recentStreams} loading={loadingLive} />
          <JobMonitor
            resultater={live?.sisteResultater ?? []}
            clipStatus={live?.clipStatus}
            loading={loadingLive}
          />
          <EventCoverage data={live?.coverage} loading={loadingLive} />
          <DetteVetGlenvex data={live?.lærdom} loading={loadingLive} />
          <div className="grid grid-cols-2 gap-4">
            <AiProducerWidget innsikter={live?.nyesteInnsikter ?? []} aiLearning={live?.aiLearning} loading={loadingLive} />
            <Sjekkliste items={live?.sjekkliste ?? []} loading={loadingLive} onReset={async () => {
              await fetch('/api/stream-syklus/reset', { method: 'POST' });
              hentLive();
            }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <RaidWidget />
            <RecentAiLearning innsikter={live?.nyesteInnsikter ?? []} aiLearning={live?.aiLearning} loading={loadingLive} />
          </div>
        </div>

        <div className="col-span-1 space-y-4">
          <ActivityFeed events={live?.systemEvents ?? []} loading={loadingLive} />
          <NeedsAttention items={live?.needsAttention} loading={loadingLive} />
          <UpcomingActions items={live?.upcomingActions} loading={loadingLive} />
        </div>
      </div>

      {/* ── SYSTEMSTATUS ─────────────────────────────────────────────────────── */}
      <SystemStatus data={live?.coverage} loading={loadingLive} />

      {/* ── HURTIGHANDLINGER ─────────────────────────────────────────────────── */}
      <QuickActions />

      {/* ── Siste klipp (kompakt) ────────────────────────────────────────────── */}
      {live?.clipStatus?.sisteKlippede && live.clipStatus.sisteKlippede.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste klipp</p>
            <Link href="/content-factory-admin/highlights" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Alle →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {live.clipStatus.sisteKlippede.slice(0, 4).map(h => (
              <div key={h.id} className="flex items-center gap-2 p-2 bg-g-bg/40 border border-g-border/30 rounded-lg">
                <span className="text-g-green text-[10px] flex-shrink-0">🎬</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-g-text truncate">
                    {h.title ?? h.vodTitle?.slice(0, 30) ?? `#${h.id.slice(0, 6)}`}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {h.clip_url_16_9 && (
                    <a href={h.clip_url_16_9} target="_blank" rel="noreferrer"
                      className="px-1.5 py-0.5 bg-g-green/10 border border-g-green/20 rounded text-[8px] text-g-green font-bold hover:bg-g-green/20">16:9</a>
                  )}
                  {h.clip_url_9_16 && (
                    <a href={h.clip_url_9_16} target="_blank" rel="noreferrer"
                      className="px-1.5 py-0.5 bg-g-green/10 border border-g-green/20 rounded text-[8px] text-g-green font-bold hover:bg-g-green/20">9:16</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Debug panel ──────────────────────────────────────────────────────── */}
      {live?.debug && (
        <div className="border border-g-border/30 rounded-lg overflow-hidden">
          <button onClick={() => setVisDebug(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left">
            <span className="text-[9px] text-g-muted/60 uppercase tracking-widest font-bold">Debug</span>
            <span className="text-[9px] text-g-muted/40">{visDebug ? '▲ Skjul' : '▼ Vis'}</span>
          </button>
          {visDebug && (
            <div className="px-4 py-3 bg-g-bg/20 grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(live.debug).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <span className="text-[9px] text-g-muted/50 font-mono w-32 flex-shrink-0">{k}</span>
                  <span className="text-[9px] text-g-text font-mono truncate">{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Hurtiglenker ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Hurtiglenker</p>
        <div className="grid grid-cols-6 gap-2">
          {[
            { href: '/stream-briefing',            icon: '◆', label: 'Stream Briefing' },
            { href: '/ai-producer',                icon: '◈', label: 'AI Producer' },
            { href: '/content-factory-admin',      icon: '▶', label: 'Content Factory' },
            { href: '/content-factory-admin/highlights', icon: '✂', label: 'Highlights' },
            { href: '/discord',                    icon: '◉', label: 'Discord' },
            { href: '/ai-memory',                  icon: '⬡', label: 'AI Memory' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="bg-g-card border border-g-border rounded-lg p-2.5 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group text-center">
              <p className="text-g-green text-sm">{l.icon}</p>
              <p className="text-[9px] text-g-muted group-hover:text-g-text transition-colors mt-1 leading-tight">{l.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
