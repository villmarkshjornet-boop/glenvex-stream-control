'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { LiveData, VodStatus } from './types';

const VOD_STEPS = [
  { key: 'transcription', label: 'Transkripsjon', statuses: ['PENDING', 'ANALYZING'] },
  { key: 'highlights',    label: 'Highlights',    statuses: ['TRANSCRIBED'] },
  { key: 'clipping',      label: 'Klipp',         statuses: ['CLIPPING', 'READY_FOR_CLIP'] },
  { key: 'thumbnail',     label: 'Thumbnail',     statuses: [] },
  { key: 'done',          label: 'Ferdig',        statuses: ['COMPLETE'] },
];

function vodCurrentStep(vod: VodStatus): number {
  if (vod.status === 'COMPLETE') return 4;
  if (vod.clipping > 0 || vod.readyForClip > 0) return 3;
  if (vod.highlights > 0) return 3;
  if (vod.status === 'TRANSCRIBED') return 2;
  if (vod.status === 'ANALYZING')   return 1;
  return 0;
}

export function JobMonitor({ resultater, clipStatus, loading }: {
  resultater: VodStatus[]; clipStatus: LiveData['clipStatus'] | undefined; loading: boolean;
}) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  const aktive = resultater.filter(v => v.status !== 'COMPLETE' && v.status !== 'ERROR');
  const fullforte = resultater.filter(v => v.status === 'COMPLETE' || v.status === 'ERROR').slice(0, 3);

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Job Monitor – VOD Pipeline</p>
        <Link href="/content-factory-admin" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Content Factory →</Link>
      </div>

      {/* Aktive VODs med pipeline-steps */}
      {aktive.length === 0 && fullforte.length === 0 ? (
        <p className="text-xs text-g-muted">Ingen VODs å vise.</p>
      ) : (
        <div className="space-y-3">
          {[...aktive, ...fullforte].slice(0, 5).map(vod => {
            const step   = vodCurrentStep(vod);
            const isPågå = vod.status !== 'COMPLETE' && vod.status !== 'ERROR';
            return (
              <div key={vod.id} className={`rounded-lg border p-3 ${isPågå ? 'border-yellow-400/20 bg-yellow-400/[0.02]' : vod.status === 'ERROR' ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-g-border/30'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold text-g-text truncate flex-1">{vod.title}</p>
                  <span className="text-[9px] text-g-muted flex-shrink-0">{tidSiden(vod.createdAt)}</span>
                </div>

                {vod.status === 'ERROR' ? (
                  <p className="text-[9px] text-red-400">{vod.errorMessage?.slice(0, 100) ?? 'Ukjent feil'}</p>
                ) : (
                  <>
                    {/* Pipeline progress bar */}
                    <div className="flex items-center gap-1 mb-1.5">
                      {VOD_STEPS.map((s, i) => {
                        const done    = i < step;
                        const current = i === step && isPågå;
                        return (
                          <div key={s.key} className="flex items-center gap-1 flex-1">
                            <div className={`flex-1 h-1 rounded-full transition-all ${done ? 'bg-g-green' : current ? 'bg-yellow-400 animate-pulse' : 'bg-g-border/50'}`} />
                            {i < VOD_STEPS.length - 1 && (
                              <span className={`text-[7px] ${done ? 'text-g-green' : 'text-g-border/50'}`}>▸</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between">
                      {VOD_STEPS.map((s, i) => (
                        <span key={s.key} className={`text-[8px] ${i === step && isPågå ? 'text-yellow-400 font-bold' : i < step ? 'text-g-green' : 'text-g-border/50'}`}>
                          {i === step && isPågå ? `▶ ${s.label}` : s.label}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {vod.highlights > 0 && <span className="text-[9px] text-g-muted">{vod.highlights} highlights</span>}
                      {vod.klipp > 0 && <span className="text-[9px] text-g-green font-bold">{vod.klipp} klipp</span>}
                      {vod.clipping > 0 && <span className="text-[9px] text-yellow-400 font-bold animate-pulse">{vod.clipping} klipper</span>}
                      {vod.readyForClip > 0 && <span className="text-[9px] text-blue-400 font-bold">{vod.readyForClip} i kø</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Clip queue summary */}
      {clipStatus && (clipStatus.clipping > 0 || clipStatus.readyForClip > 0) && (
        <div className="mt-3 pt-3 border-t border-g-border/30 flex gap-2">
          {clipStatus.clipping > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-yellow-400/30 bg-yellow-400/5 text-[10px] font-bold text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Klipper {clipStatus.clipping} nå
            </span>
          )}
          {clipStatus.readyForClip > 0 && (
            <span className="px-2.5 py-1 rounded-full border border-blue-400/30 bg-blue-400/5 text-[10px] font-bold text-blue-400">
              {clipStatus.readyForClip} venter
            </span>
          )}
        </div>
      )}
    </div>
  );
}
