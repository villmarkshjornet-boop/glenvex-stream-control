'use client';

import { useEffect, useState } from 'react';
import { tidSiden } from './helpers';

interface Learning {
  id: string;
  knowledgeType: string;
  typeLabel: string;
  key: string;
  title: string;
  finding: string;
  confidence: number;
  evidenceCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface Summary {
  totalLearnings: number;
  recentCount: number;
  avgConfidence: number | null;
  topPartner: { name: string; approvalRate: number | null; evidenceCount: number } | null;
  bestTimingWindow: { label: string; approvalRate: number | null; evidenceCount: number } | null;
  bestPlatform: { platform: string; percentage: number | null; evidenceCount: number } | null;
  lastRun: { ts: string; total: number | null; created: number | null; updated: number | null; proposalsAnalyzed: number | null; decisionsAnalyzed: number | null } | null;
}

interface LearningsResponse {
  learnings: Learning[];
  summary: Summary | null;
}

const CONFIDENCE_COLOR = (c: number) =>
  c >= 75 ? 'text-emerald-400' : c >= 40 ? 'text-amber-400' : 'text-g-muted/50';

const CONFIDENCE_LABEL = (c: number) =>
  c >= 75 ? 'sterk' : c >= 40 ? 'moderat' : 'svak';

const TYPE_ICON: Record<string, string> = {
  promotion_pattern:   '✓',
  rejection_pattern:   '✗',
  platform_preference: '⊞',
  decision_accuracy:   '◎',
  stream_behaviour:    '⏱',
  creator_preference:  '♦',
  partner_performance: '★',
  timing_pattern:      '⌚',
};

export function CreatorBrainLearning() {
  const [data, setData] = useState<LearningsResponse | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/creator-brain/learnings');
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;
  const { learnings, summary } = data;
  if (learnings.length === 0 && (!summary || summary.totalLearnings === 0)) return null;

  const shown = learnings.slice(0, 5);

  return (
    <section className="bg-g-surface border border-g-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-g-text tracking-wide">
          Creator Brain — Hva har AI lært?
        </h2>
        {summary?.lastRun && (
          <span className="text-[10px] text-g-muted/40">
            Sist kjørt {tidSiden(summary.lastRun.ts)}
            {summary.lastRun.proposalsAnalyzed != null && (
              <> · {summary.lastRun.proposalsAnalyzed} forslag analysert</>
            )}
          </span>
        )}
      </div>

      {/* Key insight chips */}
      {summary && (summary.topPartner || summary.bestTimingWindow || summary.bestPlatform) && (
        <div className="flex flex-wrap gap-2">
          {summary.topPartner?.approvalRate != null && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-900/20 border border-emerald-800/30 text-[11px] text-emerald-300">
              ★ {summary.topPartner.name} godkjennes {summary.topPartner.approvalRate}%
              <span className="text-emerald-600/60">({summary.topPartner.evidenceCount} forslag)</span>
            </span>
          )}
          {summary.bestTimingWindow?.approvalRate != null && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-900/20 border border-blue-800/30 text-[11px] text-blue-300">
              ⏱ Best tidspunkt: {summary.bestTimingWindow.label} → {summary.bestTimingWindow.approvalRate}%
            </span>
          )}
          {summary.bestPlatform?.percentage != null && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-900/20 border border-purple-800/30 text-[11px] text-purple-300">
              ⊞ {summary.bestPlatform.platform}: {summary.bestPlatform.percentage}% av promoer
            </span>
          )}
        </div>
      )}

      {/* Learning list */}
      {shown.length > 0 ? (
        <ul className="space-y-2">
          {shown.map(l => (
            <li key={l.id} className="flex gap-2.5 items-start">
              <span className="text-g-muted/30 text-xs mt-0.5 w-4 flex-shrink-0 text-center">
                {TYPE_ICON[l.knowledgeType] ?? '·'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-g-muted/80 leading-snug">{l.finding}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-g-muted/40">{l.typeLabel}</span>
                  <span className={`text-[10px] ${CONFIDENCE_COLOR(l.confidence)}`}>
                    {l.confidence}% {CONFIDENCE_LABEL(l.confidence)}
                  </span>
                  <span className="text-[10px] text-g-muted/30">{l.evidenceCount} datapunkt</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : summary && summary.totalLearnings > 0 ? (
        <p className="text-xs text-g-muted/40">
          {summary.totalLearnings} læringer lagret — ingen oppdatert siste 7 dager.
        </p>
      ) : (
        <p className="text-xs text-g-muted/40">
          Creator Brain samler data. Kjør 20–30 streams for å bygge opp kunnskap.
        </p>
      )}

      {summary && summary.totalLearnings > 0 && (
        <p className="text-[10px] text-g-muted/30">
          {summary.totalLearnings} kunnskapsoppføringer totalt
          {summary.avgConfidence != null && (
            <> · gj.snitt {summary.avgConfidence}% konfidensgrad</>
          )}
        </p>
      )}
    </section>
  );
}
