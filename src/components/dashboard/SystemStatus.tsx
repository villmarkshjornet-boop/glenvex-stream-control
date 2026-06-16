'use client';

import { tidSiden } from './helpers';
import type { CoverageEntry } from './types';

const STATUS_LABEL: Record<string, string> = {
  active:  'Aktiv',
  stale:   'Forsinket',
  offline: 'Offline',
  passive: 'Passiv',
};
const STATUS_COLOR: Record<string, string> = {
  active:  'text-g-green border-g-green/30 bg-g-green/5',
  stale:   'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  offline: 'text-red-400 border-red-500/30 bg-red-500/5',
  passive: 'text-g-muted border-g-border bg-transparent',
};
const STATUS_DOT: Record<string, string> = {
  active:  'bg-g-green',
  stale:   'bg-yellow-400',
  offline: 'bg-red-400 animate-pulse',
  passive: 'bg-g-muted/40',
};

export function SystemStatus({ data, loading }: { data: CoverageEntry[] | undefined; loading: boolean }) {
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!data?.length) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Systemstatus</p>
      <div className="grid grid-cols-3 gap-2">
        {data.map(c => (
          <div key={c.key} className={`border rounded-lg p-2.5 ${STATUS_COLOR[c.status]}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[c.status]}`} />
              <p className="text-[10px] font-bold truncate flex-1">{c.label}</p>
              <span className="text-[8px] font-bold uppercase">{STATUS_LABEL[c.status]}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <p className="text-[8px] text-g-muted/60">Sist sett</p>
              <p className="text-[9px] text-g-text font-mono text-right">{c.lastSeen ? tidSiden(c.lastSeen) : '—'}</p>
              <p className="text-[8px] text-g-muted/60">Feil 24t</p>
              <p className={`text-[9px] font-mono text-right ${c.errors24h > 0 ? 'text-red-400 font-bold' : 'text-g-text'}`}>{c.errors24h}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
