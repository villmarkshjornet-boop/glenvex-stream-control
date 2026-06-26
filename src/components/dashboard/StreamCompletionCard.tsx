'use client';

import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { HeroStream } from './types';
import { useI18n } from '@/contexts/I18nContext';

type ChecklistKey = keyof HeroStream['checklist'];

const CHECKLIST_KEYS: { key: ChecklistKey; tKey: string; optional?: boolean }[] = [
  { key: 'streamHistory',  tKey: 'streamCompletion.checklist.streamHistory' },
  { key: 'audienceData',   tKey: 'streamCompletion.checklist.audienceData' },
  { key: 'retentionCurve', tKey: 'streamCompletion.checklist.retentionCurve' },
  { key: 'chatEvents',     tKey: 'streamCompletion.checklist.chatEvents' },
  { key: 'streamCoach',    tKey: 'streamCompletion.checklist.streamCoach' },
  { key: 'vodDetected',    tKey: 'streamCompletion.checklist.vodDetected', optional: true },
  { key: 'aiLearning',     tKey: 'streamCompletion.checklist.aiLearning' },
];

export function StreamCompletionCard({ heroStream, loading }: { heroStream: HeroStream | null | undefined; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  if (!heroStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">{t('streamCompletion.title')}</p>
        <p className="text-sm text-g-muted">{t('streamCompletion.noData')}</p>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full">
      <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">{t('streamCompletion.title')}</p>

      <div className="space-y-2">
        {CHECKLIST_KEYS.map(({ key, tKey, optional }) => {
          const done = heroStream.checklist[key];
          return (
            <div key={key} className="flex items-center gap-2.5">
              {done
                ? <CheckCircle2 size={16} className="text-g-green flex-shrink-0" />
                : optional
                  ? <Clock size={16} className="text-g-muted/50 flex-shrink-0" />
                  : <XCircle size={16} className="text-red-400 flex-shrink-0" />}
              <span className={`text-sm ${done ? 'text-g-text' : optional ? 'text-g-muted/60' : 'text-g-text'}`}>{t(tKey)}</span>
            </div>
          );
        })}
      </div>

      {heroStream.failureReasons.length > 0 && (
        <div className="mt-5 pt-4 border-t border-g-border/40">
          <p className="text-[11px] text-yellow-400 font-bold uppercase tracking-widest mb-2">{t('streamCompletion.missingLabel')}</p>
          <ul className="space-y-1">
            {heroStream.failureReasons.map((r, i) => (
              <li key={i} className="text-xs text-g-muted">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
