'use client';

import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { HeroStream } from './types';

const CHECKLIST_LABELS: { key: keyof HeroStream['checklist']; label: string; optional?: boolean }[] = [
  { key: 'streamHistory',  label: 'Stream History' },
  { key: 'audienceData',   label: 'Audience-data' },
  { key: 'retentionCurve', label: 'Retention-kurve' },
  { key: 'chatEvents',     label: 'Chat-events' },
  { key: 'streamCoach',    label: 'Stream Coach' },
  { key: 'vodDetected',    label: 'VOD', optional: true },
  { key: 'aiLearning',     label: 'AI-læring' },
];

export function StreamCompletionCard({ heroStream, loading }: { heroStream: HeroStream | null | undefined; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  if (!heroStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">Stream Completion</p>
        <p className="text-sm text-g-muted">Ingen data å vise før neste stream er registrert.</p>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full">
      <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Stream Completion</p>

      <div className="space-y-2">
        {CHECKLIST_LABELS.map(({ key, label, optional }) => {
          const done = heroStream.checklist[key];
          return (
            <div key={key} className="flex items-center gap-2.5">
              {done
                ? <CheckCircle2 size={16} className="text-g-green flex-shrink-0" />
                : optional
                  ? <Clock size={16} className="text-g-muted/50 flex-shrink-0" />
                  : <XCircle size={16} className="text-red-400 flex-shrink-0" />}
              <span className={`text-sm ${done ? 'text-g-text' : optional ? 'text-g-muted/60' : 'text-g-text'}`}>{label}</span>
            </div>
          );
        })}
      </div>

      {heroStream.failureReasons.length > 0 && (
        <div className="mt-5 pt-4 border-t border-g-border/40">
          <p className="text-[11px] text-yellow-400 font-bold uppercase tracking-widest mb-2">Mangler / avvik</p>
          <ul className="space-y-1">
            {heroStream.failureReasons.map((r, i) => (
              <li key={i} className="text-xs text-g-muted">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
