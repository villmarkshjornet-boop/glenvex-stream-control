'use client';

import { useEffect, useState } from 'react';
import { tidSiden } from './helpers';
import { useI18n } from '@/contexts/I18nContext';

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

export function CreatorBrainLearning() {
  const { t } = useI18n();
  const [data, setData] = useState<LearningsResponse | null>(null);

  const confidenceLabel = (c: number) =>
    c >= 75 ? t('common.systemOnline').slice(0, 0) || 'sterk'  // keep label in source language per design
    : c >= 40 ? 'moderat' : 'svak';

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
    <section className="bg-g-card border border-g-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">{t('creatorBrain.title')}</p>
        {summary?.lastRun && (
          <span className="text-[10px] text-g-muted/40">
            {tidSiden(summary.lastRun.ts)}
          </span>
        )}
      </div>

      {shown.length > 0 ? (
        <ul className="space-y-2">
          {shown.map(l => (
            <li key={l.id} className="flex gap-2.5 items-start">
              <span className={`text-xs mt-0.5 flex-shrink-0 ${CONFIDENCE_COLOR(l.confidence)}`}>✓</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-g-text/80 leading-snug">{l.finding}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] ${CONFIDENCE_COLOR(l.confidence)}`}>
                    {confidenceLabel(l.confidence)} ({l.evidenceCount} {t('creatorBrain.evidence')})
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-g-muted/40">{t('creatorBrain.noLearnings')}</p>
      )}
    </section>
  );
}
