'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { tidSiden } from './helpers';
import type { SystemEvent } from './types';

const SEV_STYLE: Record<string, string> = {
  info:     'text-g-text border-g-border/30',
  warning:  'text-yellow-300 border-yellow-400/30',
  error:    'text-red-300 border-red-400/30',
  critical: 'text-red-400 border-red-500/50 font-bold',
};

const SEV_DOT: Record<string, string> = {
  info:     'bg-g-muted/40',
  warning:  'bg-yellow-400',
  error:    'bg-red-400',
  critical: 'bg-red-500 animate-pulse',
};

const SOURCE_LABEL: Record<string, string> = {
  thumbnail:          'Thumbnail',
  clip_worker:        'Clip Worker',
  content_factory:    'Content Factory',
  discord_bot:        'Discord Bot',
  twitch_bot:         'Twitch Bot',
  recovery_engine:    'Recovery',
  learning:           'AI Learning',
  learning_aggregator:'AI Learning',
  system:             'System',
  settings:           'Innstillinger',
};

type Filter = 'alle' | 'viktige' | 'system';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'alle',    label: 'Alle' },
  { key: 'viktige', label: 'Viktige' },
  { key: 'system',  label: 'System' },
];

const SYSTEM_SOURCES = new Set(['system', 'settings', 'database', 'api_monitor', 'recovery_engine', 'cron', 'scheduler']);

export function ActivityFeed({ events, loading }: { events: SystemEvent[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('alle');

  const filtered = useMemo(() => {
    if (filter === 'viktige') return events.filter(e => e.severity === 'warning' || e.severity === 'error' || e.severity === 'critical');
    if (filter === 'system')  return events.filter(e => SYSTEM_SOURCES.has(e.source));
    return events;
  }, [events, filter]);

  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Aktivitetsfeed</p>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
              <span className="text-[9px] text-g-green">{events.length} events</span>
            </>
          )}
          <Link href="/api/system-events?limit=100" target="_blank" className="text-[9px] text-g-muted hover:text-g-green transition-colors">
            Se alle →
          </Link>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-[9px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.key
                ? 'border-g-green/40 text-g-green bg-g-green/5'
                : 'border-g-border text-g-muted hover:text-g-text hover:border-g-border'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[11px] text-g-muted">
          {events.length === 0 ? 'Ingen system-events ennå – events dukker opp her automatisk fra alle moduler.' : 'Ingen events i denne kategorien.'}
        </p>
      ) : (
        <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
          {filtered.map((e) => {
            const isExpanded = expandedId === e.id;
            const hasMeta = e.metadata && Object.keys(e.metadata).length > 0;
            return (
              <div key={e.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  className={`w-full text-left flex items-start gap-2.5 py-1.5 border-b last:border-0 transition-colors ${SEV_STYLE[e.severity] ?? SEV_STYLE.info} ${hasMeta ? 'cursor-pointer hover:bg-white/[0.02]' : 'cursor-default'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[e.severity] ?? SEV_DOT.info}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[9px] text-g-muted font-bold uppercase">
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </span>
                      <span className="text-[9px] text-g-muted/40">{e.event_type}</span>
                      {hasMeta && <span className="text-[8px] text-g-muted/30">{isExpanded ? '▲' : '▼'}</span>}
                    </div>
                    <p className="text-[10px] leading-snug mt-0.5">{e.title}</p>
                    {e.description && (
                      <p className="text-[9px] text-g-muted/60 leading-snug">{e.description}</p>
                    )}
                  </div>
                  <span className="text-[9px] text-g-muted/40 flex-shrink-0 mt-1">{tidSiden(e.created_at)}</span>
                </button>
                {isExpanded && hasMeta && (
                  <div className="ml-4 mb-1.5 p-2 bg-g-bg/40 border border-g-border/20 rounded-lg">
                    <p className="text-[8px] text-g-muted/50 uppercase font-bold mb-1">Metadata</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {Object.entries(e.metadata!).slice(0, 12).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-1 min-w-0">
                          <span className="text-[8px] text-g-muted/50 font-mono shrink-0">{k}</span>
                          <span className="text-[9px] text-g-text font-mono truncate">
                            {typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v ?? '—').slice(0, 80)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[8px] text-g-muted/30 mt-1.5 font-mono">{new Date(e.created_at).toLocaleString('no-NO')}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
