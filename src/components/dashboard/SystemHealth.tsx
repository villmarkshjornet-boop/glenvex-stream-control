'use client';

import { useState } from 'react';
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
import { useI18n } from '@/contexts/I18nContext';

export function SystemHealth({ live, loading, onResetSyklus }: {
  live: LiveData | null; loading: boolean; onResetSyklus: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Derive compact status items from live data
  const integrations = live?.kontrollsenter ?? [];
  const hasErrors = integrations.some(k => k.status === 'feil');
  const activeCount = integrations.filter(k => k.status === 'ok').length;

  return (
    <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-g-bg/30 transition-all text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasErrors ? 'bg-red-500' : 'bg-g-green'}`} />
          <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted">
            {t('systemHealth.title')}
          </h3>
        </div>
        <span className="text-[11px] text-g-muted/40">{open ? '▲' : '▼'}</span>
      </button>

      {!open && (
        <div className="px-4 pb-4 space-y-2">
          {loading ? (
            <>
              <div className="h-3 bg-g-border rounded w-full animate-pulse" />
              <div className="h-3 bg-g-border rounded w-4/5 animate-pulse" />
              <div className="h-3 bg-g-border rounded w-3/5 animate-pulse" />
            </>
          ) : integrations.length > 0 ? (
            integrations.slice(0, 5).map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-xs text-g-muted truncate">{item.label}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    item.status === 'ok' ? 'bg-g-green' :
                    item.status === 'feil' ? 'bg-red-500' : 'bg-g-muted/30'
                  }`} />
                  <span className={`text-xs ${
                    item.status === 'ok' ? 'text-g-text' :
                    item.status === 'feil' ? 'text-red-400' : 'text-g-muted/50'
                  }`}>
                    {item.status === 'ok' ? 'OK' : item.status === 'feil' ? 'Feil' : '—'}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-g-muted/40">{activeCount > 0 ? `${activeCount} systemer OK` : 'Ingen data'}</p>
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-g-border/40 p-4 space-y-4 bg-g-bg/10">
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
