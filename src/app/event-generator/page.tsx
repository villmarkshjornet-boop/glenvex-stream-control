'use client';

import { useState } from 'react';

interface Event {
  tittel: string;
  beskrivelse: string;
  instruksjoner: string;
  premie: string;
  varighet: string;
}

const EVENT_TYPER = [
  { id: 'quiz', label: '🧠 Quiz', desc: 'Trivia og spørsmål' },
  { id: 'giveaway', label: '🎁 Giveaway', desc: 'Premie til vinner' },
  { id: 'tarkov', label: '🔫 Tarkov Challenge', desc: 'EFT community-utfordring' },
  { id: 'rp', label: '🚔 RP Event', desc: 'Future RP community-event' },
  { id: 'clip', label: '🎬 Clip Contest', desc: 'Beste clip vinner' },
  { id: 'kreativ', label: '🎨 Kreativt', desc: 'Fanart, ideer, voting' },
];

export default function EventGeneratorPage() {
  const [valgtType, setValgtType] = useState('');
  const [generert, setGenerert] = useState<Event | null>(null);
  const [loading, setLoading] = useState(false);
  const [publisert, setPublisert] = useState(false);

  async function generer(publiser: boolean) {
    if (!valgtType) return;
    setLoading(true);
    try {
      const res = await fetch('/api/events/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: valgtType, publiser }),
      });
      const data = await res.json() as Event;
      setGenerert(data);
      if (publiser) setPublisert(true);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Event Generator</h1>
        <p className="text-xs text-g-muted mt-0.5">AI genererer community-events – ett klikk for å poste til Discord</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Velg event-type</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EVENT_TYPER.map(t => (
            <button key={t.id} onClick={() => { setValgtType(t.id); setGenerert(null); setPublisert(false); }}
              className={`p-3 rounded-lg border text-left transition-all ${valgtType === t.id ? 'bg-g-green/10 border-g-green/30' : 'bg-g-bg border-g-border hover:border-g-green/20'}`}>
              <p className="text-sm">{t.label}</p>
              <p className="text-[10px] text-g-muted mt-0.5">{t.desc}</p>
            </button>
          ))}
        </div>

        {valgtType && (
          <div className="flex gap-3">
            <button onClick={() => generer(false)} disabled={loading}
              className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold uppercase rounded transition-all">
              {loading ? 'Genererer...' : '◆ Forhåndsvis'}
            </button>
            <button onClick={() => generer(true)} disabled={loading}
              className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold uppercase rounded transition-all">
              ◆ Generer og post til Discord
            </button>
          </div>
        )}
      </div>

      {generert && (
        <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
          {publisert && <p className="text-xs text-g-green font-bold">✓ Postet til Discord!</p>}
          <h2 className="text-sm font-black text-g-text">{generert.tittel}</h2>
          <p className="text-xs text-g-muted leading-relaxed">{generert.beskrivelse}</p>
          <div className="space-y-2">
            {[['Instruksjoner', generert.instruksjoner], ['Premie', generert.premie], ['Varighet', generert.varighet]].map(([l, v]) => (
              <div key={l} className="flex gap-2">
                <span className="text-[10px] text-g-muted uppercase tracking-widest w-24 flex-shrink-0 pt-0.5">{l}</span>
                <p className="text-xs text-g-text">{v}</p>
              </div>
            ))}
          </div>
          {!publisert && (
            <button onClick={async () => {
              setLoading(true);
              await fetch('/api/events/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: valgtType, publiser: true }),
              });
              setPublisert(true);
              setLoading(false);
            }} className="w-full py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
              ◆ Publiser til Discord
            </button>
          )}
        </div>
      )}
    </div>
  );
}
