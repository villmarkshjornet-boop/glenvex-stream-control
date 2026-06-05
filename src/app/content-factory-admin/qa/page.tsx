'use client';

import { useEffect, useState } from 'react';

interface QAFeil { type: string; entitetId: string; felt: string; verdi: any; anbefaling: string; }
interface QARes {
  status: 'PASSED' | 'FAILED';
  sjekket: { vods: number; highlights: number };
  sammendrag: { nanRisiko: number; ugyldigDato: number; utenStartEnd: number; utenKategori: number; totalFeil: number };
  feil: QAFeil[];
}

export default function ContentFactoryQAPage() {
  const [res, setRes] = useState<QARes | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  async function kjørQA() {
    setLoading(true);
    const data = await fetch('/api/content-factory/qa').then(r => r.json()).catch(() => null);
    setRes(data);
    setLoading(false);
  }

  useEffect(() => { kjørQA(); }, []);

  const filtrertFeil = res?.feil.filter(f =>
    !filter || f.type.toLowerCase().includes(filter.toLowerCase()) || f.felt.toLowerCase().includes(filter.toLowerCase())
  ) ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Content Factory QA</h1>
          <p className="text-[10px] text-g-muted mt-0.5">Automatisk datavalidering – kjøres etter hver endring</p>
        </div>
        <button onClick={kjørQA} disabled={loading}
          className="px-4 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
          {loading ? '⏳ Kjører...' : '▶ Kjør QA'}
        </button>
      </div>

      {res && (
        <>
          {/* Status */}
          <div className={`rounded-xl p-6 border ${res.status === 'PASSED' ? 'border-g-green/30 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <div className="flex items-center gap-4">
              <p className={`text-4xl font-black ${res.status === 'PASSED' ? 'text-g-green' : 'text-red-400'}`}>
                {res.status === 'PASSED' ? '✓ PASSED' : '✗ FAILED'}
              </p>
              <div className="text-xs text-g-muted space-y-0.5">
                <p>Sjekket {res.sjekket.vods} VODs og {res.sjekket.highlights} highlights</p>
                <p>{res.sammendrag.totalFeil} feil funnet</p>
              </div>
            </div>
          </div>

          {/* Sammendrag */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'NaN-risiko (start/end)', value: res.sammendrag.nanRisiko, ok: res.sammendrag.nanRisiko === 0 },
              { label: 'Ugyldig dato', value: res.sammendrag.ugyldigDato, ok: res.sammendrag.ugyldigDato === 0 },
              { label: 'Uten kategori', value: res.sammendrag.utenKategori, ok: res.sammendrag.utenKategori === 0 },
              { label: 'Totale feil', value: res.sammendrag.totalFeil, ok: res.sammendrag.totalFeil === 0 },
            ].map(s => (
              <div key={s.label} className={`bg-g-card border rounded-lg p-3 text-center ${s.ok ? 'border-g-border' : 'border-red-500/30'}`}>
                <p className="text-[9px] text-g-muted uppercase tracking-widest leading-tight">{s.label}</p>
                <p className={`text-2xl font-black font-mono mt-1 ${s.ok ? 'text-g-green' : 'text-red-400'}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Feil-liste */}
          {res.feil.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-g-text">Datafeil ({res.feil.length})</p>
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrer..."
                  className="bg-g-bg border border-g-border rounded px-3 py-1 text-xs text-g-text outline-none focus:border-g-green/50 w-32" />
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filtrertFeil.map((f, i) => (
                  <div key={i} className="p-3 bg-g-bg border border-red-500/20 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-red-400 font-bold border border-red-400/30 px-1.5 py-0.5 rounded">{f.type}</span>
                      <span className="text-[9px] text-g-muted font-mono">{f.entitetId.slice(0, 12)}...</span>
                      <span className="text-[9px] text-yellow-400 font-bold">{f.felt}</span>
                      <span className="text-[9px] text-g-muted">= {String(f.verdi ?? 'null').slice(0, 30)}</span>
                    </div>
                    <p className="text-[10px] text-g-text">→ {f.anbefaling}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Definition of Done */}
          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Definition of Done</p>
            <div className="space-y-1.5">
              {[
                { tekst: 'Ingen NaN i UI', ok: res.sammendrag.nanRisiko === 0 },
                { tekst: 'Ingen Invalid Date', ok: res.sammendrag.ugyldigDato === 0 },
                { tekst: 'Alle highlights har kategori', ok: res.sammendrag.utenKategori === 0 },
                { tekst: 'Alle highlights har start/end tid', ok: res.sammendrag.utenStartEnd === 0 },
                { tekst: 'QA rapporterer PASSED', ok: res.status === 'PASSED' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={item.ok ? 'text-g-green' : 'text-red-400'}>{item.ok ? '✓' : '✗'}</span>
                  <span className={item.ok ? 'text-g-text' : 'text-red-400'}>{item.tekst}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
