'use client';

import { useEffect, useState } from 'react';
import { PageHeader, EmptyState } from '@/components/ui';

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
        ? { ok: true, msg: `✓ Postet ${data.antallDager} stream${data.antallDager !== 1 ? 'er' : ''} til Discord` }
        : { ok: false, msg: `✗ ${data.error}` });
    } catch (e) {
      setPostRes({ ok: false, msg: `✗ Nettverksfeil: ${(e as Error).message}` });
    }
    setPosting(false);
  }

  const aktiveUkentlige = weekly.filter(e => e.aktiv);
  const aktiveSingles = singles.filter(e => e.aktiv);
  const totalAktive = aktiveUkentlige.length + aktiveSingles.length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="Streamplan" subtitle="Ukentlige faste streams + enkeltdatoer" />

      {/* Ukentlige streams */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Ukentlige streams</p>
        <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
          <div className="divide-y divide-g-border">
            {weekly.map((entry, i) => (
              <div key={entry.dag} className={`p-4 transition-all ${entry.aktiv ? 'bg-g-green/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={entry.aktiv}
                    onChange={e => oppdaterUkentlig(i, 'aktiv', e.target.checked)}
                    className="accent-green-400 w-4 h-4"
                  />
                  <span className={`text-sm font-bold ${entry.aktiv ? 'text-g-green' : 'text-g-muted'}`}>
                    {entry.dag}
                  </span>
                  {entry.aktiv && entry.spill && (
                    <span className="text-xs text-g-muted ml-auto">{entry.tid} · {entry.spill}</span>
                  )}
                </div>
                {entry.aktiv && (
                  <div className="mt-3 pl-7 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tid</label>
                        <input type="time" value={entry.tid}
                          onChange={e => oppdaterUkentlig(i, 'tid', e.target.value)}
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Spill</label>
                        <input value={entry.spill}
                          onChange={e => oppdaterUkentlig(i, 'spill', e.target.value)}
                          placeholder="Future RP"
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tittel (valgfritt)</label>
                        <input value={entry.tittel}
                          onChange={e => oppdaterUkentlig(i, 'tittel', e.target.value)}
                          placeholder="Valgfri undertittel"
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={entry.pre_hype_enabled !== false}
                          onChange={e => oppdaterUkentlig(i, 'pre_hype_enabled', e.target.checked)}
                          className="accent-green-400 w-3.5 h-3.5" />
                        <span className="text-[10px] text-g-muted">Pre-hype</span>
                      </label>
                      {entry.pre_hype_enabled !== false && (
                        <div className="flex items-center gap-1">
                          <input type="number" min={10} max={180} value={entry.pre_hype_minutes_before ?? 60}
                            onChange={e => oppdaterUkentlig(i, 'pre_hype_minutes_before', Number(e.target.value))}
                            className="w-16 bg-g-bg border border-g-border rounded px-2 py-1 text-[10px] text-g-text outline-none focus:border-g-green/50" />
                          <span className="text-[10px] text-g-muted">min før</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Enkeltdato-streams */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Enkeltdato-streams</p>
          <button onClick={leggTilSingle}
            className="text-[10px] text-g-green border border-g-green/20 px-2 py-0.5 rounded hover:bg-g-green/10 transition-all">
            + Legg til dato
          </button>
        </div>
        {singles.length === 0 ? (
          <EmptyState icon="▦" title="Ingen enkeltdato-streams" description="Bruk for spesielle events, premiere eller turneringer." />
        ) : (
          <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
            <div className="divide-y divide-g-border">
              {singles.map(entry => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Dato</label>
                        <input type="date" value={entry.date ?? todayISO()}
                          onChange={e => oppdaterSingle(entry.id, 'date', e.target.value)}
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tid</label>
                        <input type="time" value={entry.tid}
                          onChange={e => oppdaterSingle(entry.id, 'tid', e.target.value)}
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Spill</label>
                        <input value={entry.spill}
                          onChange={e => oppdaterSingle(entry.id, 'spill', e.target.value)}
                          placeholder="Future RP"
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                      <div>
                        <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Tittel</label>
                        <input value={entry.tittel}
                          onChange={e => oppdaterSingle(entry.id, 'tittel', e.target.value)}
                          placeholder="Valgfri undertittel"
                          className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                      </div>
                    </div>
                    <button onClick={() => fjernSingle(entry.id)}
                      className="mt-5 text-g-muted hover:text-red-400 text-xs transition-colors px-1">✕</button>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={entry.pre_hype_enabled !== false}
                        onChange={e => oppdaterSingle(entry.id, 'pre_hype_enabled', e.target.checked)}
                        className="accent-green-400 w-3.5 h-3.5" />
                      <span className="text-[10px] text-g-muted">Pre-hype</span>
                    </label>
                    {entry.pre_hype_enabled !== false && (
                      <div className="flex items-center gap-1">
                        <input type="number" min={10} max={180} value={entry.pre_hype_minutes_before ?? 60}
                          onChange={e => oppdaterSingle(entry.id, 'pre_hype_minutes_before', Number(e.target.value))}
                          className="w-16 bg-g-bg border border-g-border rounded px-2 py-1 text-[10px] text-g-text outline-none focus:border-g-green/50" />
                        <span className="text-[10px] text-g-muted">min før</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Forhåndsvisning */}
      {totalAktive > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Forhåndsvisning — Discord embed</p>
          <div className="border-l-2 border-l-g-green pl-4 space-y-1">
            <p className="text-xs font-bold text-g-text">Streamplan</p>
            {aktiveUkentlige.map(e => (
              <p key={e.id} className="text-xs text-g-muted">
                <span className="text-g-text font-semibold">{e.dag}</span> kl. {e.tid} · {e.spill}{e.tittel ? ` – ${e.tittel}` : ''}
              </p>
            ))}
            {aktiveSingles.map(e => (
              <p key={e.id} className="text-xs text-g-muted">
                <span className="text-g-text font-semibold">{e.date}</span> kl. {e.tid} · {e.spill}{e.tittel ? ` – ${e.tittel}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={lagre}
          className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded-lg transition-all">
          {lagret ? '✓ Lagret' : '◆ Lagre plan'}
        </button>
        <button onClick={postTilDiscord} disabled={posting || totalAktive === 0}
          className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold tracking-widest uppercase rounded-lg transition-all disabled:opacity-40">
          {posting ? 'Poster...' : `Post (${totalAktive} stream${totalAktive !== 1 ? 's' : ''}) til Discord`}
        </button>
      </div>

      {postRes && (
        <p className={`text-xs font-mono p-3 rounded-lg border ${postRes.ok ? 'text-g-green border-g-green/20 bg-g-green/5' : 'text-red-400 border-red-500/20 bg-red-500/5'}`}>
          {postRes.msg}
        </p>
      )}
    </div>
  );
}
