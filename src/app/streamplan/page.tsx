'use client';

import { useEffect, useState } from 'react';

interface StreamEntry {
  id: string;
  type: 'weekly' | 'single';
  dag?: string;
  weekday?: number;
  date?: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
  status?: 'upcoming' | 'completed' | 'skipped';
  pre_hype_enabled?: boolean;
  pre_hype_minutes_before?: number;
}

const DAGER = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function defaultWeekly(): StreamEntry[] {
  return DAGER.map((dag, i) => ({
    id: `weekly-${dag.toLowerCase()}`,
    type: 'weekly',
    dag,
    weekday: (i + 1) % 7,
    tid: '20:00',
    spill: '',
    tittel: '',
    aktiv: false,
    pre_hype_enabled: true,
    pre_hype_minutes_before: 60,
  }));
}

function todayISO(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const inputClass =
  'w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all';

export default function StreamplanPage() {
  const [weekly, setWeekly] = useState<StreamEntry[]>(defaultWeekly());
  const [singles, setSingles] = useState<StreamEntry[]>([]);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postRes, setPostRes] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/streamplan').then(r => r.json()).then((data: StreamEntry[]) => {
      if (!Array.isArray(data) || data.length === 0) return;
      const wEntries = data.filter(e => e.type === 'weekly' || !e.type);
      const sEntries = data.filter(e => e.type === 'single');
      if (wEntries.length > 0) {
        setWeekly(prev => prev.map(def => {
          const match = wEntries.find(e => e.dag === def.dag);
          return match ? { ...def, ...match } : def;
        }));
      }
      setSingles(sEntries.filter(e => !!e.date && e.status !== 'completed'));
    }).catch(() => {});
  }, []);

  function oppdaterUkentlig(i: number, felt: keyof StreamEntry, verdi: any) {
    setWeekly(prev => prev.map((e, idx) => idx === i ? { ...e, [felt]: verdi } : e));
  }

  function oppdaterSingle(id: string, felt: keyof StreamEntry, verdi: any) {
    setSingles(prev => prev.map(e => e.id === id ? { ...e, [felt]: verdi } : e));
  }

  function leggTilSingle() {
    setSingles(prev => [...prev, {
      id: shortId(),
      type: 'single',
      date: todayISO(),
      tid: '20:00',
      spill: '',
      tittel: '',
      aktiv: true,
      pre_hype_enabled: true,
      pre_hype_minutes_before: 60,
    }]);
  }

  function fjernSingle(id: string) {
    setSingles(prev => prev.filter(e => e.id !== id));
  }

  function allEntries(): StreamEntry[] {
    return [...weekly, ...singles];
  }

  async function lagre() {
    await fetch('/api/streamplan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allEntries()),
    });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function postTilDiscord() {
    setPosting(true);
    setPostRes(null);
    try {
      const entries = allEntries();
      await fetch('/api/streamplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      });
      const res = await fetch('/api/streamplan/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: entries }),
      });
      const data = await res.json();
      setPostRes(res.ok
        ? { ok: true, msg: `Postet ${data.antallDager} stream${data.antallDager !== 1 ? 'er' : ''} til Discord` }
        : { ok: false, msg: data.error });
    } catch (e) {
      setPostRes({ ok: false, msg: `Nettverksfeil: ${(e as Error).message}` });
    }
    setPosting(false);
  }

  const aktiveUkentlige = weekly.filter(e => e.aktiv);
  const aktiveSingles = singles.filter(e => e.aktiv);
  const totalAktive = aktiveUkentlige.length + aktiveSingles.length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-g-text">Streamplan</h1>
          <p className="text-sm text-g-muted mt-1">Ukentlige faste streams + enkeltdatoer</p>
        </div>
        <button
          onClick={leggTilSingle}
          className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200"
        >
          + Ny stream
        </button>
      </div>

      {/* Ukentlige streams */}
      <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-g-border/40">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted">
            Ukentlige streams
          </h2>
        </div>
        <div className="divide-y divide-g-border/40">
          {weekly.map((entry, i) => (
            <div
              key={entry.dag}
              className={`px-6 py-4 transition-all ${entry.aktiv ? 'bg-g-green/[0.03]' : ''}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={entry.aktiv}
                  onChange={e => oppdaterUkentlig(i, 'aktiv', e.target.checked)}
                  className="accent-green-400 w-4 h-4 flex-shrink-0"
                />
                <span className={`text-sm font-medium w-20 flex-shrink-0 ${entry.aktiv ? 'text-g-text' : 'text-g-muted'}`}>
                  {entry.dag}
                </span>
                {entry.aktiv && entry.spill && (
                  <span className="text-xs text-g-muted font-mono ml-auto">
                    {entry.tid} · {entry.spill}
                  </span>
                )}
              </div>

              {entry.aktiv && (
                <div className="mt-4 pl-7 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Tid</label>
                      <input
                        type="time"
                        value={entry.tid}
                        onChange={e => oppdaterUkentlig(i, 'tid', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Spill</label>
                      <input
                        value={entry.spill}
                        onChange={e => oppdaterUkentlig(i, 'spill', e.target.value)}
                        placeholder="Future RP"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Tittel</label>
                      <input
                        value={entry.tittel}
                        onChange={e => oppdaterUkentlig(i, 'tittel', e.target.value)}
                        placeholder="Valgfri undertittel"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.pre_hype_enabled !== false}
                        onChange={e => oppdaterUkentlig(i, 'pre_hype_enabled', e.target.checked)}
                        className="accent-green-400 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-g-muted">Pre-hype</span>
                    </label>
                    {entry.pre_hype_enabled !== false && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={10}
                          max={180}
                          value={entry.pre_hype_minutes_before ?? 60}
                          onChange={e => oppdaterUkentlig(i, 'pre_hype_minutes_before', Number(e.target.value))}
                          className="w-20 bg-g-bg border border-g-border rounded-lg px-2.5 py-1.5 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/40 transition-all"
                        />
                        <span className="text-xs text-g-muted">min før</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Enkeltdato-streams */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted">Enkeltdato-streams</h2>
        </div>

        {singles.length === 0 ? (
          <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
            <p className="text-sm text-g-muted">Ingen enkeltdato-streams ennå.</p>
            <p className="text-xs text-g-muted/60 mt-1">Bruk for spesielle events, premiere eller turneringer.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {singles.map(entry => (
              <div
                key={entry.id}
                className="bg-g-card border border-g-border rounded-xl p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 grid grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Dato</label>
                      <input
                        type="date"
                        value={entry.date ?? todayISO()}
                        onChange={e => oppdaterSingle(entry.id, 'date', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Tid</label>
                      <input
                        type="time"
                        value={entry.tid}
                        onChange={e => oppdaterSingle(entry.id, 'tid', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Spill</label>
                      <input
                        value={entry.spill}
                        onChange={e => oppdaterSingle(entry.id, 'spill', e.target.value)}
                        placeholder="Future RP"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium tracking-widest uppercase text-g-muted block mb-1.5">Tittel</label>
                      <input
                        value={entry.tittel}
                        onChange={e => oppdaterSingle(entry.id, 'tittel', e.target.value)}
                        placeholder="Valgfri undertittel"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => fjernSingle(entry.id)}
                    className="mt-6 text-g-muted hover:text-red-400 text-sm transition-colors px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-g-border/30">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.pre_hype_enabled !== false}
                      onChange={e => oppdaterSingle(entry.id, 'pre_hype_enabled', e.target.checked)}
                      className="accent-green-400 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-g-muted">Pre-hype</span>
                  </label>
                  {entry.pre_hype_enabled !== false && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={10}
                        max={180}
                        value={entry.pre_hype_minutes_before ?? 60}
                        onChange={e => oppdaterSingle(entry.id, 'pre_hype_minutes_before', Number(e.target.value))}
                        className="w-20 bg-g-bg border border-g-border rounded-lg px-2.5 py-1.5 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/40 transition-all"
                      />
                      <span className="text-xs text-g-muted">min før</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discord preview */}
      {totalAktive > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Forhåndsvisning — Discord embed
          </h2>
          <div className="border-l-2 border-l-g-green pl-4 space-y-1.5">
            <p className="text-sm font-semibold text-g-text">Streamplan</p>
            {aktiveUkentlige.map(e => (
              <p key={e.id} className="text-sm text-g-muted">
                <span className="text-g-text font-medium">{e.dag}</span>
                {' '}kl. {e.tid} · {e.spill}{e.tittel ? ` – ${e.tittel}` : ''}
              </p>
            ))}
            {aktiveSingles.map(e => (
              <p key={e.id} className="text-sm text-g-muted">
                <span className="text-g-text font-medium">{e.date}</span>
                {' '}kl. {e.tid} · {e.spill}{e.tittel ? ` – ${e.tittel}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={lagre}
          className="flex-1 py-2.5 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium rounded-lg transition-all duration-200"
        >
          {lagret ? 'Lagret' : 'Lagre plan'}
        </button>
        <button
          onClick={postTilDiscord}
          disabled={posting || totalAktive === 0}
          className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {posting ? 'Poster...' : `Post (${totalAktive} stream${totalAktive !== 1 ? 's' : ''}) til Discord`}
        </button>
      </div>

      {postRes && (
        <div className={`text-sm font-mono p-4 rounded-xl border ${
          postRes.ok
            ? 'text-g-green border-g-green/20 bg-g-green/5'
            : 'text-red-400 border-red-500/20 bg-red-500/5'
        }`}>
          {postRes.msg}
        </div>
      )}
    </div>
  );
}
