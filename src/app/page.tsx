'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthItem { ok: boolean; melding: string; }
interface HealthData {
  twitch: HealthItem; discord: HealthItem; scheduler: HealthItem;
  contentFactory: HealthItem; clipWorker: HealthItem; supabase: HealthItem; openai: HealthItem;
}
interface SlowData {
  health: HealthData;
  streamStatus: {
    isLive: boolean; viewers: number; game: string | null; title: string | null;
    thumbnailUrl: string | null;
    nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  };
  meta: { hentetKl: string };
}
interface SystemEvent {
  id: string;
  source: string;
  event_type: string;
  title: string;
  description?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata?: Record<string, any>;
  created_at: string;
}
interface KlippetHighlight {
  id: string; vodId: string; title: string | null; vodTitle: string | null;
  clip_url_16_9: string | null; clip_url_9_16: string | null; clippedAt: string;
}
interface AiInnsikt {
  title: string; summary: string; confidenceScore: number; createdAt: string;
}
interface VodStatus {
  id: string; title: string; status: string; progressPercent: number | null;
  statusMessage: string | null; errorMessage: string | null; createdAt: string;
  highlights: number; klipp: number; readyForClip: number; clipping: number;
}
interface LiveData {
  activeJobs: { agent: string; task: string; progress: number; href: string }[];
  sjekkliste:  { label: string; done: boolean; href: string }[];
  sisteResultater: VodStatus[];
  nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  clipStatus: { clipping: number; readyForClip: number; sisteKlippede: KlippetHighlight[] };
  nyesteInnsikter: AiInnsikt[];
  liveEvents: any[];
  systemEvents: SystemEvent[];
  ts: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tidSiden(iso: string): string {
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60)    return 'akkurat nå';
  if (sek < 3600)  return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return `${Math.floor(sek / 86400)}d siden`;
}

// ─── 1. LIVE SYSTEM STATUS ────────────────────────────────────────────────────

const HEALTH_LABELS: [string, keyof HealthData][] = [
  ['Twitch',          'twitch'],
  ['Discord Bot',     'discord'],
  ['Scheduler',       'scheduler'],
  ['Content Factory', 'contentFactory'],
  ['Clip Worker',     'clipWorker'],
  ['Supabase',        'supabase'],
  ['OpenAI',          'openai'],
];

function LiveSystemStatus({
  health, slow, live, loadingSlow, loadingLive,
}: {
  health: HealthData | null; slow: SlowData | null; live: LiveData | null;
  loadingSlow: boolean; loadingLive: boolean;
}) {
  const [nedtelling, setNedtelling] = useState<string | null>(null);
  const nesteStream = live?.nesteStream ?? slow?.streamStatus?.nesteStream ?? null;
  const isLive      = slow?.streamStatus?.isLive ?? false;

  useEffect(() => {
    if (!nesteStream?.tidspunkt) { setNedtelling(null); return; }
    const oppdater = () => {
      const ms = new Date(nesteStream.tidspunkt!).getTime() - Date.now();
      if (ms <= 0) { setNedtelling('Nå'); return; }
      const t = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
      if (t >= 24)  setNedtelling(`${Math.floor(t / 24)}d ${t % 24}t`);
      else if (t > 0) setNedtelling(`${t}t ${m}m`);
      else          setNedtelling(`${m}m ${s}s`);
    };
    oppdater();
    const id = setInterval(oppdater, 1000);
    return () => clearInterval(id);
  }, [nesteStream?.tidspunkt]);

  const altOk = health && Object.values(health).every(h => h.ok);

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Live System Status</p>
        <div className="flex items-center gap-2">
          {live && <span className="text-[8px] text-g-green/40 font-mono">↻ 5s</span>}
          {isLive && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[9px] font-black text-red-400">LIVE · {slow?.streamStatus?.viewers ?? 0} seere</span>
            </span>
          )}
        </div>
      </div>

      {/* Service health pills */}
      <div className="flex flex-wrap gap-1.5">
        {HEALTH_LABELS.map(([label, key]) => {
          if (loadingSlow && !health) {
            return <div key={key} className="h-6 w-28 bg-g-border/30 rounded-full animate-pulse" />;
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
              {!h.ok && <span className="text-[8px] opacity-70">{h.melding.slice(0, 20)}</span>}
            </div>
          );
        })}
        {health && !altOk && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/30 text-[10px] font-bold text-red-400 bg-red-500/5">
            ⚠ Feil oppdaget
          </span>
        )}
      </div>

      {/* Active jobs inline */}
      {live && live.activeJobs.length > 0 && (
        <div className="space-y-1.5 border-t border-g-border/30 pt-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Aktive jobber</p>
          {live.activeJobs.map((job, i) => (
            <Link key={i} href={job.href}
              className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-g-bg/50 hover:bg-g-green/[0.03] transition-all group">
              <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[9px] text-g-muted font-bold uppercase">{job.agent}</span>
                <span className="text-[9px] text-g-muted mx-1.5">·</span>
                <span className="text-[10px] text-g-text">{job.task}</span>
              </div>
              {job.progress > 0 && job.progress < 100 && (
                <div className="h-1 w-24 bg-g-border rounded-full overflow-hidden flex-shrink-0">
                  <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${job.progress}%` }} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      {live && live.activeJobs.length === 0 && !loadingLive && (
        <div className="flex items-center gap-2 pt-1 border-t border-g-border/30">
          <span className="w-1.5 h-1.5 rounded-full bg-g-muted/20" />
          <p className="text-[10px] text-g-muted">Ingen aktive jobber</p>
        </div>
      )}

      {/* Next stream */}
      {nesteStream && (
        <div className="flex items-center justify-between border-t border-g-border/30 pt-3">
          <div>
            <p className="text-[9px] text-g-muted font-bold">Neste stream</p>
            <p className="text-sm font-black text-g-text">{nesteStream.dag} kl. {nesteStream.tid} · {nesteStream.spill}</p>
          </div>
          {nedtelling && (
            <span className="font-mono font-black text-g-green text-sm">{nedtelling}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 2. GLOBAL ACTIVITY FEED ──────────────────────────────────────────────────

const SEV_STYLE: Record<string, string> = {
  info:     'text-g-text border-g-border/30',
  warning:  'text-yellow-300 border-yellow-400/30',
  error:    'text-red-300 border-red-400/30',
  critical: 'text-red-400 border-red-500/50 font-bold',
};

const SEV_DOT: Record<string, string> = {
  info:     'bg-g-muted/40',
  warning:  'bg-yellow-400',
  error:    'bg-red-400',
  critical: 'bg-red-500 animate-pulse',
};

const SOURCE_LABEL: Record<string, string> = {
  thumbnail:       'Thumbnail',
  clip_worker:     'Clip Worker',
  content_factory: 'Content Factory',
  discord_bot:     'Discord Bot',
  twitch_bot:      'Twitch Bot',
  recovery_engine: 'Recovery',
  learning:        'AI Learning',
};

function GlobalActivityFeed({ events, loading }: { events: SystemEvent[]; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Global aktivitetsfeed</p>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
              <span className="text-[9px] text-g-green">{events.length} events</span>
            </>
          )}
          <Link href="/api/system-events?limit=100" target="_blank" className="text-[9px] text-g-muted hover:text-g-green transition-colors">
            Se alle →
          </Link>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-[11px] text-g-muted">Ingen system-events ennå – events dukker opp her automatisk fra alle moduler.</p>
      ) : (
        <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
          {events.map((e) => (
            <div key={e.id}
              className={`flex items-start gap-2.5 py-1.5 border-b last:border-0 ${SEV_STYLE[e.severity] ?? SEV_STYLE.info}`}>
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[e.severity] ?? SEV_DOT.info}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[9px] text-g-muted font-bold uppercase">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                  <span className="text-[9px] text-g-muted/40">{e.event_type}</span>
                </div>
                <p className="text-[10px] leading-snug mt-0.5">{e.title}</p>
                {e.description && (
                  <p className="text-[9px] text-g-muted/60 leading-snug">{e.description}</p>
                )}
              </div>
              <span className="text-[9px] text-g-muted/40 flex-shrink-0 mt-1">{tidSiden(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 3. JOB MONITOR ──────────────────────────────────────────────────────────

const VOD_STEPS = [
  { key: 'transcription', label: 'Transkripsjon', statuses: ['PENDING', 'ANALYZING'] },
  { key: 'highlights',    label: 'Highlights',    statuses: ['TRANSCRIBED'] },
  { key: 'clipping',      label: 'Klipp',         statuses: ['CLIPPING', 'READY_FOR_CLIP'] },
  { key: 'thumbnail',     label: 'Thumbnail',     statuses: [] },
  { key: 'done',          label: 'Ferdig',        statuses: ['COMPLETE'] },
];

function vodCurrentStep(vod: VodStatus): number {
  if (vod.status === 'COMPLETE') return 4;
  if (vod.clipping > 0 || vod.readyForClip > 0) return 3;
  if (vod.highlights > 0) return 3;
  if (vod.status === 'TRANSCRIBED') return 2;
  if (vod.status === 'ANALYZING')   return 1;
  return 0;
}

function JobMonitor({ resultater, clipStatus, loading }: {
  resultater: VodStatus[]; clipStatus: LiveData['clipStatus'] | undefined; loading: boolean;
}) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  const aktive = resultater.filter(v => v.status !== 'COMPLETE' && v.status !== 'ERROR');
  const fullforte = resultater.filter(v => v.status === 'COMPLETE' || v.status === 'ERROR').slice(0, 3);

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Job Monitor – VOD Pipeline</p>
        <Link href="/content-factory-admin" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Content Factory →</Link>
      </div>

      {/* Aktive VODs med pipeline-steps */}
      {aktive.length === 0 && fullforte.length === 0 ? (
        <p className="text-xs text-g-muted">Ingen VODs å vise.</p>
      ) : (
        <div className="space-y-3">
          {[...aktive, ...fullforte].slice(0, 5).map(vod => {
            const step   = vodCurrentStep(vod);
            const isPågå = vod.status !== 'COMPLETE' && vod.status !== 'ERROR';
            return (
              <div key={vod.id} className={`rounded-lg border p-3 ${isPågå ? 'border-yellow-400/20 bg-yellow-400/[0.02]' : vod.status === 'ERROR' ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-g-border/30'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold text-g-text truncate flex-1">{vod.title}</p>
                  <span className="text-[9px] text-g-muted flex-shrink-0">{tidSiden(vod.createdAt)}</span>
                </div>

                {vod.status === 'ERROR' ? (
                  <p className="text-[9px] text-red-400">{vod.errorMessage?.slice(0, 100) ?? 'Ukjent feil'}</p>
                ) : (
                  <>
                    {/* Pipeline progress bar */}
                    <div className="flex items-center gap-1 mb-1.5">
                      {VOD_STEPS.map((s, i) => {
                        const done    = i < step;
                        const current = i === step && isPågå;
                        return (
                          <div key={s.key} className="flex items-center gap-1 flex-1">
                            <div className={`flex-1 h-1 rounded-full transition-all ${done ? 'bg-g-green' : current ? 'bg-yellow-400 animate-pulse' : 'bg-g-border/50'}`} />
                            {i < VOD_STEPS.length - 1 && (
                              <span className={`text-[7px] ${done ? 'text-g-green' : 'text-g-border/50'}`}>▸</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between">
                      {VOD_STEPS.map((s, i) => (
                        <span key={s.key} className={`text-[8px] ${i === step && isPågå ? 'text-yellow-400 font-bold' : i < step ? 'text-g-green' : 'text-g-border/50'}`}>
                          {i === step && isPågå ? `▶ ${s.label}` : s.label}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {vod.highlights > 0 && <span className="text-[9px] text-g-muted">{vod.highlights} highlights</span>}
                      {vod.klipp > 0 && <span className="text-[9px] text-g-green font-bold">{vod.klipp} klipp</span>}
                      {vod.clipping > 0 && <span className="text-[9px] text-yellow-400 font-bold animate-pulse">{vod.clipping} klipper</span>}
                      {vod.readyForClip > 0 && <span className="text-[9px] text-blue-400 font-bold">{vod.readyForClip} i kø</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Clip queue summary */}
      {clipStatus && (clipStatus.clipping > 0 || clipStatus.readyForClip > 0) && (
        <div className="mt-3 pt-3 border-t border-g-border/30 flex gap-2">
          {clipStatus.clipping > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-yellow-400/30 bg-yellow-400/5 text-[10px] font-bold text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Klipper {clipStatus.clipping} nå
            </span>
          )}
          {clipStatus.readyForClip > 0 && (
            <span className="px-2.5 py-1 rounded-full border border-blue-400/30 bg-blue-400/5 text-[10px] font-bold text-blue-400">
              {clipStatus.readyForClip} venter
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 4. RECENT AI LEARNING ────────────────────────────────────────────────────

function RecentAiLearning({ innsikter, loading }: { innsikter: AiInnsikt[]; loading: boolean }) {
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!innsikter || innsikter.length === 0) return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">AI lærte nylig</p>
      <p className="text-xs text-g-muted">Ingen nye AI-innsikter siste 24t.</p>
    </div>
  );

  return (
    <div className="bg-g-card border border-g-green/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green" />
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI lærte nylig</p>
        </div>
        <Link href="/ai-memory" className="text-[9px] text-g-muted hover:text-g-green transition-colors">AI Memory →</Link>
      </div>
      <div className="space-y-2">
        {innsikter.map((ins, i) => (
          <div key={i} className="flex gap-3 items-start py-1.5 border-b border-g-border/20 last:border-0">
            <span className="text-g-green text-[9px] font-black flex-shrink-0 mt-0.5">◆</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-g-green">{ins.title}</p>
              <p className="text-[10px] text-g-muted leading-snug">{ins.summary.slice(0, 120)}</p>
            </div>
            <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(ins.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── STREAM CYCLE CHECKLIST ───────────────────────────────────────────────────

function Sjekkliste({ items, loading }: { items: LiveData['sjekkliste']; loading: boolean }) {
  if (loading) return <div className="h-52 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!items.length) return null;
  const ferdig = items.filter(i => i.done).length;
  const pct    = Math.round((ferdig / items.length) * 100);
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Stream-syklus</p>
        <p className="text-[10px] font-mono font-black text-g-green">{ferdig}/{items.length}</p>
      </div>
      <div className="mb-3 h-1 bg-g-border rounded-full overflow-hidden">
        <div className="h-full bg-g-green rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <Link key={i} href={item.href}
            className={`flex items-center gap-2.5 py-1 px-1 rounded hover:bg-white/[0.02] transition-all group ${item.done ? '' : 'opacity-60'}`}>
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[9px] font-black ${
              item.done ? 'border-g-green bg-g-green/10 text-g-green' : 'border-g-border/40 text-transparent'
            }`}>✓</span>
            <span className={`text-[10px] ${item.done ? 'text-g-text' : 'text-g-muted'} group-hover:text-g-text transition-colors`}>
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [slow, setSlow]               = useState<SlowData | null>(null);
  const [live, setLive]               = useState<LiveData | null>(null);
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

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Creator Operations Center</h1>
          <p className="text-[9px] text-g-muted mt-0.5">GLENVEX Creator OS · Ingenting skjer uten at systemet vet om det</p>
        </div>
        <div className="flex items-center gap-3">
          {sistOppdatert && (
            <p className="text-[9px] text-g-muted/50">Live · {tidSiden(sistOppdatert)}</p>
          )}
          <button onClick={hentAlt}
            className="px-2.5 py-1.5 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── SEKSJON 1: Live System Status ────────────────────────────────────── */}
      <LiveSystemStatus
        health={slow?.health ?? null}
        slow={slow}
        live={live}
        loadingSlow={loadingSlow}
        loadingLive={loadingLive}
      />

      {/* ── SEKSJON 2 + 3: Activity Feed + Job Monitor ───────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <GlobalActivityFeed
          events={live?.systemEvents ?? []}
          loading={loadingLive}
        />
        <JobMonitor
          resultater={live?.sisteResultater ?? []}
          clipStatus={live?.clipStatus}
          loading={loadingLive}
        />
      </div>

      {/* ── SEKSJON 4: AI Learning + Sjekkliste ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <RecentAiLearning innsikter={live?.nyesteInnsikter ?? []} loading={loadingLive} />
        <Sjekkliste items={live?.sjekkliste ?? []} loading={loadingLive} />
      </div>

      {/* ── Siste klipp (kompakt) ────────────────────────────────────────────── */}
      {live?.clipStatus?.sisteKlippede && live.clipStatus.sisteKlippede.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste klipp</p>
            <Link href="/content-factory-admin/highlights" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Alle →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {live.clipStatus.sisteKlippede.slice(0, 4).map(h => (
              <div key={h.id} className="flex items-center gap-2 p-2 bg-g-bg/40 border border-g-border/30 rounded-lg">
                <span className="text-g-green text-[10px] flex-shrink-0">🎬</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-g-text truncate">
                    {h.title ?? h.vodTitle?.slice(0, 30) ?? `#${h.id.slice(0, 6)}`}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {h.clip_url_16_9 && (
                    <a href={h.clip_url_16_9} target="_blank" rel="noreferrer"
                      className="px-1.5 py-0.5 bg-g-green/10 border border-g-green/20 rounded text-[8px] text-g-green font-bold hover:bg-g-green/20">16:9</a>
                  )}
                  {h.clip_url_9_16 && (
                    <a href={h.clip_url_9_16} target="_blank" rel="noreferrer"
                      className="px-1.5 py-0.5 bg-g-green/10 border border-g-green/20 rounded text-[8px] text-g-green font-bold hover:bg-g-green/20">9:16</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Hurtiglenker ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Hurtiglenker</p>
        <div className="grid grid-cols-7 gap-2">
          {[
            { href: '/stream-briefing',            icon: '◆', label: 'Stream Briefing' },
            { href: '/ai-producer',                icon: '◈', label: 'AI Producer' },
            { href: '/content-factory-admin',      icon: '▶', label: 'Content Factory' },
            { href: '/content-factory-admin/highlights', icon: '✂', label: 'Highlights' },
            { href: '/pre-live',                   icon: '((•))', label: 'Pre-Live' },
            { href: '/discord',                    icon: '◉', label: 'Discord' },
            { href: '/ai-memory',                  icon: '⬡', label: 'AI Memory' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="bg-g-card border border-g-border rounded-lg p-2.5 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group text-center">
              <p className="text-g-green text-sm">{l.icon}</p>
              <p className="text-[9px] text-g-muted group-hover:text-g-text transition-colors mt-1 leading-tight">{l.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
