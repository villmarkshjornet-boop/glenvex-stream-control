'use client';

import Link from 'next/link';
import type { LogEntry } from '@/types';

interface Props {
  logs: LogEntry[];
  loading?: boolean;
  maxRows?: number;
}

const TYPE_CONFIG = {
  success: { dot: 'bg-g-green', text: 'text-g-green', icon: '●' },
  info: { dot: 'bg-blue-400', text: 'text-blue-400', icon: '●' },
  warning: { dot: 'bg-yellow-400', text: 'text-yellow-400', icon: '●' },
  error: { dot: 'bg-red-500', text: 'text-red-400', icon: '●' },
} as const;

export default function LogsPreview({ logs, loading, maxRows = 6 }: Props) {
  const visible = logs.slice(0, maxRows);

  return (
    <div className="bg-g-card border border-g-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
          Siste Logg
        </h2>
        <Link
          href="/logs"
          className="text-[10px] text-g-muted hover:text-g-green transition-colors tracking-wider uppercase"
        >
          Se alle →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(maxRows)].map((_, i) => (
            <div key={i} className="h-6 bg-g-bg rounded animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-g-muted py-4 text-center">Ingen logg-oppføringer ennå</p>
      ) : (
        <div className="space-y-1">
          {visible.map((log) => {
            const cfg = TYPE_CONFIG[log.type];
            const time = new Date(log.timestamp).toLocaleTimeString('no-NO', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            return (
              <div
                key={log.id}
                className="flex items-center gap-2.5 py-1.5 border-b border-g-border/40 last:border-0"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="text-[11px] text-g-muted font-mono flex-shrink-0 w-16">
                  {time}
                </span>
                <span className="text-[11px] text-g-text truncate">{log.message}</span>
                <span className={`text-[10px] font-mono ml-auto flex-shrink-0 ${cfg.text}`}>
                  {log.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
