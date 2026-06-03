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

  useEffect(() => {
    fetch('/api/streamplan').then(r => r.json()).then(d => {
      if (d.length > 0) setPlan(d);
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
    const aktive = plan.filter(d => d.aktiv);
    const tekst = aktive.length === 0
      ? 'Ingen streams planlagt denne uken.'
      : aktive.map(d => `**${d.dag}** kl. ${d.tid} – ${d.spill}${d.tittel ? ` – ${d.tittel}` : ''}`).join('\n');

    const kanalId = process.env.NEXT_PUBLIC_CHAT_CHANNEL_ID;

    await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spørsmål: '📅 Streamplan denne uken',
        alternativer: aktive.slice(0, 4).map(d => `${d.dag} ${d.tid} – ${d.spill}`),
      }),
    }).catch(() => {});

    // Post som vanlig melding
    await fetch('/api/discord/test-live', { method: 'POST' }).catch(() => {});
    setPosting(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Streamplan</h1>
        <p className="text-xs text-g-muted mt-0.5">Planlegg ukentlige streams og post til Discord</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg overflow-hidden">
        <div className="divide-y divide-g-border">
          {plan.map((dag, i) => (
            <div key={dag.dag} className={`p-4 transition-all ${dag.aktiv ? 'bg-g-green/5' : ''}`}>
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="checkbox"
                  checked={dag.aktiv}
                  onChange={e => oppdater(i, 'aktiv', e.target.checked)}
                  className="accent-green-400 w-4 h-4"
                />
                <span className={`text-sm font-bold tracking-wide ${dag.aktiv ? 'text-g-green' : 'text-g-muted'}`}>
                  {dag.dag}
                </span>
              </div>
              {dag.aktiv && (
                <div className="grid grid-cols-3 gap-2 pl-7">
                  <div>
                    <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Tid</label>
                    <input
                      type="time"
                      value={dag.tid}
                      onChange={e => oppdater(i, 'tid', e.target.value)}
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Spill</label>
                    <input
                      value={dag.spill}
                      onChange={e => oppdater(i, 'spill', e.target.value)}
                      placeholder="Future RP"
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Tittel</label>
                    <input
                      value={dag.tittel}
                      onChange={e => oppdater(i, 'tittel', e.target.value)}
                      placeholder="Valgfri tittel"
                      className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={lagre} className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {lagret ? '✓ Lagret' : '◆ Lagre plan'}
        </button>
        <button onClick={postTilDiscord} disabled={posting} className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {posting ? 'Poster...' : 'Post til Discord'}
        </button>
      </div>
    </div>
  );
}
