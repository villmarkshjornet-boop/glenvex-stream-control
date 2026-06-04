'use client';

import { useEffect, useState } from 'react';

interface Rolle { id: string; navn: string; farge: string | null; antallBrukere: number; managed: boolean; position: number; }
interface Membre { id: string; brukernavn: string; displayNavn: string; roller: string[]; rolleNavn: string[]; level: number | null; meldinger: number | null; }

const SENSITIVE_ROLLER = ['admin', 'owner', 'administrator', 'eier'];

export default function RoleManagerPage() {
  const [roller, setRoller] = useState<Rolle[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [valgt, setValgt] = useState<Membre | null>(null);
  const [loading, setLoading] = useState(true);
  const [søk, setSøk] = useState('');
  const [oppdaterer, setOppdaterer] = useState<string | null>(null);
  const [melding, setMelding] = useState('');

  const hent = async () => {
    setLoading(true);
    const res = await fetch('/api/role-manager').then(r => r.json());
    setRoller(res.roller ?? []);
    setMembres(res.membres ?? []);
    if (valgt) {
      const oppdatert = (res.membres ?? []).find((m: Membre) => m.id === valgt.id);
      if (oppdatert) setValgt(oppdatert);
    }
    setLoading(false);
  };

  useEffect(() => { hent(); }, []);

  async function tildelRolle(rolleId: string, rolleNavn: string, harRolle: boolean) {
    if (!valgt) return;
    setOppdaterer(rolleId);
    setMelding('');
    const res = await fetch('/api/role-manager/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: valgt.id,
        rolleId,
        rolleNavn,
        handling: harRolle ? 'fjern' : 'legg_til',
        brukerNavn: valgt.displayNavn,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setMelding(`✓ ${harRolle ? 'Fjernet' : 'La til'} @${rolleNavn} for ${valgt.displayNavn}`);
      await hent();
    } else {
      setMelding(`✗ ${data.error}`);
    }
    setOppdaterer(null);
  }

  const filtrerteRoller = roller
    .filter(r => r.navn !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position);

  const filtrerteMembres = membres
    .filter(m => m.displayNavn?.toLowerCase().includes(søk.toLowerCase()) || m.brukernavn?.toLowerCase().includes(søk.toLowerCase()));

  const moderatorer = membres.filter(m =>
    m.rolleNavn.some(r => r.toLowerCase().includes('mod') || r.toLowerCase().includes('admin'))
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Role Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Velg et membre og sett rollene deres direkte</p>
      </div>

      {/* Moderatorer */}
      {moderatorer.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Moderatorer</p>
          <div className="flex gap-2 flex-wrap">
            {moderatorer.map(m => (
              <button key={m.id} onClick={() => setValgt(m)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  valgt?.id === m.id ? 'border-g-green/40 bg-g-green/10 text-g-green' : 'border-g-border text-g-muted hover:border-g-green/20 hover:text-g-text'
                }`}>
                <div className="w-5 h-5 rounded-full bg-purple-400/20 border border-purple-400/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-black text-purple-400">{m.displayNavn?.[0]?.toUpperCase()}</span>
                </div>
                <span className="font-bold">{m.displayNavn}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Membres-liste */}
        <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-3">
          <input value={søk} onChange={e => setSøk(e.target.value)} placeholder="Søk etter membre..."
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />

          {loading ? <p className="text-xs text-g-muted">Henter membres fra Discord...</p> :
           filtrerteMembres.length === 0 ? <p className="text-xs text-g-muted">Ingen funnet.</p> : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {filtrerteMembres.map(m => (
                <button key={m.id} onClick={() => { setValgt(m); setMelding(''); }}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all ${
                    valgt?.id === m.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'
                  }`}>
                  <div className="w-8 h-8 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-black text-g-green">{m.displayNavn?.[0]?.toUpperCase() ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text truncate">{m.displayNavn ?? m.brukernavn}</p>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {m.rolleNavn.slice(0, 3).map(r => (
                        <span key={r} className="text-[8px] px-1.5 py-0.5 bg-g-bg border border-g-border rounded text-g-muted">{r}</span>
                      ))}
                      {m.rolleNavn.length > 3 && <span className="text-[8px] text-g-muted">+{m.rolleNavn.length - 3}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Rolle-panel */}
        {valgt ? (
          <div className="bg-g-card border border-g-green/20 rounded-xl p-5 space-y-4">
            <div>
              <p className="text-sm font-black text-g-text">{valgt.displayNavn}</p>
              <p className="text-[10px] text-g-muted">@{valgt.brukernavn}</p>
              {valgt.level !== null && <p className="text-[10px] text-g-green mt-0.5">Level {valgt.level}</p>}
            </div>

            <div>
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Roller – huk av for å legge til / fjerne</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {filtrerteRoller.map(rolle => {
                  const harRolle = valgt.roller.includes(rolle.id);
                  const erSensitiv = SENSITIVE_ROLLER.some(s => rolle.navn.toLowerCase().includes(s));
                  return (
                    <label key={rolle.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                        harRolle ? 'border-g-green/20 bg-g-green/5' : 'border-g-border hover:border-g-green/10'
                      } ${erSensitiv ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <input
                        type="checkbox"
                        checked={harRolle}
                        disabled={erSensitiv || oppdaterer === rolle.id}
                        onChange={() => !erSensitiv && tildelRolle(rolle.id, rolle.navn, harRolle)}
                        className="accent-green-400 w-4 h-4 flex-shrink-0"
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {rolle.farge && (
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: rolle.farge }} />
                        )}
                        <span className="text-xs text-g-text truncate">{rolle.navn}</span>
                        {erSensitiv && <span className="text-[8px] text-g-muted ml-auto">Sensitiv</span>}
                        {oppdaterer === rolle.id && <span className="text-[8px] text-g-green ml-auto animate-pulse">Oppdaterer...</span>}
                      </div>
                      <span className="text-[8px] text-g-muted flex-shrink-0">{rolle.antallBrukere}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {melding && (
              <p className={`text-xs font-mono p-2 rounded border ${melding.startsWith('✓') ? 'text-g-green border-g-green/20 bg-g-green/5' : 'text-red-400 border-red-500/20 bg-red-500/5'}`}>
                {melding}
              </p>
            )}

            <button onClick={() => { setValgt(null); setMelding(''); }}
              className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-text transition-all">
              Lukk
            </button>
          </div>
        ) : (
          <div className="bg-g-card border border-g-border rounded-xl p-8 flex items-center justify-center">
            <p className="text-xs text-g-muted text-center">Velg et membre fra listen for å administrere rollene deres</p>
          </div>
        )}
      </div>

      {/* Roller-oversikt */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Alle roller på serveren</p>
        <div className="flex gap-2 flex-wrap">
          {filtrerteRoller.map(r => (
            <div key={r.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-g-bg border border-g-border rounded-full">
              {r.farge && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.farge }} />}
              <span className="text-xs text-g-text">{r.navn}</span>
              <span className="text-[9px] text-g-muted">{r.antallBrukere}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
