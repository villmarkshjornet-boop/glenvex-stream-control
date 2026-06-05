'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

// ─── Typer ────────────────────────────────────────────────────────────────────

interface HealthItem { ok: boolean; melding: string; }
interface HealthData {
  twitch: HealthItem; discord: HealthItem; scheduler: HealthItem;
  contentFactory: HealthItem; clipWorker: HealthItem; supabase: HealthItem; openai: HealthItem;
}
interface SlowData {
  health: HealthData;
  streamStatus: {
    isLive: boolean; viewers: number; game: string | null; title: string | null; thumbnailUrl: string | null;
    nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  };
  meta: { hentetKl: string };
}
interface LiveData {
  activeJobs: { agent: string; task: string; progress: number; href: string }[];
  sjekkliste: { label: string; done: boolean; href: string }[];
  sisteResultater: { id: string; title: string; createdAt: string; highlights: number; klipp: number }[];
  nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  ts: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tidSiden(iso: string): string {
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60) return 'akkurat nå';
  if (sek < 3600) return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return `${Math.floor(sek / 86400)}d siden`;
}

// ─── System Health Bar ─────────────────────────────────────────────────────────

const HEALTH_LABELS: [string, keyof HealthData][] = [
  ['Twitch', 'twitch'],
  ['Discord Bot', 'discord'],
  ['Scheduler', 'scheduler'],
  ['Content Factory', 'contentFactory'],
  ['Clip Worker', 'clipWorker'],
  ['Supabase', 'supabase'],
  ['OpenAI', 'openai'],
];

function SystemHealthBar({ health, loading }: { health: HealthData | null; loading: boolean }) {
  const altOk = health && Object.values(health).every(h => h.ok);
  return (
    <div className={`border rounded-xl p-3 ${altOk ? 'border-g-green/10 bg-g-green/[0.02]' : loading ? 'border-g-border' : 'border-red-500/20 bg-red-500/[0.02]'}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Systemstatus</p>
        {altOk && <span className="text-[9px] text-g-green font-bold">✓ Alt kjører</span>}
        {health && !altOk && <span className="text-[9px] text-red-400 font-bold">⚠ Feil oppdaget</span>}
        {loading && !health && <span className="text-[9px] text-g-muted/50">sjekker...</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {HEALTH_LABELS.map(([label, key]) => {
          if (loading && !health) {
            return <div key={key} className="h-6 w-28 bg-g-border/30 rounded animate-pulse" />;
          }
          if (!health) return null;
          const h = health[key];
          return (
            <div key={key} title={h.melding}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${
                h.ok ? 'border-g-green/20 text-g-green bg-g-green/5' : 'border-red-500/30 text-red-400 bg-red-500/5'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${h.ok ? 'bg-g-green' : 'bg-red-400 animate-pulse'}`} />
              {label}
            </div>
          );
        })}
      </div>
      {health && !altOk && (
        <div className="mt-2 space-y-0.5">
          {HEALTH_LABELS.filter(([, k]) => !health[k].ok).map(([label, key]) => (
            <p key={key} className="text-[9px] text-red-400">✗ {label}: {health[key].melding}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Aktive Jobber ─────────────────────────────────────────────────────────────

function AktiveJobber({ jobs, loading }: { jobs: LiveData['activeJobs']; loading: boolean }) {
  if (loading) {
    return <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-14 bg-g-card border border-g-border rounded-xl animate-pulse" />)}</div>;
  }
  if (jobs.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 bg-g-card border border-g-border rounded-xl">
        <span className="w-2 h-2 rounded-full bg-g-muted/30" />
        <p className="text-xs text-g-muted">Ingen aktive jobber akkurat nå</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job, i) => (
        <Link key={i} href={job.href}
          className="flex items-center gap-4 p-3 bg-g-card border border-g-border rounded-xl hover:border-g-green/20 transition-all group">
          <div className="flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-g-green animate-pulse block" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-g-muted font-bold uppercase tracking-wider">{job.agent}</p>
            <p className="text-xs text-g-text truncate">{job.task}</p>
            {job.progress > 0 && job.progress < 100 && (
              <div className="mt-1.5 h-1 bg-g-border rounded-full overflow-hidden w-48">
                <div className="h-full bg-yellow-400 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
              </div>
            )}
          </div>
          <span className="text-[9px] text-g-muted group-hover:text-g-green transition-colors">→</span>
        </Link>
      ))}
    </div>
  );
}

// ─── Stream Status ─────────────────────────────────────────────────────────────

function StreamStatus({ slow, live }: { slow: SlowData | null; live: LiveData | null }) {
  const [nedtelling, setNedtelling] = useState<string | null>(null);

  // nesteStream comes from live (fast, from streamplan) — fallback to slow
  const nesteStream = live?.nesteStream ?? slow?.streamStatus?.nesteStream ?? null;
  const isLive = slow?.streamStatus?.isLive ?? false;

  useEffect(() => {
    if (!nesteStream?.tidspunkt) { setNedtelling(null); return; }
    const oppdater = () => {
      const ms = new Date(nesteStream.tidspunkt!).getTime() - Date.now();
      if (ms <= 0) { setNedtelling('Nå'); return; }
      const timer = Math.floor(ms / 3_600_000);
      const min = Math.floor((ms % 3_600_000) / 60_000);
      const sek = Math.floor((ms % 60_000) / 1000);
      if (timer >= 24) setNedtelling(`${Math.floor(timer / 24)}d ${timer % 24}t`);
      else if (timer > 0) setNedtelling(`${timer}t ${min}m`);
      else setNedtelling(`${min}m ${sek}s`);
    };
    oppdater();
    const id = setInterval(oppdater, 1000);
    return () => clearInterval(id);
  }, [nesteStream?.tidspunkt]);

  if (!slow && !live) return <div className="h-24 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  if (isLive && slow?.streamStatus) {
    const s = slow.streamStatus;
    return (
      <div className="bg-g-card border border-red-500/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">LIVE NÅ</p>
          <p className="text-[10px] text-red-400 font-mono font-black ml-auto">{s.viewers} seere</p>
        </div>
        {s.thumbnailUrl && (
          <img src={s.thumbnailUrl.replace('{width}', '320').replace('{height}', '180')} alt="" className="w-full rounded mb-2 border border-g-border" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
        )}
        <p className="text-[9px] text-g-muted font-bold">{s.game}</p>
        <p className="text-xs font-bold text-g-text mt-0.5 truncate">{s.title}</p>
        <Link href="/ai-producer" className="mt-3 flex items-center justify-center gap-2 py-2 bg-g-green/10 border border-g-green/20 rounded text-xs text-g-green font-bold hover:bg-g-green/20 transition-all">
          ◆ Åpne AI Producer
        </Link>
      </div>
    );
  }

  if (!nesteStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Neste stream</p>
        <p className="text-xs text-g-muted">Ingen streamplan satt opp</p>
        <Link href="/streamplan" className="mt-3 block text-center py-2 border border-dashed border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          + Sett opp streamplan
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Neste stream</p>
      <div className="space-y-1">
        <div className="flex justify-between items-baseline">
          <p className="text-base font-black text-g-text">{nesteStream.dag} kl. {nesteStream.tid}</p>
          {nedtelling && <p className="text-[10px] font-mono font-black text-g-green">{nedtelling}</p>}
        </div>
        <p className="text-sm text-g-green font-semibold">{nesteStream.spill}</p>
        {nesteStream.tittel && <p className="text-[10px] text-g-muted italic">{nesteStream.tittel}</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Link href="/pre-live" className="flex-1 py-1.5 text-center bg-g-green/10 border border-g-green/20 rounded text-[10px] text-g-green font-bold hover:bg-g-green/20 transition-all">
          Pre-Hype
        </Link>
        <Link href="/streamplan" className="flex-1 py-1.5 text-center border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          Rediger
        </Link>
      </div>
    </div>
  );
}

// ─── Sjekkliste ────────────────────────────────────────────────────────────────

function Sjekkliste({ items, loading }: { items: LiveData['sjekkliste']; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!items.length) return null;
  const ferdig = items.filter(i => i.done).length;
  const pct = Math.round((ferdig / items.length) * 100);
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Stream-syklus</p>
        <p className="text-[10px] font-mono font-black text-g-green">{ferdig}/{items.length}</p>
      </div>
      <div className="mb-3 h-1 bg-g-border rounded-full overflow-hidden">
        <div className="h-full bg-g-green rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <Link key={i} href={item.href}
            className={`flex items-center gap-2.5 py-1 px-1 rounded hover:bg-white/[0.02] transition-all group ${item.done ? '' : 'opacity-70'}`}>
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[9px] font-black transition-all ${
              item.done ? 'border-g-green bg-g-green/10 text-g-green' : 'border-g-border/40 text-transparent'
            }`}>✓</span>
            <span className={`text-[11px] ${item.done ? 'text-g-text' : 'text-g-muted'} group-hover:text-g-text transition-colors`}>
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Siste Resultater ──────────────────────────────────────────────────────────

function SisteResultater({ resultater, loading }: { resultater: LiveData['sisteResultater']; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste resultater</p>
        <Link href="/content-factory-admin" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alle →</Link>
      </div>
      {resultater.length === 0 ? (
        <p className="text-xs text-g-muted">Ingen fullførte VODs ennå.</p>
      ) : (
        <div className="space-y-2">
          {resultater.map(r => (
            <div key={r.id} className="flex items-center gap-3 py-2 border-b border-g-border/20 last:border-0">
              <span className="text-g-green text-xs flex-shrink-0">✓</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-g-text truncate">{r.title}</p>
                <p className="text-[9px] text-g-muted">{tidSiden(r.createdAt)}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0 text-[9px]">
                {r.highlights > 0 && <span className="text-g-muted">{r.highlights} highlights</span>}
                {r.klipp > 0 && <span className="text-g-green font-bold">{r.klipp} klipp</span>}
              </div>
              <Link href={`/content-factory-admin/highlights?vod=${r.id}`}
                className="px-2 py-1 bg-g-green/5 border border-g-green/20 rounded text-[9px] text-g-green font-bold hover:bg-g-green/10 transition-all flex-shrink-0">
                ▶ Åpne
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [slow, setSlow] = useState<SlowData | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [sistOppdatert, setSistOppdatert] = useState<string | null>(null);

  const hentLive = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/live');
      if (res.ok) {
        const d: LiveData = await res.json();
        setLive(d);
        setSistOppdatert(d.ts);
      }
    } catch {}
    setLoadingLive(false);
  }, []);

  const hentSlow = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) setSlow(await res.json());
    } catch {}
    setLoadingSlow(false);
  }, []);

  const hentAlt = useCallback(() => { hentLive(); hentSlow(); }, [hentLive, hentSlow]);

  useEffect(() => {
    hentLive();
    hentSlow();
    const liveId = setInterval(hentLive, 5_000);
    const slowId = setInterval(hentSlow, 60_000);
    return () => { clearInterval(liveId); clearInterval(slowId); };
  }, [hentLive, hentSlow]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Dashboard</h1>
          <p className="text-[9px] text-g-muted mt-0.5">GLENVEX Creator OS · Kontrollrom</p>
        </div>
        <div className="flex items-center gap-3">
          {sistOppdatert && (
            <p className="text-[9px] text-g-muted/50">Live · oppdatert {tidSiden(sistOppdatert)}</p>
          )}
          <button onClick={hentAlt}
            className="px-2.5 py-1.5 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Systemstatus ────────────────────────────────────────────────────── */}
      <SystemHealthBar health={slow?.health ?? null} loading={loadingSlow} />

      {/* ── Hoved-grid: Aktive jobber + Stream + Sjekkliste ─────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Aktive jobber – 2/3 bredde */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">
              Aktive jobber {live && live.activeJobs.length > 0 ? `(${live.activeJobs.length})` : ''}
            </p>
            {live && (
              <span className="text-[8px] text-g-green/40 font-mono">↻ 5s</span>
            )}
          </div>
          <AktiveJobber jobs={live?.activeJobs ?? []} loading={loadingLive} />
        </div>

        {/* Stream status – 1/3 bredde */}
        <div>
          <StreamStatus slow={slow} live={live} />
        </div>
      </div>

      {/* ── Sjekkliste + Siste resultater ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1">
          <Sjekkliste items={live?.sjekkliste ?? []} loading={loadingLive} />
        </div>
        <div className="col-span-2">
          <SisteResultater resultater={live?.sisteResultater ?? []} loading={loadingLive} />
        </div>
      </div>

      {/* ── Hurtiglenker ────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Hurtiglenker</p>
        <div className="grid grid-cols-6 gap-2">
          {[
            { href: '/ai-producer', icon: '◆', label: 'AI Producer' },
            { href: '/content-factory-admin', icon: '▶', label: 'Content Factory' },
            { href: '/content-factory-admin/highlights', icon: '◈', label: 'Highlights' },
            { href: '/pre-live', icon: '((•))', label: 'Pre-Live' },
            { href: '/discord', icon: '◉', label: 'Discord' },
            { href: '/innstillinger', icon: '⚙', label: 'Innstillinger' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="bg-g-card border border-g-border rounded-lg p-3 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group text-center">
              <p className="text-g-green text-sm">{l.icon}</p>
              <p className="text-[10px] text-g-muted group-hover:text-g-text transition-colors mt-1">{l.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
