'use client';

import type { CoverageEntry } from './types';

// Keys we care about for the compact AI status row
const AI_SYSTEMS: { key: string; label: string; warnMs: number }[] = [
  { key: 'twitch_bot',         label: 'Twitch Bot',       warnMs: 15 * 60 * 1000 },
  { key: 'discord_bot',        label: 'Discord Bot',       warnMs: 15 * 60 * 1000 },
  { key: 'content_factory',    label: 'Content',           warnMs: 30 * 60 * 1000 },
  { key: 'ai_producer',        label: 'AI Producer',       warnMs: 60 * 60 * 1000 },
  { key: 'learning_engine',    label: 'Learning',          warnMs: 24 * 60 * 60 * 1000 },
  { key: 'partner_engine',     label: 'Partner Engine',    warnMs: 60 * 60 * 1000 },
];

function coverageDot(entry: CoverageEntry | undefined): string {
  if (!entry) return 'bg-g-muted/25';
  if (entry.errors24h > 0) return 'bg-red-400';
  if (entry.status === 'active') return 'bg-g-green animate-pulse';
  if (entry.status === 'stale') return 'bg-yellow-400';
  if (entry.passive) return 'bg-g-muted/30';
  return 'bg-g-muted/25';
}

function coverageLabel(entry: CoverageEntry | undefined): string {
  if (!entry) return 'Ingen data';
  if (entry.errors24h > 0) return `${entry.errors24h} feil`;
  if (entry.status === 'active') return 'Aktiv';
  if (entry.status === 'stale') return 'Inaktiv';
  if (entry.passive) return 'Passiv';
  return 'Ukjent';
}

interface Props {
  coverage: CoverageEntry[] | undefined;
  loading: boolean;
}

export function AiStatusRow({ coverage, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl px-5 py-4">
        <div className="flex items-center gap-6">
          {AI_SYSTEMS.map(s => (
            <div key={s.key} className="flex items-center gap-1.5 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-g-border" />
              <span className="text-[10px] text-g-muted/30">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between flex-wrap gap-x-6 gap-y-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold flex-shrink-0">AI Status</p>
        <div className="flex items-center gap-5 flex-wrap">
          {AI_SYSTEMS.map(sys => {
            const entry = coverage?.find(c => c.key === sys.key);
            const dot   = coverageDot(entry);
            const lbl   = coverageLabel(entry);
            const isErr = entry && entry.errors24h > 0;
            return (
              <div key={sys.key} className="flex items-center gap-1.5" title={`${sys.label}: ${lbl}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                <span className={`text-[10px] font-medium ${isErr ? 'text-red-400' : 'text-g-muted/70'}`}>
                  {sys.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
