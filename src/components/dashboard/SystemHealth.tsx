'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LiveData } from './types';
import { Kontrollsenter } from './Kontrollsenter';
import { SystemStatus } from './SystemStatus';
import { EventCoverage } from './EventCoverage';
import { JobMonitor } from './JobMonitor';
import { RaidWidget } from './RaidWidget';
import { DetteVetGlenvex } from './DetteVetGlenvex';
import { Sjekkliste } from './Sjekkliste';
import { ActivityFeed } from './ActivityFeed';
import { IntegrationStatus } from './IntegrationStatus';

export function SystemHealth({ live, loading, onResetSyklus }: {
  live: LiveData | null; loading: boolean; onResetSyklus: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-g-border/40 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-g-bg/30 hover:bg-g-bg/50 transition-all text-left">
        <span className="text-xs text-g-muted uppercase tracking-widest font-bold">Systemhelse</span>
        {open ? <ChevronDown size={14} className="text-g-muted" /> : <ChevronRight size={14} className="text-g-muted" />}
      </button>
      {open && (
        <div className="p-5 space-y-4 bg-g-bg/10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Kontrollsenter data={live?.kontrollsenter} loading={loading} />
            <SystemStatus data={live?.coverage} loading={loading} />
          </div>
          <IntegrationStatus />
          <EventCoverage data={live?.coverage} loading={loading} />
          <JobMonitor resultater={live?.sisteResultater ?? []} clipStatus={live?.clipStatus} loading={loading} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DetteVetGlenvex data={live?.lærdom} loading={loading} />
            <Sjekkliste items={live?.sjekkliste ?? []} loading={loading} onReset={onResetSyklus} />
          </div>
          <RaidWidget />
          <ActivityFeed events={live?.systemEvents ?? []} loading={loading} />
        </div>
      )}
    </div>
  );
}
