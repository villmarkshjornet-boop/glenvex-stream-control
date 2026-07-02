'use client';

import Link from 'next/link';
import type { ActionCenterItem } from './types';
import { useI18n } from '@/contexts/I18nContext';

export function ActionCenter({ items, loading }: { items: ActionCenterItem[] | undefined; loading: boolean }) {
  const { t } = useI18n();

  if (loading) return <div className="h-20 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!items || items.length === 0) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">
        {t('actionCenter.title')}
      </h3>
      <div className="space-y-0 divide-y divide-g-border/30">
        {items.map((item, i) => (
          <Link key={i} href={item.href} className="flex items-center gap-3 py-2.5 group">
            {/* Priority dot */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              item.priority === 'error'   ? 'bg-red-500' :
              item.priority === 'action' ? 'bg-g-green' : 'bg-yellow-500'
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-g-text leading-snug">{item.title}</p>
              {item.detail && (
                <p className="text-[11px] text-g-muted/60 leading-snug mt-0.5">{item.detail}</p>
              )}
            </div>
            <span className="text-[11px] text-g-green/70 group-hover:text-g-green font-medium transition-colors shrink-0">
              Åpne →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
