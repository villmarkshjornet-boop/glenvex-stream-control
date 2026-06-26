'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar } from 'lucide-react';
import { tidSiden } from './helpers';
import type { LiveData } from './types';
import { useI18n } from '@/contexts/I18nContext';

export function NextStreamCard({ nesteStream, preHype, loading }: {
  nesteStream: LiveData['nesteStream']; preHype: LiveData['preHype']; loading: boolean;
}) {
  const { t } = useI18n();
  const [nedtelling, setNedtelling] = useState<string | null>(null);

  useEffect(() => {
    if (!nesteStream?.tidspunkt) { setNedtelling(null); return; }
    const oppdater = () => {
      const ms = new Date(nesteStream.tidspunkt!).getTime() - Date.now();
      if (ms <= 0) { setNedtelling(t('common.now')); return; }
      const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
      if (h >= 24)  setNedtelling(`${Math.floor(h / 24)}d ${h % 24}t`);
      else if (h > 0) setNedtelling(`${h}t ${m}m`);
      else          setNedtelling(`${m}m ${s}s`);
    };
    oppdater();
    const id = setInterval(oppdater, 1000);
    return () => clearInterval(id);
  }, [nesteStream?.tidspunkt, t]);

  const preHypeLabel: Record<string, string> = {
    sendt:        t('nextStream.preHypeSent'),
    planlagt:     t('nextStream.preHypePlanned'),
    klar:         t('nextStream.preHypeReady'),
    ikke_planlagt:t('nextStream.preHypeNone'),
  };
  const preHypeColor: Record<string, string> = {
    sendt:        'text-g-green border-g-green/20',
    planlagt:     'text-yellow-300 border-yellow-400/20',
    klar:         'text-blue-300 border-blue-400/20',
    ikke_planlagt:'text-g-muted border-g-border',
  };

  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  if (!nesteStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">{t('nextStream.title')}</p>
        <p className="text-sm text-g-muted">{t('nextStream.noSchedule')}</p>
        <Link href="/streamplan" className="text-xs text-g-green hover:underline mt-2 inline-block">{t('nextStream.editSchedule')}</Link>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">{t('nextStream.title')}</p>
        <Link href="/streamplan" className="text-xs text-g-muted hover:text-g-green transition-colors">{t('nextStream.editSchedule')}</Link>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Calendar size={18} className="text-g-green flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-base font-black text-g-text">{nesteStream.dag} kl. {nesteStream.tid} · {nesteStream.spill}</p>
            {nesteStream.tittel && <p className="text-xs text-g-muted mt-0.5">{nesteStream.tittel}</p>}
          </div>
        </div>
        {nedtelling && <span className="font-black text-g-green text-2xl">{nedtelling}</span>}
      </div>
      {preHype && preHype.status !== 'ikke_planlagt' && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-g-border/40">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${preHypeColor[preHype.status] ?? 'text-g-muted'}`}>
            {preHypeLabel[preHype.status]}
          </span>
          {preHype.status === 'planlagt' && preHype.tidTilUtsending && (
            <span className="text-xs text-g-muted">{t('nextStream.in', { time: preHype.tidTilUtsending })}</span>
          )}
          {preHype.status === 'sendt' && preHype.sendtAt && (
            <span className="text-xs text-g-muted">{tidSiden(preHype.sendtAt)}</span>
          )}
        </div>
      )}
    </div>
  );
}
