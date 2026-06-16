'use client';

import { tidSiden } from './helpers';
import type { LiveData } from './types';

const COVERAGE_STATUS_BAR: Record<string, string> = {
  active:  'bg-g-green',
  stale:   'bg-yellow-400/60',
  offline: 'bg-g-muted/25',
  passive: 'bg-g-muted/15',
};

export function EventCoverage({ data, loading }: { data: LiveData['coverage']; loading: boolean }) {
  if (loading || !data?.length) return null;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Systemdekning</p>
        <p className="text-[9px] text-g-muted/50">events siste 24t</p>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        {data.map(c => (
          <div key={c.key} className="space-y-1">
            <div className={`h-1 rounded-full ${COVERAGE_STATUS_BAR[c.status]}`} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-g-text truncate">{c.label}</p>
              <span className="text-[9px] text-g-muted/60 font-mono">{c.count24h}</span>
            </div>
            <p className={`text-[9px] ${c.status === 'active' ? 'text-g-green/60' : 'text-g-muted/40'}`}>
              {c.lastSeen ? tidSiden(c.lastSeen) : c.passive ? 'ingen feil loggett' : 'ikke startet ennå'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
