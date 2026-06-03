'use client';

import { useState, useRef } from 'react';

export default function MerchPage() {
  const [form, setForm] = useState({ navn: '', beskrivelse: '', pris: '', lenke: '' });
  const [bildeUrl, setBildeUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);

  async function send() {
    if (!form.navn || !form.lenke) { setResultat('Navn og lenke er påkrevd.'); return; }
    setSending(true);
    const res = await fetch('/api/merch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, bildeUrl }),
    });
    setResultat(res.ok ? '✓ Merch-varsel postet i Discord og Twitch!' : '✗ Feil ved posting.');
    setSending(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Merch-varsling</h1>
        <p className="text-xs text-g-muted mt-0.5">Announcer nytt merch i Discord og Twitch-chat</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        {[
          { felt: 'navn', label: 'Produktnavn', placeholder: 'GLENVEX Hoodie' },
          { felt: 'pris', label: 'Pris', placeholder: '399 kr' },
          { felt: 'lenke', label: 'Kjøpslenke', placeholder: 'https://...' },
          { felt: 'bildeUrl', label: 'Bilde-URL (valgfritt)', placeholder: 'https://...' },
        ].map(({ felt, label, placeholder }) => (
          <div key={felt}>
            <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">{label}</label>
            <input
              value={felt === 'bildeUrl' ? bildeUrl : form[felt as keyof typeof form]}
              onChange={e => felt === 'bildeUrl' ? setBildeUrl(e.target.value) : setForm(prev => ({ ...prev, [felt]: e.target.value }))}
              placeholder={placeholder}
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none"
            />
          </div>
        ))}

        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Beskrivelse</label>
          <textarea
            value={form.beskrivelse}
            onChange={e => setForm(prev => ({ ...prev, beskrivelse: e.target.value }))}
            rows={3}
            placeholder="Beskriv produktet..."
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none resize-none"
          />
        </div>

        <button onClick={send} disabled={sending}
          className="w-full py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {sending ? 'Poster...' : '◆ Post merch-varsel'}
        </button>

        {resultat && <p className={`text-xs font-mono ${resultat.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{resultat}</p>}
      </div>
    </div>
  );
}
