'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { RecentStream } from './types';
import { useI18n } from '@/contexts/I18nContext';

const GRADE_COLOR: Record<RecentStream['grade'], string> = {
  S: 'text-purple-400 border-purple-500/30',
  A: 'text-g-green border-g-green/30',
  B: 'text-blue-400 border-blue-500/30',
  C: 'text-yellow-400 border-yellow-500/30',
  D: 'text-red-400 border-red-500/30',
};

export function RecentStreams({ streams, loading }: { streams: RecentStream[] | undefined; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">{t('recentStreams.title')}</p>
        <Link href="/stream-coach" className="text-xs text-g-muted hover:text-g-green transition-colors">{t('recentStreams.streamCoach')}</Link>
      </div>
      {!streams || streams.length === 0 ? (
        <p className="text-sm text-g-muted">{t('recentStreams.noStreams')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {streams.map(s => (
            <Link key={s.streamId} href={`/stream-coach?streamId=${encodeURIComponent(s.streamId)}`}
              className="border border-g-border/40 rounded-xl p-3 hover:border-g-border hover:bg-g-bg/40 transition-all">
              {s.broken ? (
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full border-2 border-red-500/20 text-base mb-2">
                  ⚠
                </div>
              ) : (
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 text-sm font-black mb-2 ${GRADE_COLOR[s.grade]}`}>
                  {s.grade}
                </div>
              )}
              {s.broken ? (
                <p className="text-xs text-red-400/50 font-bold">{t('recentStreams.technicalError')}</p>
              ) : (
                <p className="text-sm font-black text-g-text">{s.streamScore}</p>
              )}
              <p className="text-xs text-g-text truncate mt-1">{s.title || s.game}</p>
              <p className="text-[11px] text-g-muted truncate">{s.game}</p>
              <p className="text-[11px] text-g-muted mt-1">{tidSiden(s.endedAt)}</p>
              {!s.broken && (
                <p className="text-[11px] text-g-muted">{t('recentStreams.peakRetention', { peak: String(s.peakViewers), pct: String(s.retentionPct) })}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
