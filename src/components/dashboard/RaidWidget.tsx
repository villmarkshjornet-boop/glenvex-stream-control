'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RaidTarget } from './types';
import { useI18n } from '@/contexts/I18nContext';

export function RaidWidget() {
  const { t } = useI18n();
  const [targets, setTargets] = useState<RaidTarget[]>([]);
  const [game, setGame] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const d = await fetch('/api/raid-targets').then(r => r.json());
        setTargets(d.targets ?? []);
        setGame(d.currentGame ?? null);
      } catch {}
      setLoading(false);
    };
    fetch_();
    const id = setInterval(fetch_, 90_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return null;
  if (!game || targets.length === 0) return null;

  const top3 = targets.slice(0, 3);
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{t('raidWidget.title', { game })}</p>
        </div>
        <Link href="/raid-manager" className="text-[9px] text-g-muted hover:text-g-green transition-colors">{t('raidWidget.viewAll')}</Link>
      </div>
      <div className="space-y-2">
        {top3.map((tg, i) => (
          <div key={tg.login} className="flex items-center gap-3 py-1.5 px-2 rounded border border-g-border/20 bg-g-bg/30">
            <span className={`text-[10px] font-black font-mono w-4 ${i === 0 ? 'text-g-green' : 'text-g-muted/60'}`}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-g-text truncate">{tg.username}</p>
              <p className="text-[8px] text-g-muted truncate">{tg.grunn || tg.game}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] font-mono font-black text-g-green">{tg.viewers.toLocaleString()}</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded border font-bold ${tg.score >= 80 ? 'text-g-green border-g-green/30' : 'text-g-muted border-g-border'}`}>{tg.score}%</span>
              <a href={tg.url} target="_blank" rel="noreferrer" className="text-[8px] text-g-green hover:underline">↗</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
