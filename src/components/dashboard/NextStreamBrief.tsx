'use client';

import { useEffect, useState } from 'react';
import type { BriefAction, NextStreamBriefData } from '@/app/api/next-stream-brief/route';
import { useI18n } from '@/contexts/I18nContext';

const STAR_COLOR: Record<1 | 2 | 3, string> = {
  3: 'text-g-green',
  2: 'text-amber-400',
  1: 'text-g-muted/40',
};

const CONFIDENCE_DOT: Record<BriefAction['confidence'], string> = {
  høy:     'bg-g-green',
  middels: 'bg-amber-400/70',
  lav:     'bg-g-muted/30',
};

export function NextStreamBrief() {
  const { t } = useI18n();
  const [data, setData] = useState<NextStreamBriefData | null>(null);

  useEffect(() => {
    fetch('/api/next-stream-brief')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const avgMin = data.avgStreamDurationMin;
  const durationLabel = avgMin
    ? `${Math.floor(avgMin / 60)}t${avgMin % 60 > 0 ? ` ${avgMin % 60}m` : ''} ${t('nextBrief.basedOn', { count: '' }).replace('  ', '').trim()}`
    : null;

  // New user — show onboarding starter plan
  if (data.isOnboarding) {
    const STEPS = [1, 2, 3, 4, 5, 6] as const;

    return (
      <section className="bg-g-card border border-g-green/10 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-base font-black text-g-text">{t('nextBrief.title')}</p>
            <p className="text-xs text-amber-400/70 mt-0.5">{t('nextBrief.onboardingNote')}</p>
          </div>
          <span className="text-[10px] text-g-green/40 uppercase tracking-widest font-bold mt-0.5">
            {t('nextBrief.aiProducer')}
          </span>
        </div>

        <ol className="space-y-3">
          {STEPS.map(n => (
            <li key={n} className="flex gap-3 items-start">
              <span className="text-[11px] font-black text-g-muted/25 w-4 flex-shrink-0 mt-0.5 text-right select-none">
                {n}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-g-text/80 leading-tight">{t(`nextBrief.onboarding.${n}_action`)}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-g-muted/50">{t(`nextBrief.onboarding.${n}_timing`)}</span>
                  <span className="text-g-muted/20">·</span>
                  <span className="text-[10px] text-g-muted/40">{t(`nextBrief.onboarding.${n}_note`)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-[10px] text-g-muted/30 mt-4 pt-3 border-t border-g-border/20">
          {t('nextBrief.afterFirstStream')}
        </p>
      </section>
    );
  }

  return (
    <section className="bg-g-card border border-g-green/15 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-base font-black text-g-text">{t('nextBrief.title')}</p>
          <p className="text-xs text-g-muted/50 mt-0.5">
            {t('nextBrief.forNextStream')}
            {data.basedOnStreams >= 2 && (
              <span className="ml-1">· {t('nextBrief.basedOn', { count: data.basedOnStreams })}</span>
            )}
            {durationLabel && (
              <span className="ml-1">· {durationLabel}</span>
            )}
          </p>
        </div>
        <span className="text-[10px] text-g-green/50 uppercase tracking-widest font-bold mt-0.5">
          {t('nextBrief.aiProducer')}
        </span>
      </div>

      <ol className="space-y-4">
        {data.actions.map((a, i) => (
          <li key={a.id} className="flex gap-3 items-start">
            <span className="text-[11px] font-black text-g-muted/25 w-4 flex-shrink-0 mt-0.5 text-right select-none">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-bold text-g-text leading-tight">{a.action}</span>
                {a.expectedEffect && (
                  <span className="text-xs text-g-green font-semibold">{a.expectedEffect}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                <span className={`text-[10px] font-black tracking-tight ${STAR_COLOR[a.stars]}`}>
                  {'★'.repeat(a.stars)}{'☆'.repeat(3 - a.stars)}
                </span>
                <span className="text-[11px] text-g-muted/70 font-medium">{a.timing}</span>
                <span className="text-g-muted/20">·</span>
                <span className="text-[10px] text-g-muted/50 leading-tight">{a.reason}</span>
                <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${CONFIDENCE_DOT[a.confidence]}`} />
                  <span className="text-[9px] text-g-muted/30 uppercase tracking-wider">{a.dataSource}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {data.basedOnStreams < 3 && (
        <p className="text-[10px] text-g-muted/30 mt-4 pt-3 border-t border-g-border/20">
          {t('nextBrief.becomesMorePrecise', {
            streams: data.basedOnStreams === 1 ? '1 stream' : `${data.basedOnStreams} streams`,
          })}
        </p>
      )}
    </section>
  );
}
