'use client';

import { useState, useRef, useEffect } from 'react';
import { PageHeader } from '@/components/ui';

interface KanalForslag { id: string; navn: string; nyttNavn: string; type: string; }
interface Generert { karakterIntro: string; serverOppdatering: string; kanalForslag: KanalForslag[]; bildeUrl?: string; bildePrompt?: string; }
interface LagretKarakter { id: string; navn: string; server: string; rolle: string; beskrivelse: string; backstory: string; bildeUrl?: string; status: string; discordMsgId?: string; }

export default function RPManagerPage() {
  const [form, setForm] = useState({
    serverNavn: 'Future RP',
    karakterNavn: '',
    karakterRolle: '',
    karakterBeskrivelse: '',
    backstory: '',
    erstattNXT: true,
  });

  const [lagrede, setLagrede] = useState<LagretKarakter[]>([]);
  const [valgtKarakter, setValgtKarakter] = useState<LagretKarakter | null>(null);
  const [opplastetBilde, setOpplastetBilde] = useState<string | null>(null);
  const [generert, setGenerert] = useState<Generert | null>(null);
  const [redigert, setRedigert] = useState<Generert | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBilde, setLoadingBilde] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [resultater, setResultater] = useState<string[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [valgtKanaler, setValgtKanaler] = useState<Set<string>>(new Set());
  const [aktivTab, setAktivTab] = useState<'karakter' | 'server' | 'kanaler'>('karakter');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/rp-characters').then(r => r.json()).then(d => setLagrede(d ?? [])).catch(() => {});
  }, []);

  function lastInn(karakter: LagretKarakter) {
    setForm({
      serverNavn: karakter.server ?? 'Future RP',
      karakterNavn: karakter.navn,
      karakterRolle: karakter.rolle,
      karakterBeskrivelse: karakter.beskrivelse,
      backstory: karakter.backstory,
      erstattNXT: true,
    });
    setValgtKarakter(karakter);
    setOpplastetBilde(null);
    setGenerert(null);
    setRedigert(null);
    setResultater(null);
    setFeil(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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
    setFeil(null);
    try {
      const res = await fetch('/api/rp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const tekst = await res.text();
      if (!res.ok) { setFeil(`API feil ${res.status}: ${tekst.slice(0, 200)}`); return; }
      const data = JSON.parse(tekst) as Generert;
      setGenerert(data);
      setRedigert(data);
      setValgtKanaler(new Set((data.kanalForslag ?? []).map(k => k.id)));
    } catch (e) {
      setFeil('Nettverksfeil: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function genererBilde() {
    if (!redigert) return;
    setLoadingBilde(true);
    try {
      const res = await fetch('/api/rp/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: (redigert as Generert).bildePrompt }),
      });
      const data = await res.json();
      if (data.bildeUrl) setRedigert(prev => prev ? { ...prev, bildeUrl: data.bildeUrl } : prev);
      else if (data.error) setFeil(`Bilde feil: ${data.error}`);
    } catch (e) {
      setFeil('Bilde feil: ' + (e as Error).message);
    } finally {
      setLoadingBilde(false);
    }
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
          gammelMsgId: valgtKarakter?.discordMsgId,
        }),
      });
      const data = await res.json();
      setResultater(data.resultater ?? []);

      // Lagre/oppdater karakter i vault
      const karakterData = {
        navn: form.karakterNavn,
        server: form.serverNavn,
        rolle: form.karakterRolle,
        beskrivelse: form.karakterBeskrivelse,
        backstory: form.backstory,
        bildeUrl: opplastetBilde ?? redigert.bildeUrl,
        status: 'aktiv',
      };

      if (valgtKarakter?.id) {
        await fetch('/api/rp-characters', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: valgtKarakter.id, ...karakterData }),
        });
      } else {
        await fetch('/api/rp-characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...karakterData, karakterIntro: redigert.karakterIntro }),
        });
      }

      // Oppdater listen
      fetch('/api/rp-characters').then(r => r.json()).then(d => setLagrede(d ?? []));
    } catch (e) {
      setResultater([`✗ Feil: ${(e as Error).message}`]);
    } finally {
      setPublishing(false);
    }
  }

  const harValgte = valgtKanaler.size > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="RP Manager" subtitle="Administrer karakterer og RP-server — klikk på en karakter for å laste den inn" />

      {/* Lagrede karakterer */}
      {lagrede.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Lagrede karakterer – klikk for å laste inn</p>
          <div className="flex gap-2 flex-wrap">
            {lagrede.map(k => (
              <button key={k.id} onClick={() => lastInn(k)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all duration-200 ${
                  valgtKarakter?.id === k.id
                    ? 'border-g-green/40 bg-g-green/10 text-g-green'
                    : 'border-g-border text-g-muted hover:border-g-green/30 hover:text-g-text'
                }`}>
                {k.bildeUrl && (
                  <img src={k.bildeUrl} alt={k.navn} className="w-6 h-6 rounded-full object-cover border border-g-border" />
                )}
                <span>{k.navn}</span>
                <span className="text-[11px] opacity-60">{k.server}</span>
              </button>
            ))}
            <button onClick={() => { setValgtKarakter(null); setForm({ serverNavn: 'Future RP', karakterNavn: '', karakterRolle: '', karakterBeskrivelse: '', backstory: '', erstattNXT: true }); setGenerert(null); setRedigert(null); }}
              className="px-3 py-2 rounded-lg border border-dashed border-g-border text-[11px] text-g-muted hover:text-g-text hover:border-g-green/30 transition-all duration-200">
              + Ny karakter
            </button>
          </div>
        </div>
      )}

      {/* Skjema */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">
            {valgtKarakter ? `Redigerer: ${valgtKarakter.navn}` : 'Ny karakter'}
          </p>
          {valgtKarakter && (
            <span className="text-[11px] font-medium bg-g-green/15 text-g-green px-2 py-0.5 rounded-full">Lastet inn</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Server / RP-navn</label>
            <input value={form.serverNavn} onChange={e => oppdater('serverNavn', e.target.value)}
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200" placeholder="Future RP" />
          </div>
          <div>
            <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Karakternavn</label>
            <input value={form.karakterNavn} onChange={e => oppdater('karakterNavn', e.target.value)}
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200" placeholder="Mats Haugland" />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Rolle / Yrke</label>
          <input value={form.karakterRolle} onChange={e => oppdater('karakterRolle', e.target.value)}
            className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200" placeholder="Politibetjent, regelrytter, galning" />
        </div>

        <div>
          <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Karakterbeskrivelse</label>
          <textarea value={form.karakterBeskrivelse} onChange={e => oppdater('karakterBeskrivelse', e.target.value)} rows={3}
            className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none"
            placeholder="Kjøreglad, jævel på å skyte..." />
        </div>

        <div>
          <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Backstory</label>
          <textarea value={form.backstory} onChange={e => oppdater('backstory', e.target.value)} rows={3}
            className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none"
            placeholder="Bakgrunnshistorien til karakteren..." />
        </div>

        {/* Bilde */}
        <div>
          <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Bilde (valgfritt – DALL-E genereres etter innhold)</label>
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="px-4 py-2 border border-g-border rounded-lg text-sm text-g-muted hover:text-g-text hover:border-g-green/30 transition-all duration-200">
              Last opp bilde
            </button>
            {(opplastetBilde ?? valgtKarakter?.bildeUrl) && (
              <div className="flex items-center gap-2">
                <img src={opplastetBilde ?? valgtKarakter?.bildeUrl} alt="Karakter"
                  className="w-10 h-10 rounded object-cover border border-g-border" />
                <button onClick={() => setOpplastetBilde(null)} className="text-[11px] text-red-400 hover:text-red-300 transition-colors">Fjern</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={håndterBildeOpplasting} />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.erstattNXT} onChange={e => oppdater('erstattNXT', e.target.checked)} className="accent-green-400" />
          <span className="text-sm text-g-text">Erstatt NXT-referanser med {form.serverNavn || 'Future RP'} i Discord</span>
        </label>

        <button onClick={generer} disabled={loading || !form.karakterNavn}
          className="w-full py-2.5 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium tracking-widest uppercase rounded-lg transition-all duration-200 disabled:opacity-50">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              Genererer innhold...
            </span>
          ) : valgtKarakter ? `◆ Regenerer ${valgtKarakter.navn}` : '◆ Generer innhold'}
        </button>

        {feil && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            ✗ {feil}
          </div>
        )}
      </div>

      {/* Forhåndsvisning */}
      {redigert && (
        <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
          <div className="flex border-b border-g-border">
            {(['karakter', 'server', 'kanaler'] as const).map(tab => (
              <button key={tab} onClick={() => setAktivTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold tracking-wider uppercase transition-all ${
                  aktivTab === tab ? 'text-g-green border-b-2 border-g-green bg-g-green/5' : 'text-g-muted hover:text-g-text'
                }`}>
                {tab === 'karakter' ? 'Karakterkort' : tab === 'server' ? 'Servermelding' : `Kanalendringer (${redigert.kanalForslag.length})`}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {aktivTab === 'karakter' && (
              <>
                {(opplastetBilde ?? redigert.bildeUrl) ? (
                  <img src={opplastetBilde ?? redigert.bildeUrl} alt="Karakterbilde"
                    className="w-full max-h-64 object-cover rounded-lg border border-g-border" />
                ) : (
                  <button onClick={genererBilde} disabled={loadingBilde}
                    className="w-full py-2.5 border border-dashed border-g-border rounded-lg text-sm text-g-muted hover:text-g-text hover:border-g-green/30 transition-all duration-200">
                    {loadingBilde ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                        Genererer bilde via Railway (DALL-E 3)...
                      </span>
                    ) : '◆ Generer karakterbilde med DALL-E 3'}
                  </button>
                )}
                <textarea value={redigert.karakterIntro} onChange={e => setRedigert(prev => prev ? { ...prev, karakterIntro: e.target.value } : prev)}
                  rows={10} className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none leading-relaxed" />
              </>
            )}

            {aktivTab === 'server' && (
              <textarea value={redigert.serverOppdatering} onChange={e => setRedigert(prev => prev ? { ...prev, serverOppdatering: e.target.value } : prev)}
                rows={6} className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none leading-relaxed" />
            )}

            {aktivTab === 'kanaler' && (
              <div className="space-y-2">
                {redigert.kanalForslag.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-g-muted">Ingen NXT-kanaler funnet.</p>
                  </div>
                ) : redigert.kanalForslag.map(k => (
                  <label key={k.id} className="flex items-center gap-3 py-2 cursor-pointer border-b border-g-border/30 last:border-0">
                    <input type="checkbox" checked={valgtKanaler.has(k.id)}
                      onChange={e => {
                        const next = new Set(valgtKanaler);
                        e.target.checked ? next.add(k.id) : next.delete(k.id);
                        setValgtKanaler(next);
                      }} className="accent-green-400" />
                    <span className="text-xs text-g-muted font-mono">#{k.navn}</span>
                    <span className="text-g-muted text-xs">→</span>
                    <span className="text-xs text-g-green font-mono">#{k.nyttNavn}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="px-5 pb-5 space-y-2">
            <button onClick={publiser} disabled={publishing}
              className="w-full py-2.5 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium tracking-widest uppercase rounded-lg transition-all duration-200">
              {publishing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                  Publiserer...
                </span>
              ) : valgtKarakter ? `◆ Oppdater og publiser ${valgtKarakter.navn}` : '◆ Godkjenn og publiser til Discord'}
            </button>

            {resultater && (
              <div className="border border-g-border rounded-lg p-3 space-y-1">
                {resultater.map((r, i) => (
                  <p key={i} className={`text-xs font-mono ${r.startsWith('✓') ? 'text-g-green' : r.startsWith('  ↳') ? 'text-g-muted pl-3' : 'text-red-400'}`}>{r}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
