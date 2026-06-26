'use client';

import Link from 'next/link';
import { AlertCircle, AlertTriangle, Zap, ChevronRight } from 'lucide-react';
import { tidSiden } from './helpers';
import type { ActionCenterItem } from './types';
import { useI18n } from '@/contexts/I18nContext';

const PRIORITY_ICON: Record<ActionCenterItem['priority'], typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  action: Zap,
};
const PRIORITY_COLOR: Record<ActionCenterItem['priority'], string> = {
  error: 'text-red-400',
  warning: 'text-yellow-400',
  action: 'text-g-green',
};

export function ActionCenter({ items, loading }: { items: ActionCenterItem[] | undefined; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">{t('actionCenter.title')}</p>

      {!items || items.length === 0 ? (
        <p className="text-sm text-g-muted">{t('actionCenter.empty')}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const Icon = PRIORITY_ICON[item.priority];
            return (
              <Link key={i} href={item.href}
                className="flex items-center gap-3 px-4 py-3 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all group">
                <Icon size={16} className={`flex-shrink-0 ${PRIORITY_COLOR[item.priority]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-g-text leading-snug">{item.title}</p>
                  {item.detail && <p className="text-xs text-g-muted leading-snug mt-0.5">{item.detail}</p>}
                </div>
                <span className="text-xs text-g-muted/50 flex-shrink-0">{tidSiden(item.createdAt)}</span>
                <ChevronRight size={15} className="text-g-muted/40 group-hover:text-g-muted flex-shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
