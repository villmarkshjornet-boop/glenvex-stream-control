'use client';

import { tidSiden } from './helpers';
import type { LiveData } from './types';

const STATUS_FARGE: Record<string, string> = {
  ok:              'text-g-green border-g-green/30 bg-g-green/5',
  feil:            'text-red-400 border-red-500/30 bg-red-500/5',
  ingen_aktivitet: 'text-g-muted border-g-border bg-transparent',
};

const STATUS_DOT: Record<string, string> = {
  ok:              'bg-g-green',
  feil:            'bg-red-400',
  ingen_aktivitet: 'bg-g-muted/40',
};

export function Kontrollsenter({ data, loading }: {
  data: LiveData['kontrollsenter'];
  loading: boolean;
}) {
  if (loading || !data) return null;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Kontrollsenter</p>
        <p className="text-[9px] text-g-muted/50">siste 24t</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {data.map(sub => (
          <div key={sub.key}
            className={`border rounded-lg px-2.5 py-2 ${STATUS_FARGE[sub.status]}`}
            title={sub.sisteTitle ?? sub.sisteEvent ?? 'Ingen aktivitet siste 24t'}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[sub.status]}`} />
              <p className="text-[9px] font-bold truncate">{sub.label}</p>
            </div>
            <p className="text-[9px] text-g-muted truncate">
              {sub.antall24h > 0 ? `${sub.antall24h} events` : 'Ingen aktivitet siste 24t'}
            </p>
            {sub.sisteKjøring && (
              <p className="text-[8px] text-g-muted/50 mt-0.5 truncate">
                {tidSiden(sub.sisteKjøring)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
