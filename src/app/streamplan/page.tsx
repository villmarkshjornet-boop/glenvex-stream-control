'use client';

import { useEffect, useState } from 'react';

interface StreamDay {
  dag: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
}

const DAGER = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const TOM: StreamDay[] = DAGER.map(dag => ({ dag, tid: '20:00', spill: '', tittel: '', aktiv: false }));

export default function StreamplanPage() {
  const [plan, setPlan] = useState<StreamDay[]>(TOM);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postRes, setPostRes] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/streamplan').then(r => r.json()).then(d => {
      if (Array.isArray(d) && d.length > 0) setPlan(d);
    }).catch(() => {});
  }, []);

  function oppdater(i: number, felt: keyof StreamDay, verdi: any) {
    setPlan(prev => prev.map((d, idx) => idx === i ? { ...d, [felt]: verdi } : d));
  }

  async function lagre() {
    await fetch('/api/streamplan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function postTilDiscord() {
    setPosting(true);
    setPostRes(null);
    try {
      // Lagre først, så post
      await fetch('/api/streamplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      });

      const res = await fetch('/api/streamplan/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();

      if (res.ok) {
        setPostRes({ ok: true, msg: `✓ Postet ${data.antallDager} stream-dager til Discord og lagret i Content Library` });
      } else {
        setPostRes({ ok: false, msg: `✗ ${data.error}` });
      }
    } catch (e) {
      setPostRes({ ok: false, msg: `✗ Nettverksfeil: ${(e as Error).message}` });
    }
    setPosting(false);
  }

  const aktiveCount = plan.filter(d => d.aktiv).length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Streamplan</h1>
        <p className="text-xs text-g-muted mt-0.5">Planlegg ukentlige streams – lagres og postes til Discord</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
        <div className="divide-y divide-g-border">
          {plan.map((dag, i) => (
            <div key={dag.dag} className={`p-4 transition-all ${dag.aktiv ? 'bg-g-green/5' : ''}`}>
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  checked={dag.aktiv}
                  onChange={e => oppdater(i, 'aktiv', e.target.checked)}
                  className="accent-green-400 w-4 h-4"
                />
                <span className={`text-sm font-bold ${dag.aktiv ? 'text-g-green' : 'text-g-muted'}`}>
                  {dag.dag}
                </span>
                {dag.aktiv && dag.spill && (
                  <span className="text-xs text-g-muted ml-auto">{dag.tid} · {dag.spill}</span>
                )}
              </div>
              {dag.aktiv && (
                <div className="grid grid-cols-3 gap-2 pl-7">
                  <div>
                    <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tid</label>
                    <input
                      type="time"
                      value={dag.tid}
                      onChange={e => oppdater(i, 'tid', e.target.value)}
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Spill</label>
                    <input
                      value={dag.spill}
                      onChange={e => oppdater(i, 'spill', e.target.value)}
                      placeholder="Future RP"
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tittel (valgfritt)</label>
                    <input
                      value={dag.tittel}
                      onChange={e => oppdater(i, 'tittel', e.target.value)}
                      placeholder="Valgfri undertittel"
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Forhåndsvisning */}
      {aktiveCount > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Forhåndsvisning – Discord embed</p>
          <div className="border-l-2 border-l-g-green pl-4 space-y-1">
            <p className="text-xs font-bold text-g-text">📅 Streamplan denne uken</p>
            {plan.filter(d => d.aktiv).map(d => (
              <p key={d.dag} className="text-xs text-g-muted">
                <span className="text-g-text font-semibold">{d.dag}</span> kl. {d.tid} · {d.spill}{d.tittel ? ` – ${d.tittel}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={lagre}
          className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {lagret ? '✓ Lagret' : '◆ Lagre plan'}
        </button>
        <button onClick={postTilDiscord} disabled={posting || aktiveCount === 0}
          className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all disabled:opacity-40">
          {posting ? 'Poster...' : `Post ${aktiveCount > 0 ? `(${aktiveCount} dager)` : ''} til Discord`}
        </button>
      </div>

      {postRes && (
        <p className={`text-xs font-mono p-3 rounded-lg border ${postRes.ok ? 'text-g-green border-g-green/20 bg-g-green/5' : 'text-red-400 border-red-500/20 bg-red-500/5'}`}>
          {postRes.msg}
        </p>
      )}
    </div>
  );
}
