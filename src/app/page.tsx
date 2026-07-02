'use client';

import { useEffect, useState, useCallback } from 'react';
import type { SlowData, LiveData } from '@/components/dashboard/types';
import { tidSiden } from '@/components/dashboard/helpers';
import { Hero } from '@/components/dashboard/Hero';
import { StreamCompletionCard } from '@/components/dashboard/StreamCompletionCard';
import { AiInsightFeed } from '@/components/dashboard/AiInsightFeed';
import { ActionCenter } from '@/components/dashboard/ActionCenter';
import { RecentStreams } from '@/components/dashboard/RecentStreams';
import { SystemHealth } from '@/components/dashboard/SystemHealth';
import { PartnerEngineStatus } from '@/components/dashboard/PartnerEngineStatus';
import { CreatorBrainLearning } from '@/components/dashboard/CreatorBrainLearning';
import { AiStatusRow } from '@/components/dashboard/AiStatusRow';
import { LiveCommandCenter } from '@/components/dashboard/LiveCommandCenter';
import { NextStreamBrief } from '@/components/dashboard/NextStreamBrief';
import { StorageHealthCard } from '@/components/dashboard/StorageHealthCard';
import { WhatToDoNow } from '@/components/dashboard/WhatToDoNow';
import { CommunitySnapshot } from '@/components/dashboard/CommunitySnapshot';

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

  const isLive = slow?.streamStatus?.isLive ?? false;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold gradient-text">
          {isLive ? 'Live Command Center' : 'Creator Command Center'}
        </h1>
        <div className="flex items-center gap-3">
          {sistOppdatert && (
            <p className="text-xs text-g-muted/50">Oppdatert {tidSiden(sistOppdatert)}</p>
          )}
          <button
            onClick={hentAlt}
            disabled={refreshing}
            className={`text-xs transition-colors duration-150 ${
              refreshing
                ? 'text-g-muted/50 cursor-not-allowed'
                : 'text-g-muted/50 hover:text-g-muted'
            }`}
          >
            {refreshing ? 'Laster...' : 'Oppdater'}
          </button>
        </div>
      </div>

      {/* ── LIVE MODE ──────────────────────────────────────────────────────── */}
      {isLive && live && slow ? (
        <LiveCommandCenter live={live} slow={slow} />
      ) : (

        /* ── OFFLINE MODE: new story-driven layout ─────────────────────────── */
        <>
          {/* HERO: Dominant last-stream status */}
          <Hero heroStream={live?.heroStream} loading={loadingLive} />

          {/* ACTION CENTER: Only shown when there are items */}
          {(live?.actionCenter?.length ?? 0) > 0 && (
            <ActionCenter items={live?.actionCenter} loading={loadingLive} />
          )}

          {/* TWO-COL: Next stream brief + Recent streams */}
          <div className="grid grid-cols-2 gap-6">
            <NextStreamBrief />
            <RecentStreams streams={live?.recentStreams} loading={loadingLive} />
          </div>

          {/* STREAM COMPLETION: only when relevant */}
          {live?.heroStream && (
            <StreamCompletionCard heroStream={live.heroStream} loading={loadingLive} />
          )}

          {/* AI INSIGHTS */}
          <AiInsightFeed
            innsikter={live?.nyesteInnsikter ?? []}
            lærdom={live?.lærdom}
            loading={loadingLive}
            heroIntegrity={live?.heroStream?.dataIntegrity}
          />

          {/* THREE-COL HEALTH ROW */}
          <div className="grid grid-cols-3 gap-4">
            <SystemHealth
              live={live}
              loading={loadingLive}
              onResetSyklus={async () => {
                await fetch('/api/stream-syklus/reset', { method: 'POST' });
                hentLive();
              }}
            />
            <AiStatusRow coverage={live?.coverage} loading={loadingLive} />
            <StorageHealthCard />
          </div>

          {/* SECONDARY: Partner + Learning */}
          <div className="grid grid-cols-2 gap-4">
            <PartnerEngineStatus />
            <CreatorBrainLearning />
          </div>

          {/* WHAT TO DO NOW */}
          <WhatToDoNow slow={slow} live={live} />

          {/* COMMUNITY SNAPSHOT */}
          <CommunitySnapshot />

          {/* DEBUG PANEL */}
          {live?.debug && (
            <div className="border border-g-border/30 rounded-xl overflow-hidden">
              <button
                onClick={() => setVisDebug(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left"
              >
                <span className="text-[11px] text-g-muted/60 uppercase tracking-widest font-bold">Debug</span>
                <span className="text-[11px] text-g-muted/40">{visDebug ? '▲ Skjul' : '▼ Vis'}</span>
              </button>
              {visDebug && (
                <div className="px-4 py-3 bg-g-bg/20 grid grid-cols-2 gap-x-6 gap-y-1">
                  {Object.entries(live.debug).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="text-[11px] text-g-muted/50 font-mono w-32 flex-shrink-0">{k}</span>
                      <span className="text-[11px] text-g-text font-mono truncate">{String(v ?? '—')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
}
