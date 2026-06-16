'use client';

import { useEffect, useState, useCallback } from 'react';
import type { SlowData, LiveData } from '@/components/dashboard/types';
import { tidSiden } from '@/components/dashboard/helpers';
import { Hero } from '@/components/dashboard/Hero';
import { StreamCompletionCard } from '@/components/dashboard/StreamCompletionCard';
import { AiInsightFeed } from '@/components/dashboard/AiInsightFeed';
import { ActionCenter } from '@/components/dashboard/ActionCenter';
import { RecentStreams } from '@/components/dashboard/RecentStreams';
import { NextStreamCard } from '@/components/dashboard/NextStreamCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { SystemHealth } from '@/components/dashboard/SystemHealth';

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
    <div className="max-w-6xl mx-auto space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-g-text">Creator Operations Center</h1>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-xs font-black text-red-400">LIVE · {slow?.streamStatus?.viewers ?? 0} seere</span>
            </span>
          )}
          {sistOppdatert && (
            <p className="text-xs text-g-muted/50">Oppdatert {tidSiden(sistOppdatert)}</p>
          )}
          <button onClick={hentAlt} disabled={refreshing}
            className={`px-3 py-1.5 border rounded-lg text-xs transition-all ${
              refreshing
                ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
            }`}>
            {refreshing ? 'Laster...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── HERO: Siste stream ───────────────────────────────────────────────── */}
      <Hero heroStream={live?.heroStream} loading={loadingLive} />

      {/* ── Stream Completion + AI Insight Feed ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StreamCompletionCard heroStream={live?.heroStream} loading={loadingLive} />
        <AiInsightFeed innsikter={live?.nyesteInnsikter ?? []} lærdom={live?.lærdom} loading={loadingLive} />
      </div>

      {/* ── ACTION CENTER ────────────────────────────────────────────────────── */}
      <ActionCenter items={live?.actionCenter} loading={loadingLive} />

      {/* ── RECENT STREAMS ───────────────────────────────────────────────────── */}
      <RecentStreams streams={live?.recentStreams} loading={loadingLive} />

      {/* ── Neste stream + Hurtighandlinger ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NextStreamCard
          nesteStream={live?.nesteStream ?? slow?.streamStatus?.nesteStream ?? null}
          preHype={live?.preHype ?? null}
          loading={loadingLive && loadingSlow}
        />
        <QuickActions />
      </div>

      {/* ── SYSTEMHELSE (kollapset) ──────────────────────────────────────────── */}
      <SystemHealth
        live={live}
        loading={loadingLive}
        onResetSyklus={async () => {
          await fetch('/api/stream-syklus/reset', { method: 'POST' });
          hentLive();
        }}
      />

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
    </div>
  );
}
