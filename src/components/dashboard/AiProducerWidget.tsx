'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { AiInnsikt, AiLearning } from './types';

export function AiProducerWidget({ innsikter, aiLearning, loading }: { innsikter: AiInnsikt[]; aiLearning?: AiLearning; loading: boolean }) {
  if (loading) return null;

  const harData = innsikter.length > 0 || aiLearning?.sisteInnsikt;
  if (!harData) return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Producer</p>
        <Link href="/ai-producer" className="text-[9px] text-g-green hover:underline">Åpne →</Link>
      </div>
      <p className="text-[10px] text-g-muted">Ingen analyse ennå. <Link href="/ai-producer" className="text-g-green hover:underline">Kjør AI Producer →</Link></p>
    </div>
  );

  const siste = aiLearning?.sisteInnsikt ?? (innsikter[0] ? { title: innsikter[0].title, summary: innsikter[0].summary, createdAt: innsikter[0].createdAt } : null);

  return (
    <div className="bg-g-card border border-g-green/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green" />
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Producer</p>
        </div>
        <Link href="/ai-producer" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Full analyse →</Link>
      </div>
      {siste && (
        <div className="mb-2">
          <p className="text-[10px] font-bold text-g-green">{siste.title}</p>
          <p className="text-[9px] text-g-muted leading-snug mt-0.5">{siste.summary.slice(0, 160)}</p>
          <p className="text-[8px] text-g-muted/40 mt-1">{tidSiden(siste.createdAt)}</p>
        </div>
      )}
      {innsikter.length > 1 && (
        <div className="space-y-1 border-t border-g-border/20 pt-2 mt-2">
          {innsikter.slice(1, 3).map((ins, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-g-green text-[8px] font-black mt-0.5">◆</span>
              <p className="text-[9px] text-g-muted leading-snug">{ins.title}</p>
            </div>
          ))}
        </div>
      )}
      {aiLearning && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-g-border/20">
          <span className="text-[9px] text-g-muted/60">{aiLearning.eventsLast60min} events/60min</span>
          <span className="text-[9px] text-g-muted/40">·</span>
          <span className="text-[9px] text-g-muted/60">{aiLearning.decisionsLast24h} beslutninger/24t</span>
        </div>
      )}
    </div>
  );
}
