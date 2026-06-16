'use client';

import Link from 'next/link';
import type { LiveData } from './types';

export function Sjekkliste({ items, loading, onReset }: { items: LiveData['sjekkliste']; loading: boolean; onReset: () => void }) {
  if (loading) return <div className="h-52 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!items.length) return null;
  const ferdig = items.filter(i => i.done).length;
  const pct    = Math.round((ferdig / items.length) * 100);
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Stream-syklus</p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-mono font-black text-g-green">{ferdig}/{items.length}</p>
          {ferdig > 0 && (
            <button onClick={onReset}
              className="text-[9px] text-g-muted/50 hover:text-g-muted transition-colors px-1.5 py-0.5 border border-g-border/30 rounded"
              title="Nullstill stream-syklus">
              ↺ Reset
            </button>
          )}
        </div>
      </div>
      <div className="mb-3 h-1 bg-g-border rounded-full overflow-hidden">
        <div className="h-full bg-g-green rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <Link key={i} href={item.href}
            className={`flex items-center gap-2.5 py-1 px-1 rounded hover:bg-white/[0.02] transition-all group ${item.done ? '' : 'opacity-60'}`}>
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[9px] font-black ${
              item.done ? 'border-g-green bg-g-green/10 text-g-green' : 'border-g-border/40 text-transparent'
            }`}>✓</span>
            <span className={`text-[10px] ${item.done ? 'text-g-text' : 'text-g-muted'} group-hover:text-g-text transition-colors`}>
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
