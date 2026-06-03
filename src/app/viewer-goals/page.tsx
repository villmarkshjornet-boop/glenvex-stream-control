'use client';

import { useEffect, useState } from 'react';

interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

export default function ViewerGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([
    { type: 'followers', label: 'Følgere', mal: 1000, gjeldende: 0, aktiv: true },
    { type: 'subscribers', label: 'Subscribers', mal: 50, gjeldende: 0, aktiv: false },
    { type: 'viewers', label: 'Gjennomsnittsseere', mal: 50, gjeldende: 0, aktiv: false },
  ]);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetch('/api/goals').then(r => r.json()).then(d => { if (d.length > 0) setGoals(d); }).catch(() => {});
  }, []);

  async function lagre() {
    await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goals) });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function postTilDiscord() {
    setPosting(true);
    const aktive = goals.filter(g => g.aktiv);
    for (const g of aktive) {
      const pct = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spørsmål: `🎯 Mål: ${g.label} – ${g.gjeldende}/${g.mal} (${pct}%)\n\`${bar}\``,
          alternativer: ['Hjelp oss nå målet!'],
        }),
      }).catch(() => {});
    }
    setPosting(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Viewer Goals</h1>
        <p className="text-xs text-g-muted mt-0.5">Sett mål og vis progress til community</p>
      </div>

      <div className="space-y-3">
        {goals.map((g, i) => {
          const pct = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
          return (
            <div key={g.type} className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={g.aktiv} onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, aktiv: e.target.checked } : x))} className="accent-green-400" />
                  <span className={`text-sm font-bold ${g.aktiv ? 'text-g-text' : 'text-g-muted'}`}>{g.label}</span>
                </label>
                <span className="text-g-green font-black font-mono">{pct}%</span>
              </div>

              {g.aktiv && (
                <>
                  <div className="w-full bg-g-border rounded-full h-2">
                    <div className="bg-g-green h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Gjeldende</label>
                      <input type="number" value={g.gjeldende} onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, gjeldende: +e.target.value } : x))}
                        className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                    </div>
                    <div>
                      <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Mål</label>
                      <input type="number" value={g.mal} onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, mal: +e.target.value } : x))}
                        className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button onClick={lagre} className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {lagret ? '✓ Lagret' : '◆ Lagre mål'}
        </button>
        <button onClick={postTilDiscord} disabled={posting} className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          Post til Discord
        </button>
      </div>
    </div>
  );
}
