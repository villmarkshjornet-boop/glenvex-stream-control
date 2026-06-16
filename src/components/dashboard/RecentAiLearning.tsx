'use client';

import Link from 'next/link';
import { tidSiden, alderLabel, healthDot } from './helpers';
import type { AiInnsikt, AiLearning } from './types';

export function RecentAiLearning({ innsikter, aiLearning, loading }: { innsikter: AiInnsikt[]; aiLearning?: AiLearning; loading: boolean }) {
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  const harInnsikter = innsikter && innsikter.length > 0;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {harInnsikter && <span className="w-1.5 h-1.5 rounded-full bg-g-green" />}
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Learning</p>
        </div>
        <Link href="/ai-memory" className="text-[9px] text-g-muted hover:text-g-green transition-colors">AI Memory →</Link>
      </div>

      {/* Health metrics grid */}
      {aiLearning && (
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Siste aggregering', ts: aiLearning.lastAggregation, warnMs: 20 * 60_000 },
            { label: 'Siste feedback-run', ts: aiLearning.lastFeedbackRun, warnMs: 70 * 60_000 },
            { label: 'Siste memory-update', ts: aiLearning.lastMemoryUpdate, warnMs: 35 * 60_000 },
            { label: 'Siste innsikt', ts: aiLearning.lastInsightAt, warnMs: 35 * 60_000 },
          ].map(({ label, ts, warnMs }) => (
            <div key={label} className="flex items-center gap-1.5 py-1 px-1.5 rounded border border-g-border/20 bg-g-bg/30">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(ts, warnMs)}`} />
              <div className="min-w-0">
                <p className="text-[8px] text-g-muted/60 leading-none">{label}</p>
                <p className="text-[9px] text-g-text font-mono leading-snug">{alderLabel(ts)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Counts row */}
      {aiLearning && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.eventsLast60min}</span> events/60 min
          </span>
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.decisionsLast24h}</span> beslutninger/24t
          </span>
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.feedbackDecisionsLast24h}</span> med feedback
          </span>
        </div>
      )}

      {/* Siste læringspunkt */}
      {aiLearning?.sisteInnsikt ? (
        <div className="border-t border-g-border/20 pt-2">
          <p className="text-[8px] text-g-muted/50 uppercase font-bold mb-1">Siste læringspunkt</p>
          <p className="text-[10px] font-bold text-g-green">{aiLearning.sisteInnsikt.title}</p>
          <p className="text-[9px] text-g-muted leading-snug mt-0.5">{aiLearning.sisteInnsikt.summary.slice(0, 140)}</p>
          <p className="text-[8px] text-g-muted/40 mt-1">{tidSiden(aiLearning.sisteInnsikt.createdAt)}</p>
        </div>
      ) : !harInnsikter ? (
        <p className="text-[10px] text-g-muted border-t border-g-border/20 pt-2">Ingen nye AI-innsikter ennå.</p>
      ) : null}

      {/* Øvrige innsikter */}
      {harInnsikter && (
        <div className="space-y-1.5 border-t border-g-border/20 pt-2">
          {innsikter.slice(0, 3).map((ins, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className="text-g-green text-[9px] font-black flex-shrink-0 mt-0.5">◆</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-g-green">{ins.title}</p>
                <p className="text-[9px] text-g-muted leading-snug">{ins.summary.slice(0, 100)}</p>
              </div>
              <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(ins.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
