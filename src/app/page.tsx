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
import { PartnerProposalQueue } from '@/components/dashboard/PartnerProposalQueue';
import { PartnerEngineStatus } from '@/components/dashboard/PartnerEngineStatus';
import { CreatorBrainLearning } from '@/components/dashboard/CreatorBrainLearning';
import { AiStatusRow } from '@/components/dashboard/AiStatusRow';
import { CollapseSection } from '@/components/ui';
import { LiveCommandCenter } from '@/components/dashboard/LiveCommandCenter';
import { NextStreamBrief } from '@/components/dashboard/NextStreamBrief';
import { StorageHealthCard } from '@/components/dashboard/StorageHealthCard';

export default function Dashboard() {
  const [slow, setSlow]               = useState<SlowData | null>(null);
  const [live, setLive]               = useState<LiveData | null>(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [sistOppdatert, setSistOppdatert] = useState<string | null>(null);
  const [visDebug, setVisDebug]       = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const handleApiResponse = useCallback((res: Response) => {
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  }, []);

  const hentLive = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/live');
      if (handleApiResponse(res)) {
        const d: LiveData = await res.json();
        setLive(d);
        setSistOppdatert(d.ts);
      }
    } catch {}
    setLoadingLive(false);
  }, [handleApiResponse]);

  const hentSlow = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (handleApiResponse(res)) setSlow(await res.json());
    } catch {}
    setLoadingSlow(false);
  }, [handleApiResponse]);

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

  const isLive       = slow?.streamStatus?.isLive ?? false;
  const pendingCount = live?.actionCenter?.filter(i => i.priority === 'action' || i.priority === 'error').length ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
            {isLive ? 'Live Command Center' : 'Creator Command Center'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {sistOppdatert && (
            <p className="text-[10px] text-g-muted/50">Oppdatert {tidSiden(sistOppdatert)}</p>
          )}
          <button
            onClick={hentAlt}
            disabled={refreshing}
            className={`px-3 py-1.5 border rounded-lg text-xs font-bold transition-all ${
              refreshing
                ? 'border-g-green/30 text-g-green cursor-not-allowed'
                : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
            }`}
          >
            {refreshing ? 'Laster...' : 'Oppdater'}
          </button>
        </div>
      </div>

      {/* ── LIVE MODE: Live Command Center ───────────────────────────────────── */}
      {isLive && live && slow ? (
        <LiveCommandCenter live={live} slow={slow} />
      ) : (

        /* ── OFFLINE MODE: eksisterende dashboard ──────────────────────────── */
        <>
          {/* Hero — siste stream */}
          <Hero heroStream={live?.heroStream} loading={loadingLive} />

          {/* Hva gjør jeg nå? — viktigste kort på dashboardet */}
          <NextStreamBrief />

          {/* Action Center */}
          <ActionCenter items={live?.actionCenter} loading={loadingLive} />

          {/* Partner Proposals */}
          <PartnerProposalQueue />

          {/* AI Status Row */}
          <AiStatusRow coverage={live?.coverage} loading={loadingLive} />

          {/* Detaljer */}
          <CollapseSection
            label="Detaljer"
            badge={
              pendingCount > 0
                ? <span className="px-1.5 py-0.5 text-[9px] bg-g-green/10 text-g-green border border-g-green/30 rounded font-bold">{pendingCount}</span>
                : undefined
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <StreamCompletionCard heroStream={live?.heroStream} loading={loadingLive} />
              <AiInsightFeed innsikter={live?.nyesteInnsikter ?? []} lærdom={live?.lærdom} loading={loadingLive} heroIntegrity={live?.heroStream?.dataIntegrity} />
            </div>

            <PartnerEngineStatus />
            <CreatorBrainLearning />
            <RecentStreams streams={live?.recentStreams} loading={loadingLive} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NextStreamCard
                nesteStream={live?.nesteStream ?? slow?.streamStatus?.nesteStream ?? null}
                preHype={live?.preHype ?? null}
                loading={loadingLive && loadingSlow}
              />
              <QuickActions />
            </div>

            <SystemHealth
              live={live}
              loading={loadingLive}
              onResetSyklus={async () => {
                await fetch('/api/stream-syklus/reset', { method: 'POST' });
                hentLive();
              }}
            />
            <StorageHealthCard />

            {live?.debug && (
              <div className="border border-g-border/30 rounded-xl overflow-hidden">
                <button
                  onClick={() => setVisDebug(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left"
                >
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
          </CollapseSection>
        </>
      )}

    </div>
  );
}
