'use client';

import type { CoverageEntry } from './types';
import { useI18n } from '@/contexts/I18nContext';

const AI_SYSTEM_KEYS = [
  { key: 'twitch_bot',      tKey: 'aiStatus.systems.twitch_bot',      warnMs: 15 * 60 * 1000 },
  { key: 'discord_bot',     tKey: 'aiStatus.systems.discord_bot',     warnMs: 15 * 60 * 1000 },
  { key: 'content_factory', tKey: 'aiStatus.systems.content_factory', warnMs: 30 * 60 * 1000 },
  { key: 'ai_producer',     tKey: 'aiStatus.systems.ai_producer',     warnMs: 60 * 60 * 1000 },
  { key: 'learning_engine', tKey: 'aiStatus.systems.learning_engine', warnMs: 24 * 60 * 60 * 1000 },
  { key: 'partner_engine',  tKey: 'aiStatus.systems.partner_engine',  warnMs: 60 * 60 * 1000 },
];

function coverageDot(entry: CoverageEntry | undefined): string {
  if (!entry) return 'bg-g-muted/25';
  if (entry.errors24h > 0) return 'bg-red-400';
  if (entry.status === 'active') return 'bg-g-green animate-pulse';
  if (entry.status === 'stale') return 'bg-yellow-400';
  if (entry.passive) return 'bg-g-muted/30';
  return 'bg-g-muted/25';
}

interface Props {
  coverage: CoverageEntry[] | undefined;
  loading: boolean;
}

export function AiStatusRow({ coverage, loading }: Props) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl px-5 py-4">
        <div className="flex items-center gap-6">
          {AI_SYSTEM_KEYS.map(s => (
            <div key={s.key} className="flex items-center gap-1.5 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-g-border" />
              <span className="text-[10px] text-g-muted/30">{t(s.tKey)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between flex-wrap gap-x-6 gap-y-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold flex-shrink-0">{t('aiStatus.title')}</p>
        <div className="flex items-center gap-5 flex-wrap">
          {AI_SYSTEM_KEYS.map(sys => {
            const entry = coverage?.find(c => c.key === sys.key);
            const dot   = coverageDot(entry);
            const lbl   = !entry ? t('aiStatus.noData')
                        : entry.errors24h > 0 ? t('aiStatus.errors', { n: entry.errors24h })
                        : entry.status === 'active' ? t('aiStatus.active')
                        : entry.status === 'stale'  ? t('aiStatus.stale')
                        : entry.passive ? t('aiStatus.passive')
                        : t('aiStatus.unknown');
            const isErr = entry && entry.errors24h > 0;
            return (
              <div key={sys.key} className="flex items-center gap-1.5" title={`${t(sys.tKey)}: ${lbl}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                <span className={`text-[10px] font-medium ${isErr ? 'text-red-400' : 'text-g-muted/70'}`}>
                  {t(sys.tKey)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
