'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { RecentStream } from './types';

function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}t ${m}m` : `${m}m`;
}

export function RecentStreams({ streams, loading }: { streams: RecentStream[] | undefined; loading: boolean }) {
  if (loading) return <div className="h-48 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste streams</p>
        <Link href="/stream-coach" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Stream Coach →</Link>
      </div>
      {!streams || streams.length === 0 ? (
        <p className="text-[10px] text-g-muted">Ingen avsluttede streams registrert ennå.</p>
      ) : (
        <div className="space-y-1">
          {streams.map(s => (
            <Link key={s.streamId} href={`/stream-coach?streamId=${encodeURIComponent(s.streamId)}`}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.02] transition-all border border-transparent hover:border-g-border/30">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-g-text truncate">{s.title || s.game}</p>
                <p className="text-[9px] text-g-muted">{s.game} · {formatDuration(s.durationMinutes)} · {tidSiden(s.endedAt)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[9px] font-mono text-g-muted">peak {s.peakViewers}</span>
                <span className="text-g-muted/40 text-[10px]">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
