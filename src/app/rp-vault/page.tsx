'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';

interface RPCharacter {
  id: string;
  navn: string;
  kallenavn?: string;
  server: string;
  rolle: string;
  beskrivelse: string;
  backstory: string;
  fraksjon?: string;
  bildeUrl?: string;
  status: string;
  discordMsgId?: string;
  opprettet: string;
  endret: string;
  relasjoner: any[];
  konflikter: string[];
}

const STATUS_STIL: Record<string, string> = {
  aktiv: 'text-g-green border-g-green/30 bg-g-green/10',
  inaktiv: 'text-g-muted border-g-border bg-g-bg',
  arkivert: 'text-g-muted border-g-border opacity-50',
};

export default function RPVaultPage() {
  const [chars, setChars] = useState<RPCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [søk, setSøk] = useState('');
  const [valgt, setValgt] = useState<RPCharacter | null>(null);
  const [visSlettDialog, setVisSlettDialog] = useState(false);
  const [redigerer, setRedigerer] = useState(false);
  const [form, setForm] = useState<Partial<RPCharacter>>({});

  const hent = () => {
    setLoading(true);
    fetch('/api/rp-characters').then(r => r.json()).then(d => { setChars(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { hent(); }, []);

  async function slett(slettDiscord: boolean) {
    if (!valgt) return;
    await fetch('/api/rp-characters', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: valgt.id, slettDiscord }) });
    setValgt(null);
    setVisSlettDialog(false);
    hent();
  }

  async function lagre() {
    if (!valgt) return;
    await fetch('/api/rp-characters', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: valgt.id, ...form }) });
    setRedigerer(false);
    hent();
  }

  const filtrerte = chars.filter(c =>
    c.navn.toLowerCase().includes(søk.toLowerCase()) ||
    c.rolle.toLowerCase().includes(søk.toLowerCase()) ||
    c.server.toLowerCase().includes(søk.toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="RP Character Vault" subtitle="Alle lagrede RP-karakterer — full oversikt og administrasjon" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Totalt karakterer', value: chars.length },
          { label: 'Aktive', value: chars.filter(c => c.status === 'aktiv').length },
          { label: 'Publisert på Discord', value: chars.filter(c => c.discordMsgId).length },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-2xl p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
            <p className="text-2xl font-black text-g-green font-mono mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Liste */}
        <div className="lg:col-span-2 space-y-3">
          <input value={søk} onChange={e => setSøk(e.target.value)} placeholder="Søk i karakterer..."
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />

          {loading ? <p className="text-xs text-g-muted">Laster...</p> :
           filtrerte.length === 0 ? (
            <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
              <p className="text-xs text-g-muted">Ingen karakterer. Opprett karakterer via RP Manager.</p>
            </div>
          ) : filtrerte.map(c => (
            <div key={c.id}
              onClick={() => { setValgt(valgt?.id === c.id ? null : c); setForm(c); setRedigerer(false); }}
              className={`bg-g-card border rounded-2xl overflow-hidden cursor-pointer transition-all hover:border-g-green/20 ${valgt?.id === c.id ? 'border-g-green/30' : 'border-g-border'}`}>
              <div className="flex gap-3 p-4">
                {c.bildeUrl ? (
                  <img src={c.bildeUrl} alt={c.navn} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-g-border" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl font-black text-g-green">{c.navn[0]}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-black text-g-text">{c.navn}</p>
                    {c.kallenavn && <p className="text-xs text-g-muted">"{c.kallenavn}"</p>}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ml-auto flex-shrink-0 ${STATUS_STIL[c.status] ?? STATUS_STIL.inaktiv}`}>{c.status}</span>
                  </div>
                  <p className="text-xs text-g-green">{c.rolle} • {c.server}</p>
                  {c.fraksjon && <p className="text-[10px] text-g-muted">{c.fraksjon}</p>}
                  <p className="text-[10px] text-g-muted mt-1 line-clamp-1">{c.beskrivelse}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Sidepanel */}
        {valgt && (
          <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-4 sticky top-4">
            <div className="flex justify-between items-start">
              <p className="text-xs font-black text-g-text">{valgt.navn}</p>
              <button onClick={() => setValgt(null)} className="text-g-muted hover:text-g-text text-xs">✕</button>
            </div>

            {valgt.bildeUrl && (
              <img src={valgt.bildeUrl} alt={valgt.navn} className="w-full rounded-lg border border-g-border" />
            )}

            {!redigerer ? (
              <div className="space-y-2 text-xs">
                {[['Rolle', valgt.rolle], ['Server', valgt.server], ['Fraksjon', valgt.fraksjon ?? '–']].map(([l, v]) => (
                  <div key={l} className="flex justify-between py-1 border-b border-g-border/30 last:border-0">
                    <span className="text-g-muted">{l}</span>
                    <span className="text-g-text">{v}</span>
                  </div>
                ))}
                <div>
                  <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Beskrivelse</p>
                  <p className="text-xs text-g-text leading-relaxed">{valgt.beskrivelse}</p>
                </div>
                {valgt.discordMsgId && (
                  <p className="text-[9px] text-g-green">✓ Publisert på Discord</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { felt: 'kallenavn', label: 'Kallenavn', ph: '' },
                  { felt: 'fraksjon', label: 'Fraksjon', ph: 'Los Santos PD...' },
                ].map(({ felt, label, ph }) => (
                  <div key={felt}>
                    <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">{label}</p>
                    <input value={(form as any)[felt] ?? ''} onChange={e => setForm(p => ({ ...p, [felt]: e.target.value }))} placeholder={ph}
                      className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                  </div>
                ))}
                <div>
                  <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Beskrivelse</p>
                  <textarea value={form.beskrivelse ?? ''} onChange={e => setForm(p => ({ ...p, beskrivelse: e.target.value }))} rows={3}
                    className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text resize-none outline-none focus:border-g-green/50" />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {redigerer ? (
                <>
                  <button onClick={lagre} className="w-full py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">Lagre</button>
                  <button onClick={() => setRedigerer(false)} className="w-full py-2 border border-g-border text-g-muted text-xs font-bold rounded transition-all">Avbryt</button>
                </>
              ) : (
                <>
                  <button onClick={() => setRedigerer(true)} className="w-full py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">Rediger</button>
                  <button onClick={() => fetch('/api/rp-characters', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: valgt.id, status: valgt.status === 'aktiv' ? 'arkivert' : 'aktiv' }) }).then(() => hent())}
                    className="w-full py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                    {valgt.status === 'aktiv' ? 'Arkiver' : 'Aktiver'}
                  </button>
                  <button onClick={() => setVisSlettDialog(true)} className="w-full py-2 border border-red-500/20 rounded text-xs text-red-400 hover:bg-red-500/10 transition-all">Slett</button>
                </>
              )}
            </div>

            {visSlettDialog && (
              <div className="border border-red-500/30 rounded-lg p-3 bg-red-500/5 space-y-2">
                <p className="text-xs font-bold text-red-400">Hva vil du slette?</p>
                <button onClick={() => slett(false)} className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-text text-left px-3 transition-all">Arkiver kun i appen</button>
                <button onClick={() => slett(true)} className="w-full py-1.5 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-500/10 text-left px-3 transition-all">Slett også Discord-meldingen</button>
                <button onClick={() => setVisSlettDialog(false)} className="w-full py-1.5 text-xs text-g-muted hover:text-g-text transition-all">Avbryt</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
