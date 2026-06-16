'use client';

import Link from 'next/link';
import type { UpcomingAction } from './types';

export function UpcomingActions({ items, loading }: { items: UpcomingAction[] | undefined; loading: boolean }) {
  if (loading) return <div className="h-32 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Kommende handlinger</p>
      {!items || items.length === 0 ? (
        <p className="text-[10px] text-g-muted">Ingen kommende handlinger planlagt.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <Link key={i} href={item.href}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-g-border/30 hover:border-g-border hover:bg-white/[0.02] transition-all">
              <span className="text-[10px] text-g-text">{item.label}</span>
              <span className="text-[9px] font-mono font-bold text-g-green flex-shrink-0">{item.eta}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
