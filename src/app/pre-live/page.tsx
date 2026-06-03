'use client';

import { useState } from 'react';

export default function PreLivePage() {
  const [spill, setSpill] = useState('');
  const [tid30, setTid30] = useState('');
  const [tid15, setTid15] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [resultater, setResultater] = useState<Record<string, string>>({});

  async function sendMelding(type: '30min' | '15min' | 'live') {
    setSending(type);
    try {
      const res = await fetch('/api/pre-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, spill }),
      });
      const data = await res.json();
      setResultater(prev => ({ ...prev, [type]: data.ok ? '✓ Sendt!' : `✗ ${data.error ?? 'Feil'}` }));
    } catch (e) {
      setResultater(prev => ({ ...prev, [type]: `✗ ${(e as Error).message}` }));
    }
    setSending(null);
  }

  async function settTimer(minutter: number, type: '30min' | '15min') {
    const dato = new Date();
    dato.setMinutes(dato.getMinutes() + minutter);
    if (type === '30min') setTid30(dato.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }));
    else setTid15(dato.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }));

    // Sett faktisk timer i nettleseren
    setTimeout(() => sendMelding(type), minutter * 60 * 1000);
    setResultater(prev => ({ ...prev, [type]: `⏰ Planlagt kl. ${dato.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}` }));
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Pre-Live Hype</h1>
        <p className="text-xs text-g-muted mt-0.5">Automatiser hype-meldinger i Discord før og ved stream-start</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Spill / Innhold</label>
          <input value={spill} onChange={e => setSpill(e.target.value)} placeholder="Future RP"
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none" />
        </div>

        <div className="space-y-3">
          {[
            { label: '30 min før', type: '30min' as const, minutter: 30, melding: '"GLENVEX går live om 30 minutter! Gjør klar chatten."' },
            { label: '15 min før', type: '15min' as const, minutter: 15, melding: '"Snart tid! Stream starter om 15 minutter."' },
            { label: 'Live nå', type: 'live' as const, minutter: 0, melding: '"GLENVEX er nå LIVE! Kom inn!"' },
          ].map(({ label, type, minutter, melding }) => (
            <div key={type} className="p-4 bg-g-bg border border-g-border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-g-text">{label}</p>
                {resultater[type] && (
                  <span className={`text-[10px] font-mono ${resultater[type].startsWith('✓') || resultater[type].startsWith('⏰') ? 'text-g-green' : 'text-red-400'}`}>
                    {resultater[type]}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-g-muted italic mb-3">{melding}</p>
              <div className="flex gap-2">
                <button onClick={() => sendMelding(type)} disabled={sending === type}
                  className="flex-1 py-1.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
                  {sending === type ? 'Sender...' : 'Send nå'}
                </button>
                {minutter > 0 && (
                  <button onClick={() => settTimer(minutter, type as '30min' | '15min')}
                    className="flex-1 py-1.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold rounded transition-all">
                    ⏰ Start nedtelling ({minutter} min)
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-4">
        <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-2">Automatisk</p>
        <p className="text-xs text-g-muted">Boten poster automatisk en hype-melding i Discord når du går live. Dette skjer via live-deteksjon i Railway.</p>
      </div>
    </div>
  );
}
