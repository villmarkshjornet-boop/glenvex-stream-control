'use client';

import { useEffect, useState } from 'react';
import type { LogEntry } from '@/types';
import { PageHeader, TabBar, Spinner, EmptyState } from '@/components/ui';

const TYPE_COLORS = {
  success: { dot: 'bg-g-green',     text: 'text-g-green' },
  info:    { dot: 'bg-blue-400',    text: 'text-blue-400' },
  warning: { dot: 'bg-yellow-400',  text: 'text-yellow-400' },
  error:   { dot: 'bg-red-500',     text: 'text-red-400' },
} as const;

const FILTER_TABS = [
  { key: 'all',     label: 'Alle' },
  { key: 'success', label: 'Success' },
  { key: 'info',    label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'error',   label: 'Error' },
];

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  async function refresh(type?: string) {
    setLoading(true);
    try {
      const q = type && type !== 'all' ? `?type=${type}` : '';
      const res = await fetch(`/api/logs${q}`);
      if (res.ok) setLogs(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  function handleFilter(type: string) {
    setFilter(type);
    refresh(type);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader title="Logs" subtitle="Systemlogg og hendelseshistorikk">
        <button
          onClick={() => refresh(filter !== 'all' ? filter : undefined)}
          className="px-3 py-1.5 bg-g-card border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/20 transition-all"
        >
          ↻ Oppdater
        </button>
      </PageHeader>

      <TabBar
        tabs={FILTER_TABS.map(f => ({ id: f.key, label: f.label }))}
        active={filter}
        onChange={handleFilter}
      />

      <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto] gap-0 text-[11px] text-g-muted font-bold tracking-widest uppercase border-b border-g-border px-4 py-2.5">
          <span className="w-36">Tidspunkt</span>
          <span>Melding</span>
          <span className="text-right">Status</span>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Spinner />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-10">
            <EmptyState icon="▩" title="Ingen logg-oppføringer" description={filter !== 'all' ? `Ingen ${filter}-oppføringer.` : 'Loggen er tom.'} />
          </div>
        ) : (
          <div className="divide-y divide-g-border/40">
            {logs.map(log => {
              const cfg = TYPE_COLORS[log.type as keyof typeof TYPE_COLORS] ?? TYPE_COLORS.info;
              const ts = new Date(log.timestamp);
              const timeStr = ts.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const dateStr = ts.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
              return (
                <div key={log.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-g-bg/50 transition-colors">
                  <div className="flex items-center gap-2 w-36">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <div>
                      <p className="text-[11px] text-g-text font-mono">{timeStr}</p>
                      <p className="text-[11px] text-g-muted">{dateStr}</p>
                    </div>
                  </div>
                  <span className="text-xs text-g-text truncate">{log.message}</span>
                  <span className={`text-xs font-mono font-bold ${cfg.text} text-right`}>{log.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-g-muted text-right">Viser maks 500 oppføringer. Eldre oppføringer slettes automatisk.</p>
    </div>
  );
}
