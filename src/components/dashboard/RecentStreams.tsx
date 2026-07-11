'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { RecentStream } from './types';
import { useI18n } from '@/contexts/I18nContext';

const GRADE_COLOR: Record<string, string> = {
  S: '#a78bfa',
  A: '#34d399',
  B: '#60a5fa',
  C: '#fbbf24',
  D: '#f87171',
};

const GRADE_BG: Record<string, string> = {
  S: 'bg-violet-500/10 border-violet-500/30',
  A: 'bg-emerald-500/10 border-emerald-500/30',
  B: 'bg-blue-500/10 border-blue-500/30',
  C: 'bg-amber-500/10 border-amber-500/30',
  D: 'bg-red-500/10 border-red-500/30',
};

export function RecentStreams({ streams, loading }: { streams: RecentStream[] | undefined; loading: boolean }) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="bg-[#0c1115] border border-emerald-500/15 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.22)] p-6 h-40 animate-pulse" />
    );
  }

  return (
    <div className="bg-[#0c1115] border border-emerald-500/15 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.22)] p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">
          {t('recentStreams.title')}
        </p>
        <Link
          href="/stream-coach"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {t('recentStreams.streamCoach')}
        </Link>
      </div>

      {!streams || streams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500 text-lg">📺</div>
          <p className="text-sm font-medium text-zinc-400">Ingen streams ennå</p>
          <p className="text-xs text-zinc-600">Dine siste streams vises her etter første stream.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {streams.map(s => (
            <Link
              key={s.streamId}
              href={`/stream-coach?streamId=${encodeURIComponent(s.streamId)}`}
              className={
                s.broken
                  ? 'border border-red-900/50 bg-red-950/20 rounded-xl p-3.5 hover:border-red-800/60 transition-all'
                  : 'bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 hover:border-zinc-700 hover:bg-zinc-900 transition-all'
              }
            >
              {s.broken ? (
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-red-500/30 bg-red-500/10 text-base mb-2">
                  ⚠️
                </div>
              ) : (
                <div
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-full border text-sm font-black mb-2 ${GRADE_BG[s.grade] ?? ''}`}
                  style={{ color: GRADE_COLOR[s.grade], borderWidth: '1.5px' }}
                >
                  {s.grade}
                </div>
              )}

              {s.broken ? (
                <p className="text-red-400/70 text-xs font-medium">{t('recentStreams.technicalError')}</p>
              ) : (
                <p
                  className="text-xl font-bold"
                  style={{ color: GRADE_COLOR[s.grade] }}
                >
                  {s.streamScore}
                </p>
              )}

              <p className="text-sm font-medium text-zinc-100 line-clamp-1 mt-1.5">
                {s.title || s.game}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.game}</p>
              <p className="text-[11px] text-zinc-500 mt-1">{tidSiden(s.endedAt)}</p>
              {!s.broken && (
                <p className="text-[11px] text-zinc-500">
                  {t('recentStreams.peakRetention', { peak: String(s.peakViewers), pct: String(s.retentionPct) })}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
