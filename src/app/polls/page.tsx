'use client';

import { useState } from 'react';

export default function PollsPage() {
  const [spørsmål, setSpørsmål] = useState('');
  const [alternativer, setAlternativer] = useState(['', '', '', '']);
  const [sending, setSending] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);

  async function sendPoll() {
    const gyldigeAlt = alternativer.filter(a => a.trim());
    if (!spørsmål || gyldigeAlt.length < 2) {
      setResultat('Trenger spørsmål og minst 2 alternativer.');
      return;
    }
    setSending(true);
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spørsmål, alternativer: gyldigeAlt }),
    });
    setResultat(res.ok ? '✓ Poll postet i Discord!' : '✗ Feil ved posting.');
    setSending(false);
    if (res.ok) { setSpørsmål(''); setAlternativer(['', '', '', '']); }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Polls</h1>
        <p className="text-xs text-g-muted mt-0.5">Lag avstemninger som postes i Discord</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Spørsmål</label>
          <input value={spørsmål} onChange={e => setSpørsmål(e.target.value)}
            placeholder="Hvilket spill vil dere se neste?"
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none" />
        </div>

        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-2">Alternativer (maks 4)</label>
          <div className="space-y-2">
            {alternativer.map((alt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-g-muted text-xs w-4">{i + 1}.</span>
                <input value={alt} onChange={e => setAlternativer(prev => prev.map((a, idx) => idx === i ? e.target.value : a))}
                  placeholder={`Alternativ ${i + 1}`}
                  className="flex-1 bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none" />
              </div>
            ))}
          </div>
        </div>

        <button onClick={sendPoll} disabled={sending}
          className="w-full py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {sending ? 'Poster...' : '◆ Post poll til Discord'}
        </button>

        {resultat && <p className={`text-xs font-mono ${resultat.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{resultat}</p>}
      </div>
    </div>
  );
}
