'use client';

import { useEffect, useState } from 'react';

interface Rolle { id: string; navn: string; farge: string | null; antallBrukere: number; managed: boolean; position: number; }
interface Membre { id: string; brukernavn: string; displayNavn: string; roller: string[]; rolleNavn: string[]; bliMedDato: string; sisteAktiv: string | null; level: number | null; xp: number | null; meldinger: number | null; }
interface RoleRule { id: string; navn: string; beskrivelse: string; trigger: string; terskel: number; rolleNavn: string; status: string; antallTildelt: number; }
interface PendingApproval { id: string; brukerNavn: string; rolle: string; aarsak: string; dato: string; }

export default function RoleManagerPage() {
  const [roller, setRoller] = useState<Rolle[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [regler, setRegler] = useState<RoleRule[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [aktivTab, setAktivTab] = useState<'roller' | 'membres' | 'regler' | 'ventende'>('roller');
  const [filterRolle, setFilterRolle] = useState('');
  const [søk, setSøk] = useState('');
  const [nyRegel, setNyRegel] = useState({ navn: '', trigger: 'meldinger', terskel: 100, rolleNavn: '', status: 'aktiv' });
  const [visRegForm, setVisRegForm] = useState(false);

  const hent = async () => {
    setLoading(true);
    const [rmRes, reRes, peRes] = await Promise.all([
      fetch('/api/role-manager').then(r => r.json()),
      fetch('/api/role-rules').then(r => r.json()),
      fetch('/api/role-rules?action=pending').then(r => r.json()),
    ]);
    setRoller(rmRes.roller ?? []);
    setMembres(rmRes.membres ?? []);
    setRegler(reRes ?? []);
    setPending(peRes ?? []);
    setLoading(false);
  };

  useEffect(() => { hent(); }, []);

  async function lagRegel() {
    await fetch('/api/role-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nyRegel) });
    setVisRegForm(false);
    hent();
  }

  async function godkjenn(id: string, godkjent: boolean) {
    await fetch('/api/role-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', id, godkjent }) });
    hent();
  }

  const filtrerteMembres = membres.filter(m =>
    (m.displayNavn?.toLowerCase().includes(søk.toLowerCase()) || m.brukernavn?.toLowerCase().includes(søk.toLowerCase())) &&
    (!filterRolle || m.roller.includes(filterRolle))
  );

  const TABS = ['roller', 'membres', 'regler', 'ventende'] as const;
  const ANTALL = { ventende: pending.length };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Role Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Discord-roller, membres og automatiske rolle-regler</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-g-border gap-1">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setAktivTab(tab)}
            className={`px-4 py-2.5 text-xs font-bold tracking-wider uppercase transition-all relative ${
              aktivTab === tab ? 'text-g-green border-b-2 border-g-green' : 'text-g-muted hover:text-g-text'
            }`}>
            {tab}
            {(ANTALL as any)[tab] > 0 && (
              <span className="ml-1.5 bg-g-green text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">{(ANTALL as any)[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? <p className="text-xs text-g-muted p-4">Henter Discord-data...</p> : (
        <>
          {/* Roller */}
          {aktivTab === 'roller' && (
            <div className="space-y-2">
              {roller.filter(r => r.navn !== '@everyone').map(r => (
                <div key={r.id} className="bg-g-card border border-g-border rounded-lg p-4 flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: r.farge ?? '#555' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text">{r.navn}</p>
                    {r.managed && <p className="text-[9px] text-g-muted">Bot-administrert</p>}
                  </div>
                  <span className="text-xs font-black text-g-green font-mono">{r.antallBrukere} membres</span>
                </div>
              ))}
            </div>
          )}

          {/* Membres */}
          {aktivTab === 'membres' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input value={søk} onChange={e => setSøk(e.target.value)} placeholder="Søk i membres..."
                  className="flex-1 bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                <select value={filterRolle} onChange={e => setFilterRolle(e.target.value)}
                  className="bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none">
                  <option value="">Alle roller</option>
                  {roller.filter(r => r.navn !== '@everyone').map(r => (
                    <option key={r.id} value={r.id}>{r.navn}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {filtrerteMembres.slice(0, 50).map(m => (
                  <div key={m.id} className="bg-g-card border border-g-border rounded-lg p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-g-green/20 border border-g-green/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-black text-g-green">{(m.displayNavn ?? m.brukernavn ?? '?')[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-g-text">{m.displayNavn ?? m.brukernavn}</p>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {m.rolleNavn.slice(0, 4).map(rn => (
                          <span key={rn} className="text-[8px] px-1.5 py-0.5 bg-g-bg border border-g-border rounded font-bold text-g-muted">{rn}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right text-[9px] text-g-muted flex-shrink-0">
                      {m.level !== null && <p>Lv <span className="text-g-green font-black">{m.level}</span></p>}
                      {m.meldinger !== null && <p>{m.meldinger} msg</p>}
                    </div>
                  </div>
                ))}
                {filtrerteMembres.length > 50 && (
                  <p className="text-xs text-g-muted text-center">Viser 50 av {filtrerteMembres.length} membres</p>
                )}
              </div>
            </div>
          )}

          {/* Regler */}
          {aktivTab === 'regler' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setVisRegForm(!visRegForm)}
                  className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
                  + Ny regel
                </button>
              </div>

              {visRegForm && (
                <div className="bg-g-card border border-g-green/20 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Regelnavn</p>
                      <input value={nyRegel.navn} onChange={e => setNyRegel(p => ({ ...p, navn: e.target.value }))}
                        placeholder="F.eks. Aktiv bruker" className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none" />
                    </div>
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Gi rollen</p>
                      <input value={nyRegel.rolleNavn} onChange={e => setNyRegel(p => ({ ...p, rolleNavn: e.target.value }))}
                        placeholder="Rollenavn i Discord" className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none" />
                    </div>
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Trigger</p>
                      <select value={nyRegel.trigger} onChange={e => setNyRegel(p => ({ ...p, trigger: e.target.value }))}
                        className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none">
                        {['meldinger', 'level', 'xp', 'dager_som_medlem'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Terskel</p>
                      <input type="number" value={nyRegel.terskel} onChange={e => setNyRegel(p => ({ ...p, terskel: +e.target.value }))}
                        className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none" />
                    </div>
                  </div>
                  <select value={nyRegel.status} onChange={e => setNyRegel(p => ({ ...p, status: e.target.value }))}
                    className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none">
                    <option value="aktiv">Aktiv – tildel automatisk</option>
                    <option value="kun_forslag">Kun forslag – krever godkjenning</option>
                    <option value="pause">Pause</option>
                  </select>
                  <button onClick={lagRegel} className="w-full py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
                    ◆ Opprett regel
                  </button>
                </div>
              )}

              {regler.map(r => (
                <div key={r.id} className="bg-g-card border border-g-border rounded-xl p-4 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === 'aktiv' ? 'bg-g-green' : r.status === 'kun_forslag' ? 'bg-yellow-400' : 'bg-g-muted'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text">{r.navn}</p>
                    <p className="text-[9px] text-g-muted">{r.trigger} ≥ {r.terskel} → @{r.rolleNavn}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-g-muted">{r.antallTildelt} tildelt</span>
                    <select value={r.status}
                      onChange={e => fetch('/api/role-rules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, status: e.target.value }) }).then(() => hent())}
                      className="bg-g-bg border border-g-border rounded px-2 py-1 text-[9px] text-g-text outline-none">
                      <option value="aktiv">Aktiv</option>
                      <option value="kun_forslag">Kun forslag</option>
                      <option value="pause">Pause</option>
                    </select>
                    <button onClick={() => fetch('/api/role-rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) }).then(() => hent())}
                      className="text-[9px] text-red-400 hover:text-red-300 transition-colors">Slett</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Ventende godkjenninger */}
          {aktivTab === 'ventende' && (
            <div className="space-y-3">
              {pending.length === 0 ? (
                <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
                  <p className="text-xs text-g-muted">Ingen ventende rolleforslag.</p>
                </div>
              ) : pending.map(p => (
                <div key={p.id} className="bg-g-card border border-yellow-400/20 rounded-xl p-4">
                  <p className="text-xs font-bold text-g-text mb-1">
                    <span className="text-yellow-400">{p.brukerNavn}</span> kvalifiserer til <span className="text-g-green">@{p.rolle}</span>
                  </p>
                  <p className="text-[10px] text-g-muted mb-3">{p.aarsak}</p>
                  <div className="flex gap-2">
                    <button onClick={() => godkjenn(p.id, true)}
                      className="flex-1 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
                      ✓ Godkjenn
                    </button>
                    <button onClick={() => godkjenn(p.id, false)}
                      className="flex-1 py-1.5 border border-red-500/20 text-red-400 text-xs font-bold rounded hover:bg-red-500/10 transition-all">
                      ✗ Avvis
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
