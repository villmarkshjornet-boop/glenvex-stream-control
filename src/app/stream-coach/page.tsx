'use client';

import { useEffect, useState } from 'react';

interface Session {
  id: string;
  title: string;
  game: string;
  startedAt: string;
  durationMinutes: number;
  peakViewers: number;
  avgViewers: number;
  chatMessages: number;
  subsGained: number;
  raidsDuring: number;
}

interface Analyse {
  fungerteBra: string[];
  fungerteIkke: string[];
  børGjentas: string[];
  børUnngås: string[];
  toppInsikt: string;
}

export default function StreamCoachPage() {
  const [history, setHistory] = useState<Session[]>([]);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stream-coach').then(r => r.json()).then(d => {
      setHistory(d.history ?? []);
      setAnalyse(d.analyse ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Stream Coach</h1>
        <p className="text-xs text-g-muted mt-0.5">AI-analyse av dine streams – hva fungerer og hva bør endres</p>
      </div>

      {loading ? <p className="text-xs text-g-muted p-5">Analyserer streams...</p> : history.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center">
          <p className="text-xs text-g-muted">Ingen stream-historikk ennå. Data samles automatisk når du streamer.</p>
        </div>
      ) : (
        <>
          {/* AI-analyse */}
          {analyse && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-g-green text-xl">◆</span>
                <div>
                  <p className="text-xs font-semibold text-g-muted uppercase tracking-widest">AI Topp-innsikt</p>
                  <p className="text-sm text-g-text mt-1 font-semibold">{analyse.toppInsikt}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '✓ Fungerte bra', items: analyse.fungerteBra, color: 'text-g-green' },
                  { label: '✗ Fungerte ikke', items: analyse.fungerteIkke, color: 'text-red-400' },
                  { label: '↻ Bør gjentas', items: analyse.børGjentas, color: 'text-blue-400' },
                  { label: '⚠ Bør unngås', items: analyse.børUnngås, color: 'text-yellow-400' },
                ].map(({ label, items, color }) => (
                  <div key={label} className="bg-g-bg border border-g-border rounded-lg p-3">
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${color}`}>{label}</p>
                    <ul className="space-y-1">
                      {items.map((item, i) => <li key={i} className="text-xs text-g-text">{item}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stream-historikk */}
          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Siste streams</h2>
            <div className="space-y-3">
              {history.slice(0, 10).map(s => (
                <div key={s.id} className="p-3 bg-g-bg border border-g-border rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs font-bold text-g-text">{s.game}</p>
                      <p className="text-[10px] text-g-muted">{s.title}</p>
                    </div>
                    <p className="text-[10px] text-g-muted">{new Date(s.startedAt).toLocaleDateString('no-NO')}</p>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[['Peak', s.peakViewers], ['Snitt', s.avgViewers], ['Min', s.durationMinutes], ['Chat', s.chatMessages], ['Subs', s.subsGained]].map(([l, v]) => (
                      <div key={l as string} className="text-center">
                        <p className="text-[9px] text-g-muted uppercase">{l}</p>
                        <p className="text-xs font-black text-g-green font-mono">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
