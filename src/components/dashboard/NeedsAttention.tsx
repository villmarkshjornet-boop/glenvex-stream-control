'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { NeedsAttentionItem } from './types';

const SEVERITY_STYLE: Record<string, string> = {
  warning: 'border-yellow-500/40 bg-yellow-500/[0.06]',
  error:   'border-red-500/40 bg-red-500/[0.06]',
};
const SEVERITY_DOT: Record<string, string> = {
  warning: 'bg-yellow-400',
  error:   'bg-red-400 animate-pulse',
};
const SEVERITY_TEXT: Record<string, string> = {
  warning: 'text-yellow-300',
  error:   'text-red-300',
};

export function NeedsAttention({ items, loading }: { items: NeedsAttentionItem[] | undefined; loading: boolean }) {
  if (loading) return <div className="h-32 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Trenger oppmerksomhet</p>
        {items && items.length > 0 && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-red-500/40 text-red-400 bg-red-500/10">
            {items.length}
          </span>
        )}
      </div>
      {!items || items.length === 0 ? (
        <p className="text-[10px] text-g-muted">Ingenting krever handling akkurat nå.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <Link key={i} href={item.href}
              className={`block border rounded-lg px-3 py-2 transition-all hover:brightness-110 ${SEVERITY_STYLE[item.severity]}`}>
              <div className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${SEVERITY_DOT[item.severity]}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] font-bold leading-snug ${SEVERITY_TEXT[item.severity]}`}>{item.title}</p>
                  {item.detail && <p className="text-[9px] text-g-muted/70 leading-snug mt-0.5">{item.detail}</p>}
                </div>
                <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(item.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
