'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { tidSiden } from './helpers';
import type { AiInnsikt, Lærdom } from './types';

const MIN_DATAPUNKTER = 5;

export function AiInsightFeed({ innsikter, lærdom, loading }: { innsikter: AiInnsikt[]; lærdom?: Lærdom; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  const totalDatapunkter = lærdom?.totalDatapunkter ?? 0;
  const harNokData = totalDatapunkter >= MIN_DATAPUNKTER;
  const siste = innsikter[0] ?? null;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Hva lærte AI?</p>
        <Link href="/ai-memory" className="text-xs text-g-muted hover:text-g-green transition-colors">AI Memory →</Link>
      </div>

      {!harNokData ? (
        <p className="text-sm text-g-muted">
          AI trenger flere datapunkter ({totalDatapunkter}/{MIN_DATAPUNKTER}) før den kan gi spesifikke innsikter.
        </p>
      ) : !siste ? (
        <p className="text-sm text-g-muted">Ingen innsikter generert ennå.</p>
      ) : (
        <>
          <div className="flex gap-3 p-4 bg-g-green/5 border border-g-green/20 rounded-xl">
            <Sparkles size={16} className="text-g-green flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-g-text leading-snug">{siste.summary}</p>
              <p className="text-xs text-g-muted/60 mt-1.5">{tidSiden(siste.createdAt)}</p>
            </div>
          </div>

          {innsikter.length > 1 && (
            <div className="space-y-3 mt-4 pt-4 border-t border-g-border/40">
              {innsikter.slice(1, 4).map((ins, i) => (
                <div key={i} className="flex gap-2.5 items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-g-muted/40 flex-shrink-0 mt-1.5" />
                  <p className="text-xs text-g-muted leading-snug">{ins.summary}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
