'use client';

import { useEffect, useState } from 'react';
import { PageHeader, ProgressBar, Spinner, EmptyState } from '@/components/ui';

interface ModerationStatus {
  health: number;
  positiv: number;
  nøytral: number;
  negativ: number;
  varsler: string[];
  siste: { type: string; melding: string; tid: string }[];
}

export default function ModerationPage() {
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/moderation').then(r => r.json()).then(d => { setStatus(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const healthColor = (status?.health ?? 0) >= 70 ? 'text-g-green' : (status?.health ?? 0) >= 40 ? 'text-yellow-400' : 'text-red-400';
  const healthBarColor = (status?.health ?? 0) >= 70 ? 'green' : (status?.health ?? 0) >= 40 ? 'yellow' : 'red';

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="AI Moderator" subtitle="Community health og automatisk moderasjonsanalyse" />

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-8 flex justify-center">
          <Spinner />
        </div>
      ) : !status ? (
        <EmptyState icon="◈" title="Ingen data" description="Ingen moderasjonsdata tilgjengelig." />
      ) : (
        <>
          {/* Health */}
          <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-4">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Community Health</p>
            <div className="flex items-center gap-4">
              <p className={`text-5xl font-black font-mono ${healthColor}`}>{status.health}</p>
              <div className="flex-1">
                <ProgressBar value={status.health} max={100} color={healthBarColor as any} size="md" showGlow />
                <p className="text-xs text-g-muted mt-1.5">
                  {status.health >= 70 ? 'God stemning' : status.health >= 40 ? 'Nøytral' : 'Behov for oppmerksomhet'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Positiv', status.positiv, 'text-g-green'],
                ['Nøytral', status.nøytral, 'text-g-muted'],
                ['Negativ', status.negativ, 'text-red-400'],
              ].map(([l, v, c]) => (
                <div key={l as string} className="text-center p-3 bg-g-bg border border-g-border rounded-xl">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{l}</p>
                  <p className={`text-xl font-black font-mono mt-1 ${c}`}>{v}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* Varsler */}
          {status.varsler.length > 0 && (
            <div className="bg-g-card border border-yellow-400/20 rounded-2xl p-5">
              <p className="text-[9px] text-yellow-400 uppercase tracking-widest font-bold mb-3">Varsler</p>
              {status.varsler.map((v, i) => (
                <p key={i} className="text-xs text-g-text mb-1 flex gap-2">
                  <span className="text-yellow-400">!</span>{v}
                </p>
              ))}
            </div>
          )}

          <div className="bg-g-card border border-g-border rounded-2xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Siste moderasjonslogg</p>
            {status.siste.length === 0 ? (
              <p className="text-xs text-g-muted">Ingen hendelser registrert.</p>
            ) : status.siste.map((s, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-g-border/30 last:border-0">
                <span className="text-[10px] text-g-muted font-mono">{s.tid}</span>
                <span className="text-[10px] text-g-muted">{s.type}</span>
                <span className="text-xs text-g-text">{s.melding}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
