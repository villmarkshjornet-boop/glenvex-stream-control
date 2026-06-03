'use client';

import { useEffect, useState } from 'react';

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

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Moderator</h1>
        <p className="text-xs text-g-muted mt-0.5">Community health og automatisk moderasjonsanalyse</p>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center">
          <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
        </div>
      ) : !status ? (
        <p className="text-xs text-g-muted">Ingen moderasjonsdata tilgjengelig.</p>
      ) : (
        <>
          {/* Health */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Community Health</h2>
            <div className="flex items-center gap-4">
              <p className={`text-5xl font-black font-mono ${healthColor}`}>{status.health}</p>
              <div className="flex-1">
                <div className="w-full bg-g-border rounded-full h-3 mb-2">
                  <div className="h-3 rounded-full transition-all bg-g-green" style={{ width: `${status.health}%` }} />
                </div>
                <p className="text-xs text-g-muted">{status.health >= 70 ? 'God stemning' : status.health >= 40 ? 'Nøytral' : 'Behov for oppmerksomhet'}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[['😊 Positiv', status.positiv, 'text-g-green'], ['😐 Nøytral', status.nøytral, 'text-g-muted'], ['😠 Negativ', status.negativ, 'text-red-400']].map(([l, v, c]) => (
                <div key={l as string} className="text-center p-3 bg-g-bg border border-g-border rounded">
                  <p className="text-xs text-g-muted">{l}</p>
                  <p className={`text-xl font-black font-mono mt-1 ${c}`}>{v}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* Varsler */}
          {status.varsler.length > 0 && (
            <div className="bg-g-card border border-yellow-400/20 rounded-lg p-5">
              <h2 className="text-xs text-yellow-400 font-semibold tracking-widest uppercase mb-3">⚠ Varsler</h2>
              {status.varsler.map((v, i) => <p key={i} className="text-xs text-g-text mb-1">• {v}</p>)}
            </div>
          )}

          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">Siste moderasjonslogg</h2>
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
