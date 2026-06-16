'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { RecentStream } from './types';

const GRADE_COLOR: Record<RecentStream['grade'], string> = {
  S: 'text-purple-400 border-purple-500/30',
  A: 'text-g-green border-g-green/30',
  B: 'text-blue-400 border-blue-500/30',
  C: 'text-yellow-400 border-yellow-500/30',
  D: 'text-red-400 border-red-500/30',
};

export function RecentStreams({ streams, loading }: { streams: RecentStream[] | undefined; loading: boolean }) {
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Siste streams</p>
        <Link href="/stream-coach" className="text-xs text-g-muted hover:text-g-green transition-colors">Stream Coach →</Link>
      </div>
      {!streams || streams.length === 0 ? (
        <p className="text-sm text-g-muted">Ingen avsluttede streams registrert ennå.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {streams.map(s => (
            <Link key={s.streamId} href={`/stream-coach?streamId=${encodeURIComponent(s.streamId)}`}
              className="border border-g-border/40 rounded-xl p-3 hover:border-g-border hover:bg-g-bg/40 transition-all">
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 text-sm font-black mb-2 ${GRADE_COLOR[s.grade]}`}>
                {s.grade}
              </div>
              <p className="text-sm font-black text-g-text">{s.streamScore}</p>
              <p className="text-xs text-g-text truncate mt-1">{s.title || s.game}</p>
              <p className="text-[11px] text-g-muted truncate">{s.game}</p>
              <p className="text-[11px] text-g-muted mt-1">{tidSiden(s.endedAt)}</p>
              <p className="text-[11px] text-g-muted">Peak {s.peakViewers} · {s.retentionPct}% retention</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
