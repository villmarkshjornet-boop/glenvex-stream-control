'use client';

import { tidSiden } from './helpers';
import type { Lærdom } from './types';
import { useI18n } from '@/contexts/I18nContext';

const CONFIDENCE_FARGE: Record<string, string> = {
  for_lite_datagrunnlag: 'text-g-muted border-g-border',
  lav:    'text-yellow-400 border-yellow-400/20',
  medium: 'text-blue-400 border-blue-400/20',
  høy:    'text-g-green border-g-green/20',
};

export function DetteVetGlenvex({ data, loading }: { data: Lærdom | undefined; loading: boolean }) {
  const { t } = useI18n();
  if (loading || !data) return null;
  const { utførteTiltak, siste30dager, confidenceLabel, notat, totalDatapunkter } = data;
  const harData = totalDatapunkter > 0;

  const confidenceBadge = confidenceLabel === 'for_lite_datagrunnlag'
    ? t('aiContext.littleData')
    : t('aiContext.confidence', { level: confidenceLabel });

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{t('aiContext.title')}</p>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${CONFIDENCE_FARGE[confidenceLabel] ?? CONFIDENCE_FARGE.lav}`}>
          {confidenceBadge}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { tKey: 'aiContext.analyser', val: siste30dager.analyser },
          { tKey: 'aiContext.utfort',   val: siste30dager.utført,  color: 'text-g-green' },
          { tKey: 'aiContext.avvist',   val: siste30dager.avvist,  color: 'text-g-muted' },
          { tKey: 'aiContext.raids',    val: siste30dager.raids },
        ].map(({ tKey, val, color }) => (
          <div key={tKey} className="text-center border border-g-border/30 rounded-lg py-1.5 px-2">
            <p className={`text-lg font-black font-mono ${color ?? 'text-g-text'}`}>{val}</p>
            <p className="text-[8px] text-g-muted uppercase tracking-widest">{t(tKey)}</p>
          </div>
        ))}
      </div>

      {utførteTiltak.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[9px] text-g-muted font-bold uppercase tracking-widest mb-1.5">{t('aiContext.lastActions')}</p>
          {utførteTiltak.slice(0, 4).map((tl, i) => (
            <div key={i} className="flex items-start gap-2 py-1 border-b border-g-border/20 last:border-0">
              <span className="w-1 h-1 rounded-full bg-g-green mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-g-text leading-snug">{tl.summary.slice(0, 90)}</p>
                {tl.game && <p className="text-[9px] text-g-muted">{tl.game}</p>}
              </div>
              <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(tl.executedAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-g-muted">{notat}</p>
      )}

      {harData && (
        <p className="text-[9px] text-g-muted/50 mt-2 border-t border-g-border/20 pt-2">{notat}</p>
      )}
    </div>
  );
}
