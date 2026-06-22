'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, AlertTriangle, CheckCircle } from 'lucide-react';
import type { StorageCategory, StorageHealthData } from '@/app/api/storage-health/route';

const STORAGE_BUCKET_LABEL = process.env.NEXT_PUBLIC_STORAGE_BUCKET ?? 'glenvex-assets';

const TIER_COLOR: Record<StorageCategory['tier'], string> = {
  permanent: 'text-g-green',
  media:     'text-amber-400',
  ephemeral: 'text-red-400/70',
};

const TIER_BADGE: Record<StorageCategory['tier'], string> = {
  permanent: 'bg-g-green/10 text-g-green border-g-green/20',
  media:     'bg-amber-400/10 text-amber-400 border-amber-400/20',
  ephemeral: 'bg-red-400/10 text-red-400/70 border-red-400/20',
};

const TIER_LABEL: Record<StorageCategory['tier'], string> = {
  permanent: 'Permanent',
  media:     'Aktiv media',
  ephemeral: 'Flyktig',
};

function fmt(n: number): string {
  if (n < 0) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function StorageHealthCard() {
  const [data, setData] = useState<StorageHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/storage-health')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-24 bg-g-card border border-g-border rounded-2xl animate-pulse" />;
  if (!data) return null;

  const warnings = data.databaseCategories.filter(c => c.warning);
  const totalRows = data.databaseCategories.reduce((s, c) => s + Math.max(0, c.rowCount), 0);
  const totalFiles = data.storageFiles.reduce((s, f) => s + f.fileCount, 0);

  return (
    <section className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-g-bg/30 transition-all"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <HardDrive size={14} className="text-g-muted/50 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-g-text/80">Storage Health</p>
            <p className="text-[10px] text-g-muted/50 mt-0.5">
              {fmt(totalRows)} DB-rader
              {data.storageReachable && totalFiles > 0 && ` · ${totalFiles}+ filer i Storage`}
              {!data.storageReachable && ' · Storage utilgjengelig'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {warnings.length > 0 ? (
            <span className="flex items-center gap-1 text-amber-400/80 text-[10px] font-bold">
              <AlertTriangle size={11} />
              {warnings.length} {warnings.length === 1 ? 'advarsel' : 'advarsler'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-g-green/60 text-[10px]">
              <CheckCircle size={11} />
              OK
            </span>
          )}
          <span className="text-g-muted/30 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-g-border/40 p-5 space-y-5">

          {/* Warnings first */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map(c => (
                <div key={c.label} className="flex items-start gap-2 p-3 bg-amber-400/5 border border-amber-400/15 rounded-xl">
                  <AlertTriangle size={12} className="text-amber-400/70 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-400/80">{c.label}</p>
                    <p className="text-[10px] text-g-muted/60 mt-0.5">{c.warning}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Database categories */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] text-g-muted uppercase tracking-wider font-bold mb-3">
              <Database size={10} /> Database
            </div>
            <div className="space-y-2">
              {data.databaseCategories.map(c => (
                <div key={c.label} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-g-text/80 font-medium">{c.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${TIER_BADGE[c.tier]}`}>
                        {TIER_LABEL[c.tier]}
                      </span>
                    </div>
                    {c.note && (
                      <p className="text-[10px] text-g-muted/40 mt-0.5 truncate">{c.note}</p>
                    )}
                  </div>
                  <span className={`text-sm font-black flex-shrink-0 tabular-nums ${c.rowCount < 0 ? 'text-g-muted/30' : TIER_COLOR[c.tier]}`}>
                    {fmt(c.rowCount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Supabase Storage files */}
          {data.storageReachable && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] text-g-muted uppercase tracking-wider font-bold mb-3">
                <HardDrive size={10} /> Supabase Storage ({STORAGE_BUCKET_LABEL})
              </div>
              {data.storageFiles.length === 0 ? (
                <p className="text-xs text-g-muted/40">Ingen filer funnet i bucket.</p>
              ) : (
                <div className="space-y-3">
                  {data.storageFiles.map(g => (
                    <div key={g.prefix}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-g-text/70 font-medium">{g.label}</span>
                        <span className="text-sm font-black text-amber-400">{g.fileCount}+</span>
                      </div>
                      <div className="space-y-0.5">
                        {g.examplePaths.map(p => (
                          <p key={p} className="text-[10px] text-g-muted/40 font-mono truncate">{p}</p>
                        ))}
                        {g.fileCount > 3 && (
                          <p className="text-[9px] text-g-muted/30">… og {g.fileCount - 3}+ til</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!data.storageReachable && (
            <div className="flex items-center gap-2 p-3 bg-red-900/10 border border-red-500/20 rounded-xl">
              <AlertTriangle size={12} className="text-red-400/60 flex-shrink-0" />
              <p className="text-xs text-g-muted/60">Supabase Storage ikke tilgjengelig — sjekk STORAGE_BUCKET env og bucket-tillatelser.</p>
            </div>
          )}

          {/* Retention policy summary */}
          <div className="pt-3 border-t border-g-border/30 space-y-1.5">
            <p className="text-[10px] text-g-muted/50 font-bold uppercase tracking-wider">Lagringsregler</p>
            <p className="text-[10px] text-g-muted/40">
              <span className="text-g-green font-bold">Permanent:</span> Aldri slett — grunnlaget for AI-læring over tid
            </p>
            <p className="text-[10px] text-g-muted/40">
              <span className="text-amber-400 font-bold">Aktiv media:</span> Hold klipp til bruker har lastet ned; flytt til kald lagring (R2) etter 60 dager
            </p>
            <p className="text-[10px] text-g-muted/40">
              <span className="text-red-400/70 font-bold">Railway-disk:</span> Ephemeral — raw VODs og lydfiler forsvinner ved restart
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

