'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';

interface StegStatus {
  steg: string;
  status: string;
  melding?: string;
  durationMs?: number;
  kostnad?: number;
  output?: number;
  tid?: string;
}

interface VodJobb {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string;
  twitch_vod_id?: string;
  duration_seconds?: number;
  stegStatus: StegStatus[];
  startTid?: string;
  sluttTid?: string;
  totalMs?: number;
  totalKostnad?: number;
  antallLogs: number;
}

const STEG_REKKEFØLGE = ['DOWNLOAD', 'TRANSCRIBE', 'DISCOVER', 'RANK', 'COPYWRITE', 'QUEUE'];

const STATUS_STIL: Record<string, string> = {
  COMPLETE:    'text-g-green border-g-green/30 bg-g-green/10',
  OK:          'text-g-green border-g-green/30 bg-g-green/10',
  FAILED:      'text-red-400 border-red-400/30 bg-red-400/10',
  FEILET:      'text-red-400 border-red-400/30 bg-red-400/10',
  PROCESSING:  'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  DOWNLOADING: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  TRANSCRIBING:'text-blue-400 border-blue-400/30 bg-blue-400/10',
  PENDING:     'text-g-muted border-g-border bg-g-bg',
  IKKE_STARTET:'text-g-muted border-g-border bg-g-bg',
};

function tid(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

function kost(kr: number): string {
  if (kr < 0.01) return `< $0.01`;
  return `$${kr.toFixed(3)}`;
}

export default function JobMonitorPage() {
  const [vods, setVods] = useState<VodJobb[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'alle' | 'aktive' | 'ferdige' | 'feilet'>('alle');
  const [valgt, setValgt] = useState<string | null>(null);

  const hent = () => {
    setLoading(true);
    fetch('/api/content-factory/jobs').then(r => r.json()).then(d => {
      setVods(d.vods ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    hent();
    const id = setInterval(hent, 15_000);
    return () => clearInterval(id);
  }, []);

  const filtrert = vods.filter(v => {
    if (filter === 'aktive') return ['PENDING', 'ANALYZING', 'DOWNLOADING', 'TRANSCRIBING', 'PROCESSING'].includes(v.status);
    if (filter === 'ferdige') return v.status === 'COMPLETE';
    if (filter === 'feilet') return v.status === 'FAILED';
    return true;
  });

  const totalKostnad = vods.reduce((s, v) => s + (v.totalKostnad ?? 0), 0);
  const antallComplete = vods.filter(v => v.status === 'COMPLETE').length;
  const antallFeilet = vods.filter(v => v.status === 'FAILED').length;

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">
      <PageHeader title="Job Monitor" subtitle="Overvåk alle Content Factory-jobber og pipeline-steg">
        <button onClick={hent} className="text-[11px] text-g-muted hover:text-g-green transition-colors">↻ Oppdater</button>
      </PageHeader>

      {/* Sammendrag */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Totalt', value: vods.length },
          { label: 'Fullført', value: antallComplete, color: 'text-g-green' },
          { label: 'Feilet', value: antallFeilet, color: 'text-red-400' },
          { label: 'Total kostnad', value: kost(totalKostnad), color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-2xl p-3 text-center">
            <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">{s.label}</p>
            <p className={`text-2xl font-black font-mono mt-1 ${s.color ?? 'text-g-green'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['alle', 'aktive', 'ferdige', 'feilet'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase rounded border transition-all ${filter === f ? 'border-g-green/30 text-g-green bg-g-green/10' : 'border-g-border text-g-muted hover:text-g-text'}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Jobb-liste */}
      {loading ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-8">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-g-border/40 rounded w-3/4" />
            <div className="h-4 bg-g-border/40 rounded w-1/2" />
            <div className="h-4 bg-g-border/40 rounded w-2/3" />
          </div>
        </div>
      ) : filtrert.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-6 text-center">
          <p className="text-sm text-g-muted">Ingen jobber.</p>
        </div>
      ) : filtrert.map(v => (
        <div key={v.id} className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
          {/* Jobb-header */}
          <div className="p-4 cursor-pointer flex items-start gap-3" onClick={() => setValgt(valgt === v.id ? null : v.id)}>
            <div className={`text-[11px] px-2 py-0.5 rounded border font-semibold uppercase flex-shrink-0 mt-0.5 ${STATUS_STIL[v.status] ?? STATUS_STIL.PENDING}`}>
              {v.status}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-g-text truncate">{v.title ?? 'Ukjent stream'}</p>
              <p className="text-[11px] text-g-muted">{v.category} · {new Date(v.created_at).toLocaleString('no-NO')}</p>
            </div>
            <div className="text-right flex-shrink-0 text-[11px] text-g-muted">
              {v.totalMs && <p className="font-mono">{tid(v.totalMs)}</p>}
              {v.totalKostnad && v.totalKostnad > 0 && <p className="text-yellow-400 font-mono">{kost(v.totalKostnad)}</p>}
            </div>
          </div>

          {/* Pipeline-steg */}
          <div className="px-4 pb-3">
            <div className="flex gap-1.5 overflow-x-auto">
              {STEG_REKKEFØLGE.map(stegNavn => {
                const s = v.stegStatus.find(x => x.steg === stegNavn);
                const stil = STATUS_STIL[s?.status ?? 'IKKE_STARTET'];
                return (
                  <div key={stegNavn} className={`flex-shrink-0 px-2 py-1 rounded border text-center min-w-[80px] ${stil}`}>
                    <p className="text-[11px] font-semibold uppercase">{stegNavn}</p>
                    <p className="text-[11px] mt-0.5">{s?.status === 'OK' || s?.status === 'COMPLETE' ? '✓' : s?.status === 'FAILED' || s?.status === 'FEILET' ? '✗' : s?.status ? '◎' : '○'}</p>
                    {s?.output && <p className="text-[11px] font-mono">{s.output}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detaljert logg */}
          {valgt === v.id && (
            <div className="border-t border-g-border p-4 space-y-2">
              {v.stegStatus.filter(s => s.status !== 'IKKE_STARTET').map(s => (
                <div key={s.steg} className={`p-3 rounded-lg border ${STATUS_STIL[s.status] ?? STATUS_STIL.PENDING}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{s.steg}</p>
                      {s.melding && <p className="text-[11px] mt-0.5 opacity-80">{s.melding}</p>}
                    </div>
                    <div className="text-right flex-shrink-0 text-[11px] font-mono">
                      {s.durationMs && <p>{tid(s.durationMs)}</p>}
                      {s.kostnad && s.kostnad > 0 && <p>{kost(s.kostnad)}</p>}
                      {s.output && <p>{s.output} items</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
