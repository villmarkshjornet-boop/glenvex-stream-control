'use client';

import { useState, useRef } from 'react';

interface KanalForslag {
  id: string;
  navn: string;
  nyttNavn: string;
  type: string;
}

interface Generert {
  karakterIntro: string;
  serverOppdatering: string;
  kanalForslag: KanalForslag[];
  bildeUrl?: string;
  bildePrompt?: string;
}

export default function RPManagerPage() {
  const [form, setForm] = useState({
    serverNavn: 'Future RP',
    karakterNavn: '',
    karakterRolle: '',
    karakterBeskrivelse: '',
    backstory: '',
    erstattNXT: true,
  });

  const [opplastetBilde, setOpplastetBilde] = useState<string | null>(null);
  const [generert, setGenerert] = useState<Generert | null>(null);
  const [redigert, setRedigert] = useState<Generert | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBilde, setLoadingBilde] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [resultater, setResultater] = useState<string[] | null>(null);
  const [valgtKanaler, setValgtKanaler] = useState<Set<string>>(new Set());
  const [aktivTab, setAktivTab] = useState<'karakter' | 'server' | 'kanaler'>('karakter');
  const fileRef = useRef<HTMLInputElement>(null);

  function oppdater(felt: string, verdi: string | boolean) {
    setForm(prev => ({ ...prev, [felt]: verdi }));
  }

  function håndterBildeOpplasting(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil) return;
    const reader = new FileReader();
    reader.onload = () => setOpplastetBilde(reader.result as string);
    reader.readAsDataURL(fil);
  }

  async function generer() {
    setLoading(true);
    setGenerert(null);
    setResultater(null);
    try {
      const res = await fetch('/api/rp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Generert;
      setGenerert(data);
      setRedigert(data);
      setValgtKanaler(new Set(data.kanalForslag.map(k => k.id)));
    } catch (e) {
      alert('Feil ved generering: ' + (e as Error).message);
    }
    setLoading(false);
  }

  async function genererBilde() {
    if (!redigert) return;
    setLoadingBilde(true);
    try {
      const res = await fetch('/api/rp/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: redigert.bildePrompt }),
      });
      const data = await res.json();
      if (data.bildeUrl) setRedigert(prev => prev ? { ...prev, bildeUrl: data.bildeUrl } : prev);
    } catch {}
    setLoadingBilde(false);
  }

  async function publiser() {
    if (!redigert) return;
    setPublishing(true);
    setResultater(null);
    try {
      const res = await fetch('/api/rp/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          karakterIntro: redigert.karakterIntro,
          serverOppdatering: redigert.serverOppdatering,
          bildeUrl: opplastetBilde ?? redigert.bildeUrl,
          kanalForslag: redigert.kanalForslag.filter(k => valgtKanaler.has(k.id)),
          karakterNavn: form.karakterNavn,
          serverNavn: form.serverNavn,
        }),
      });
      const data = await res.json();
      setResultater(data.resultater ?? []);
    } catch (e) {
      setResultater([`✗ Feil: ${(e as Error).message}`]);
    }
    setPublishing(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">RP Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Administrer karakterer og RP-server – generer og publiser til Discord</p>
      </div>

      {/* Skjema */}
      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Karakterinfo</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Server / RP-navn</label>
            <input
              value={form.serverNavn}
              onChange={e => oppdater('serverNavn', e.target.value)}
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none"
              placeholder="Future RP"
            />
          </div>
          <div>
            <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Karakternavn</label>
            <input
              value={form.karakterNavn}
              onChange={e => oppdater('karakterNavn', e.target.value)}
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none"
              placeholder="Mats Haugland"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Rolle / Yrke</label>
          <input
            value={form.karakterRolle}
            onChange={e => oppdater('karakterRolle', e.target.value)}
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none"
            placeholder="Politibetjent, regelrytter, galning"
          />
        </div>

        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Karakterbeskrivelse</label>
          <textarea
            value={form.karakterBeskrivelse}
            onChange={e => oppdater('karakterBeskrivelse', e.target.value)}
            rows={3}
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none resize-none"
            placeholder="Kjøreglad, jævel på å skyte, tar loven på alvor..."
          />
        </div>

        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Backstory</label>
          <textarea
            value={form.backstory}
            onChange={e => oppdater('backstory', e.target.value)}
            rows={3}
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:border-g-green/50 outline-none resize-none"
            placeholder="Bakgrunnshistorien til karakteren..."
          />
        </div>

        {/* Bilde-opplasting */}
        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-widest block mb-1">Bilde av karakteren (valgfritt)</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
            >
              Last opp bilde
            </button>
            {opplastetBilde && (
              <div className="flex items-center gap-2">
                <img src={opplastetBilde} alt="Karakter" className="w-10 h-10 rounded object-cover border border-g-border" />
                <button onClick={() => setOpplastetBilde(null)} className="text-[10px] text-red-400 hover:text-red-300">Fjern</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={håndterBildeOpplasting} />
          </div>
          <p className="text-[10px] text-g-muted mt-1">Laster du ikke opp bilde genereres ett med DALL-E automatisk.</p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.erstattNXT}
            onChange={e => oppdater('erstattNXT', e.target.checked)}
            className="accent-green-400"
          />
          <span className="text-xs text-g-text">Erstatt NXT-referanser med {form.serverNavn || 'Future RP'} i Discord</span>
        </label>

        <button
          onClick={generer}
          disabled={loading || !form.karakterNavn}
          className="w-full py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 hover:border-g-green/40 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              Genererer innhold...
            </span>
          ) : '◆ Generer innhold'}
        </button>
      </div>

      {/* Forhåndsvisning */}
      {redigert && (
        <div className="bg-g-card border border-g-border rounded-lg overflow-hidden">
          <div className="flex border-b border-g-border">
            {(['karakter', 'server', 'kanaler'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAktivTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold tracking-wider transition-all ${
                  aktivTab === tab
                    ? 'text-g-green border-b-2 border-g-green bg-g-green/5'
                    : 'text-g-muted hover:text-g-text'
                }`}
              >
                {tab === 'karakter' ? 'Karakterkort' : tab === 'server' ? 'Servermelding' : `Kanalendringer (${redigert.kanalForslag.length})`}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {aktivTab === 'karakter' && (
              <>
                {(opplastetBilde ?? redigert.bildeUrl) ? (
                  <img
                    src={opplastetBilde ?? redigert.bildeUrl}
                    alt="Karakterbilde"
                    className="w-full max-h-64 object-cover rounded-lg border border-g-border"
                  />
                ) : (
                  <button
                    onClick={genererBilde}
                    disabled={loadingBilde}
                    className="w-full py-2 border border-dashed border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
                  >
                    {loadingBilde ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                        Genererer bilde med DALL-E...
                      </span>
                    ) : '◆ Generer karakterbilde med DALL-E'}
                  </button>
                )}
                <textarea
                  value={redigert.karakterIntro}
                  onChange={e => setRedigert(prev => prev ? { ...prev, karakterIntro: e.target.value } : prev)}
                  rows={10}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono focus:border-g-green/50 outline-none resize-none leading-relaxed"
                />
              </>
            )}

            {aktivTab === 'server' && (
              <textarea
                value={redigert.serverOppdatering}
                onChange={e => setRedigert(prev => prev ? { ...prev, serverOppdatering: e.target.value } : prev)}
                rows={6}
                className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono focus:border-g-green/50 outline-none resize-none leading-relaxed"
              />
            )}

            {aktivTab === 'kanaler' && (
              <div className="space-y-2">
                {redigert.kanalForslag.length === 0 ? (
                  <p className="text-xs text-g-muted">Ingen NXT-kanaler funnet.</p>
                ) : redigert.kanalForslag.map(k => (
                  <label key={k.id} className="flex items-center gap-3 py-2 cursor-pointer border-b border-g-border/30 last:border-0">
                    <input
                      type="checkbox"
                      checked={valgtKanaler.has(k.id)}
                      onChange={e => {
                        const next = new Set(valgtKanaler);
                        e.target.checked ? next.add(k.id) : next.delete(k.id);
                        setValgtKanaler(next);
                      }}
                      className="accent-green-400"
                    />
                    <span className="text-xs text-g-muted font-mono">#{k.navn}</span>
                    <span className="text-g-muted text-xs">→</span>
                    <span className="text-xs text-g-green font-mono">#{k.nyttNavn}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
            <button
              onClick={publiser}
              disabled={publishing}
              className="w-full py-2.5 bg-g-green/20 border border-g-green/40 hover:bg-g-green/30 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all"
            >
              {publishing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                  Publiserer...
                </span>
              ) : '◆ Godkjenn og publiser til Discord'}
            </button>
          </div>

          {resultater && (
            <div className="px-5 pb-5 space-y-1">
              {resultater.map((r, i) => (
                <p key={i} className={`text-xs font-mono ${r.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{r}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
