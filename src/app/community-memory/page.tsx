'use client';

import { useEffect, useState } from 'react';

interface Minne {
  id: string;
  userId: string;
  brukernavn: string;
  notat: string;
  kategori: 'info' | 'påminnelse' | 'interesser';
  dato: string;
}

interface Member {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  messages: number;
  subs: number;
  lastSeen: string;
}

export default function CommunityMemoryPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [minner, setMinner] = useState<Minne[]>([]);
  const [valgt, setValgt] = useState<Member | null>(null);
  const [nyNotat, setNyNotat] = useState('');
  const [kategori, setKategori] = useState<'info' | 'påminnelse' | 'interesser'>('info');
  const [innsikt, setInnsikt] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const hent = async () => {
    const [mRes, minRes] = await Promise.all([
      fetch('/api/members').then(r => r.json()),
      fetch('/api/community-memory').then(r => r.json()),
    ]);
    setMembers(mRes ?? []);
    setMinner(minRes ?? []);
    setLoading(false);
  };

  useEffect(() => { hent(); }, []);

  async function leggTilNotat() {
    if (!valgt || !nyNotat.trim()) return;
    await fetch('/api/community-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: valgt.id, brukernavn: valgt.displayName, notat: nyNotat, kategori }),
    });
    setNyNotat('');
    hent();
  }

  async function hentInnsikt() {
    if (!valgt) return;
    const res = await fetch(`/api/community-memory/insights?userId=${valgt.id}`);
    const d = await res.json();
    setInnsikt(d.innsikt ?? '');
  }

  async function slettNotat(id: string) {
    await fetch('/api/community-memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    hent();
  }

  const valgtMinner = minner.filter(m => m.userId === valgt?.id);

  const relationshipScore = valgt ? Math.min(100, Math.round(
    (Math.min(valgt.messages, 500) / 500) * 50 +
    (Math.min(valgt.subs, 5) / 5) * 30 +
    (Math.min(valgt.level, 20) / 20) * 20
  )) : 0;

  const KATEGORI_FARGE = {
    info: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
    påminnelse: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    interesser: 'text-g-green border-g-green/30 bg-g-green/10',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Memory</h1>
        <p className="text-xs text-g-muted mt-0.5">Husk seerne – AI-notater og personlige påminnelser</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Membre-liste */}
        <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-2">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">Velg Medlem</h2>
          {loading ? <p className="text-xs text-g-muted">Laster...</p> :
           members.length === 0 ? <p className="text-xs text-g-muted">Ingen membres ennå.</p> :
           members.slice(0, 20).map(m => (
            <button key={m.id} onClick={() => { setValgt(valgt?.id === m.id ? null : m); setInnsikt(''); }}
              className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${valgt?.id === m.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'}`}>
              <div className="w-7 h-7 rounded-full bg-g-green/20 border border-g-green/30 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-black text-g-green">{m.displayName[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-g-text truncate">{m.displayName}</p>
                <p className="text-[9px] text-g-muted">Lv {m.level} • {m.messages} meldinger</p>
              </div>
              {minner.filter(mn => mn.userId === m.id).length > 0 && (
                <span className="text-[9px] bg-g-green/20 text-g-green px-1.5 py-0.5 rounded-full font-bold">
                  {minner.filter(mn => mn.userId === m.id).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Profil + Notater */}
        <div className="space-y-4">
          {!valgt ? (
            <div className="bg-g-card border border-g-border rounded-lg p-8 text-center h-full flex items-center justify-center">
              <p className="text-xs text-g-muted">Velg et membre for å se profil og legge til notater</p>
            </div>
          ) : (
            <>
              {/* Profil */}
              <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-black text-g-text">{valgt.displayName}</p>
                    <p className="text-xs text-g-muted">@{valgt.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-g-muted uppercase">Relationship</p>
                    <p className="text-xl font-black text-g-green font-mono">{relationshipScore}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[['Level', valgt.level], ['Meldinger', valgt.messages], ['Subs', valgt.subs]].map(([l, v]) => (
                    <div key={l as string} className="text-center p-2 bg-g-bg border border-g-border rounded">
                      <p className="text-[9px] text-g-muted uppercase">{l}</p>
                      <p className="text-sm font-black text-g-green font-mono">{v}</p>
                    </div>
                  ))}
                </div>
                <button onClick={hentInnsikt} className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  ◆ Hent AI-innsikt
                </button>
                {innsikt && <p className="text-xs text-g-text italic leading-relaxed">{innsikt}</p>}
              </div>

              {/* Legg til notat */}
              <div className="bg-g-card border border-g-border rounded-lg p-4 space-y-2">
                <div className="flex gap-2">
                  {(['info', 'påminnelse', 'interesser'] as const).map(k => (
                    <button key={k} onClick={() => setKategori(k)}
                      className={`px-2 py-1 text-[10px] font-bold uppercase rounded border transition-all ${kategori === k ? KATEGORI_FARGE[k] : 'border-g-border text-g-muted'}`}>
                      {k}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={nyNotat} onChange={e => setNyNotat(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && leggTilNotat()}
                    placeholder='F.eks. "Studerer IT, aktiv på fredager"'
                    className="flex-1 bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                  <button onClick={leggTilNotat} className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded transition-all hover:bg-g-green/20">+</button>
                </div>
              </div>

              {/* Notater */}
              {valgtMinner.length > 0 && (
                <div className="space-y-2">
                  {valgtMinner.map(m => (
                    <div key={m.id} className={`flex items-start gap-2 p-3 rounded-lg border ${KATEGORI_FARGE[m.kategori]}`}>
                      <p className="text-xs flex-1">{m.notat}</p>
                      <button onClick={() => slettNotat(m.id)} className="text-[10px] opacity-50 hover:opacity-100 transition-opacity flex-shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
