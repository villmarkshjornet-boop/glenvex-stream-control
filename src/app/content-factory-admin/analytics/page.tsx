'use client';

import { useEffect, useState } from 'react';

interface Analytics {
  totaleVods: number;
  totaleHighlights: number;
  gjennomsnittsScore: number;
  mestBrukteKategori: string;
  gjennomsnittsKjøretid: number;
  totalKostnad: number;
  dagensKostnad: number;
  ukensKostnad: number;
  kategorier: { kategori: string; antall: number }[];
  sisteUkeStat: { dato: string; vods: number; highlights: number; kostnad: number }[];
}

export default function ContentFactoryAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/content-factory/analytics').then(r => r.json()).then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="max-w-4xl mx-auto p-8 text-center">
      <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
    </div>
  );

  if (!data) return <p className="text-xs text-red-400 p-8">Ingen data.</p>;

  const KAT_FARGE: Record<string, string> = {
    FUNNY: '#fbbf24', FAIL: '#f87171', CLUTCH: '#00ff41',
    RAGE: '#fb923c', REACTION: '#60a5fa', TACTICAL: '#a78bfa',
    RP_MOMENT: '#f472b6', EDUCATIONAL: '#22d3ee',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Analytics</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Content Factory statistikk og kostnader</p>
      </div>

      {/* Nøkkelmetrikker */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'VODs analysert', value: data.totaleVods },
          { label: 'Highlights funnet', value: data.totaleHighlights },
          { label: 'Gj.snitt score', value: `${data.gjennomsnittsScore}/100` },
          { label: 'Topp kategori', value: data.mestBrukteKategori || '–' },
          { label: 'Gj.snitt kjøretid', value: data.gjennomsnittsKjøretid ? `${Math.round(data.gjennomsnittsKjøretid/60000)}min` : '–' },
          { label: 'Total kostnad', value: `$${data.totalKostnad.toFixed(2)}` },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
            <p className="text-xl font-black text-g-green font-mono mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Kostnader */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">OpenAI-kostnader</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'I dag', value: data.dagensKostnad },
            { label: 'Denne uken', value: data.ukensKostnad },
            { label: 'Totalt', value: data.totalKostnad },
          ].map(s => (
            <div key={s.label} className="text-center p-3 bg-g-bg border border-g-border rounded-lg">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <p className="text-lg font-black text-yellow-400 font-mono mt-1">
                ${s.value.toFixed(3)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Kategori-fordeling */}
      {data.kategorier.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Highlight-kategorier</h2>
          <div className="space-y-2">
            {data.kategorier.map(k => {
              const maks = Math.max(...data.kategorier.map(x => x.antall));
              const pct = Math.round((k.antall / maks) * 100);
              return (
                <div key={k.kategori} className="flex items-center gap-3">
                  <span className="text-[9px] font-bold uppercase w-24 flex-shrink-0" style={{ color: KAT_FARGE[k.kategori] ?? '#888' }}>
                    {k.kategori}
                  </span>
                  <div className="flex-1 bg-g-border rounded-full h-2">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: KAT_FARGE[k.kategori] ?? '#888' }} />
                  </div>
                  <span className="text-xs text-g-muted w-8 text-right">{k.antall}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
