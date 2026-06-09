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
interface LærdommTiltak { summary: string; game?: string | null; executedAt: string; agentType?: string; }
interface Lærdom {
  utførteTiltak: LærdommTiltak[];
  avvisteTiltak: { summary: string; executedAt: string }[];
  raidHistorikk: { summary: string; executedAt: string }[];
  totalDatapunkter: number;
  confidenceLabel: string;
  siste30dager: { utført: number; avvist: number; raids: number; analyser: number };
  notat: string;
}
interface AiLearning {
  lastAggregation: string | null;
  lastAggregationTitle: string | null;
  lastFeedbackRun: string | null;
  lastFeedbackTitle: string | null;
  lastMemoryUpdate: string | null;
  lastInsightAt: string | null;
  eventsLast60min: number;
  decisionsLast24h: number;
  feedbackDecisionsLast24h: number;
  sisteInnsikt: { title: string; summary: string; createdAt: string } | null;
}
interface LiveData {
  activeJobs: { agent: string; task: string; progress: number; href: string; detail?: string }[];
  sjekkliste:  { label: string; done: boolean; href: string }[];
  sisteResultater: VodStatus[];
  nesteStream: { dag: string; tid: string; spill: string; tittel: string | null; nedtelling: string | null; tidspunkt: string | null } | null;
  preHype: { status: 'klar'|'planlagt'|'sendt'|'ikke_planlagt'; sendtAt: string|null; tidTilUtsending: string|null } | null;
  clipStatus: { clipping: number; readyForClip: number; sisteKlippede: KlippetHighlight[] };
  nyesteInnsikter: AiInnsikt[];
  liveEvents: any[];
  systemEvents: SystemEvent[];
  kontrollsenter?: { key: string; label: string; status: 'ok'|'feil'|'ingen_aktivitet'; sisteKjøring: string|null; sisteEvent: string|null; sisteTitle: string|null; antall24h: number }[];
  coverage?: { key: string; label: string; lastSeen: string|null; status: 'active'|'stale'|'offline'|'passive'; count24h: number; passive: boolean }[];
  lærdom?: Lærdom;
  aiLearning?: AiLearning;
  debug?: Record<string, any>;
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

const PRE_HYPE_LABEL: Record<string, string> = {
  sendt: '✓ Pre-hype sendt',
  planlagt: '⏳ Pre-hype planlagt',
  klar: '🔔 Pre-hype klar',
  ikke_planlagt: 'Pre-hype ikke satt opp',
};
const PRE_HYPE_COLOR: Record<string, string> = {
  sendt: 'text-g-green border-g-green/20',
  planlagt: 'text-yellow-300 border-yellow-400/20',
  klar: 'text-blue-300 border-blue-400/20',
  ikke_planlagt: 'text-g-muted border-g-border',
};

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
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[9px] text-g-muted font-bold uppercase">{job.agent}</span>
                  <span className="text-[9px] text-g-muted mx-0.5">·</span>
                  <span className="text-[10px] text-g-text">{job.task}</span>
                </div>
                {job.detail && <p className="text-[9px] text-g-muted/60 truncate mt-0.5">{job.detail}</p>}
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

      {/* Next stream + pre-hype */}
      {nesteStream && (
        <div className="border-t border-g-border/30 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] text-g-muted font-bold">Neste stream</p>
              <p className="text-sm font-black text-g-text">{nesteStream.dag} kl. {nesteStream.tid} · {nesteStream.spill}</p>
            </div>
            {nedtelling && (
              <span className="font-mono font-black text-g-green text-sm">{nedtelling}</span>
            )}
          </div>
          {live?.preHype && live.preHype.status !== 'ikke_planlagt' && (
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${PRE_HYPE_COLOR[live.preHype.status] ?? 'text-g-muted'}`}>
                {PRE_HYPE_LABEL[live.preHype.status]}
              </span>
              {live.preHype.status === 'planlagt' && live.preHype.tidTilUtsending && (
                <span className="text-[9px] text-g-muted">Om {live.preHype.tidTilUtsending}</span>
              )}
              {live.preHype.status === 'sendt' && live.preHype.sendtAt && (
                <span className="text-[9px] text-g-muted">{tidSiden(live.preHype.sendtAt)}</span>
              )}
            </div>
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

// ─── KONTROLLSENTER ───────────────────────────────────────────────────────────

const STATUS_FARGE: Record<string, string> = {
  ok:              'text-g-green border-g-green/30 bg-g-green/5',
  feil:            'text-red-400 border-red-500/30 bg-red-500/5',
  ingen_aktivitet: 'text-g-muted border-g-border bg-transparent',
};

const STATUS_DOT: Record<string, string> = {
  ok:              'bg-g-green',
  feil:            'bg-red-400',
  ingen_aktivitet: 'bg-g-muted/40',
};

function Kontrollsenter({ data, loading }: {
  data: LiveData['kontrollsenter'];
  loading: boolean;
}) {
  if (loading || !data) return null;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Kontrollsenter</p>
        <p className="text-[9px] text-g-muted/50">siste 24t</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {data.map(sub => (
          <div key={sub.key}
            className={`border rounded-lg px-2.5 py-2 ${STATUS_FARGE[sub.status]}`}
            title={sub.sisteTitle ?? sub.sisteEvent ?? 'Ingen aktivitet'}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[sub.status]}`} />
              <p className="text-[9px] font-bold truncate">{sub.label}</p>
            </div>
            <p className="text-[9px] text-g-muted truncate">
              {sub.antall24h > 0 ? `${sub.antall24h} events` : 'Ingen aktivitet'}
            </p>
            {sub.sisteKjøring && (
              <p className="text-[8px] text-g-muted/50 mt-0.5 truncate">
                {tidSiden(sub.sisteKjøring)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DETTE VET GLENVEX NÅ ─────────────────────────────────────────────────────

const CONFIDENCE_FARGE: Record<string, string> = {
  for_lite_datagrunnlag: 'text-g-muted border-g-border',
  lav:    'text-yellow-400 border-yellow-400/20',
  medium: 'text-blue-400 border-blue-400/20',
  høy:    'text-g-green border-g-green/20',
};

const COVERAGE_STATUS_BAR: Record<string, string> = {
  active:  'bg-g-green',
  stale:   'bg-yellow-400',
  offline: 'bg-red-500/60',
  passive: 'bg-g-muted/30',
};

function EventCoverage({ data, loading }: { data: LiveData['coverage']; loading: boolean }) {
  if (loading || !data?.length) return null;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Systemdekning</p>
        <p className="text-[9px] text-g-muted/50">events siste 24t</p>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        {data.map(c => (
          <div key={c.key} className="space-y-1">
            <div className={`h-1 rounded-full ${COVERAGE_STATUS_BAR[c.status]}`} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-g-text truncate">{c.label}</p>
              <span className="text-[9px] text-g-muted/60 font-mono">{c.count24h}</span>
            </div>
            <p className="text-[9px] text-g-muted/50">
              {c.lastSeen ? tidSiden(c.lastSeen) : c.passive ? 'ingen feil' : 'ingen aktivitet'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetteVetGlenvex({ data, loading }: { data: Lærdom | undefined; loading: boolean }) {
  if (loading || !data) return null;
  const { utførteTiltak, siste30dager, confidenceLabel, notat, totalDatapunkter } = data;
  const harData = totalDatapunkter > 0;
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Dette vet GLENVEX nå</p>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${CONFIDENCE_FARGE[confidenceLabel] ?? CONFIDENCE_FARGE.lav}`}>
          {confidenceLabel === 'for_lite_datagrunnlag' ? 'Lite data' : `Confidence: ${confidenceLabel}`}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Analyser', val: siste30dager.analyser },
          { label: 'Utført', val: siste30dager.utført, color: 'text-g-green' },
          { label: 'Avvist', val: siste30dager.avvist, color: 'text-g-muted' },
          { label: 'Raids', val: siste30dager.raids },
        ].map(({ label, val, color }) => (
          <div key={label} className="text-center border border-g-border/30 rounded-lg py-1.5 px-2">
            <p className={`text-lg font-black font-mono ${color ?? 'text-g-text'}`}>{val}</p>
            <p className="text-[8px] text-g-muted uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>

      {/* Siste utførte tiltak */}
      {utførteTiltak.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[9px] text-g-muted font-bold uppercase tracking-widest mb-1.5">Siste utførte tiltak</p>
          {utførteTiltak.slice(0, 4).map((t, i) => (
            <div key={i} className="flex items-start gap-2 py-1 border-b border-g-border/20 last:border-0">
              <span className="w-1 h-1 rounded-full bg-g-green mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-g-text leading-snug">{t.summary.slice(0, 90)}</p>
                {t.game && <p className="text-[9px] text-g-muted">{t.game}</p>}
              </div>
              <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(t.executedAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-g-muted">{notat}</p>
      )}

      {harData && (
        <p className="text-[9px] text-g-muted/50 mt-2 border-t border-g-border/20 pt-2">{notat}</p>
      )}
    </div>
  );
}

function GlobalActivityFeed({ events, loading }: { events: SystemEvent[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          {events.map((e) => {
            const isExpanded = expandedId === e.id;
            const hasMeta = e.metadata && Object.keys(e.metadata).length > 0;
            return (
              <div key={e.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  className={`w-full text-left flex items-start gap-2.5 py-1.5 border-b last:border-0 transition-colors ${SEV_STYLE[e.severity] ?? SEV_STYLE.info} ${hasMeta ? 'cursor-pointer hover:bg-white/[0.02]' : 'cursor-default'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[e.severity] ?? SEV_DOT.info}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[9px] text-g-muted font-bold uppercase">
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </span>
                      <span className="text-[9px] text-g-muted/40">{e.event_type}</span>
                      {hasMeta && <span className="text-[8px] text-g-muted/30">{isExpanded ? '▲' : '▼'}</span>}
                    </div>
                    <p className="text-[10px] leading-snug mt-0.5">{e.title}</p>
                    {e.description && (
                      <p className="text-[9px] text-g-muted/60 leading-snug">{e.description}</p>
                    )}
                  </div>
                  <span className="text-[9px] text-g-muted/40 flex-shrink-0 mt-1">{tidSiden(e.created_at)}</span>
                </button>
                {isExpanded && hasMeta && (
                  <div className="ml-4 mb-1.5 p-2 bg-g-bg/40 border border-g-border/20 rounded-lg">
                    <p className="text-[8px] text-g-muted/50 uppercase font-bold mb-1">Metadata</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {Object.entries(e.metadata!).slice(0, 12).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-1 min-w-0">
                          <span className="text-[8px] text-g-muted/50 font-mono shrink-0">{k}</span>
                          <span className="text-[9px] text-g-text font-mono truncate">
                            {typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v ?? '—').slice(0, 80)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[8px] text-g-muted/30 mt-1.5 font-mono">{new Date(e.created_at).toLocaleString('no-NO')}</p>
                  </div>
                )}
              </div>
            );
          })}
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

// ─── 4. AI LEARNING PANEL ────────────────────────────────────────────────────

function alderLabel(ts: string | null): string {
  if (!ts) return '—';
  const sek = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sek < 60)    return 'akkurat nå';
  if (sek < 3600)  return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return `${Math.floor(sek / 86400)}d siden`;
}

function healthDot(ts: string | null, warnMs: number): string {
  if (!ts) return 'bg-g-muted/30';
  const age = Date.now() - new Date(ts).getTime();
  if (age > warnMs * 3) return 'bg-red-400';
  if (age > warnMs) return 'bg-yellow-400';
  return 'bg-g-green';
}

function RecentAiLearning({ innsikter, aiLearning, loading }: { innsikter: AiInnsikt[]; aiLearning?: AiLearning; loading: boolean }) {
  if (loading) return <div className="h-40 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  const harInnsikter = innsikter && innsikter.length > 0;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {harInnsikter && <span className="w-1.5 h-1.5 rounded-full bg-g-green" />}
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Learning</p>
        </div>
        <Link href="/ai-memory" className="text-[9px] text-g-muted hover:text-g-green transition-colors">AI Memory →</Link>
      </div>

      {/* Health metrics grid */}
      {aiLearning && (
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Siste aggregering', ts: aiLearning.lastAggregation, warnMs: 20 * 60_000 },
            { label: 'Siste feedback-run', ts: aiLearning.lastFeedbackRun, warnMs: 70 * 60_000 },
            { label: 'Siste memory-update', ts: aiLearning.lastMemoryUpdate, warnMs: 35 * 60_000 },
            { label: 'Siste innsikt', ts: aiLearning.lastInsightAt, warnMs: 35 * 60_000 },
          ].map(({ label, ts, warnMs }) => (
            <div key={label} className="flex items-center gap-1.5 py-1 px-1.5 rounded border border-g-border/20 bg-g-bg/30">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(ts, warnMs)}`} />
              <div className="min-w-0">
                <p className="text-[8px] text-g-muted/60 leading-none">{label}</p>
                <p className="text-[9px] text-g-text font-mono leading-snug">{alderLabel(ts)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Counts row */}
      {aiLearning && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.eventsLast60min}</span> events/60 min
          </span>
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.decisionsLast24h}</span> beslutninger/24t
          </span>
          <span className="text-[9px] text-g-muted px-2 py-0.5 border border-g-border/20 rounded-full">
            <span className="font-mono font-black text-g-text">{aiLearning.feedbackDecisionsLast24h}</span> med feedback
          </span>
        </div>
      )}

      {/* Siste læringspunkt */}
      {aiLearning?.sisteInnsikt ? (
        <div className="border-t border-g-border/20 pt-2">
          <p className="text-[8px] text-g-muted/50 uppercase font-bold mb-1">Siste læringspunkt</p>
          <p className="text-[10px] font-bold text-g-green">{aiLearning.sisteInnsikt.title}</p>
          <p className="text-[9px] text-g-muted leading-snug mt-0.5">{aiLearning.sisteInnsikt.summary.slice(0, 140)}</p>
          <p className="text-[8px] text-g-muted/40 mt-1">{tidSiden(aiLearning.sisteInnsikt.createdAt)}</p>
        </div>
      ) : !harInnsikter ? (
        <p className="text-[10px] text-g-muted border-t border-g-border/20 pt-2">Ingen nye AI-innsikter ennå.</p>
      ) : null}

      {/* Øvrige innsikter */}
      {harInnsikter && (
        <div className="space-y-1.5 border-t border-g-border/20 pt-2">
          {innsikter.slice(0, 3).map((ins, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className="text-g-green text-[9px] font-black flex-shrink-0 mt-0.5">◆</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-g-green">{ins.title}</p>
                <p className="text-[9px] text-g-muted leading-snug">{ins.summary.slice(0, 100)}</p>
              </div>
              <span className="text-[9px] text-g-muted/40 flex-shrink-0">{tidSiden(ins.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── STREAM CYCLE CHECKLIST ───────────────────────────────────────────────────

function Sjekkliste({ items, loading, onReset }: { items: LiveData['sjekkliste']; loading: boolean; onReset: () => void }) {
  if (loading) return <div className="h-52 bg-g-card border border-g-border rounded-xl animate-pulse" />;
  if (!items.length) return null;
  const ferdig = items.filter(i => i.done).length;
  const pct    = Math.round((ferdig / items.length) * 100);
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Stream-syklus</p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-mono font-black text-g-green">{ferdig}/{items.length}</p>
          {ferdig > 0 && (
            <button onClick={onReset}
              className="text-[9px] text-g-muted/50 hover:text-g-muted transition-colors px-1.5 py-0.5 border border-g-border/30 rounded"
              title="Nullstill stream-syklus">
              ↺ Reset
            </button>
          )}
        </div>
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
  const [visDebug, setVisDebug]       = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

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

  const hentAlt = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([hentLive(), hentSlow()]);
    setRefreshing(false);
  }, [hentLive, hentSlow]);

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
          <button onClick={hentAlt} disabled={refreshing}
            className={`px-2.5 py-1.5 border rounded text-[9px] transition-all ${
              refreshing
                ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
            }`}>
            {refreshing ? '↻ Laster...' : '↻ Refresh'}
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

      {/* ── KONTROLLSENTER ──────────────────────────────────────────────────── */}
      <Kontrollsenter data={live?.kontrollsenter} loading={loadingLive} />

      {/* ── SYSTEMDEKNING ───────────────────────────────────────────────────── */}
      <EventCoverage data={live?.coverage} loading={loadingLive} />

      {/* ── DETTE VET GLENVEX NÅ ────────────────────────────────────────────── */}
      <DetteVetGlenvex data={live?.lærdom} loading={loadingLive} />

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
        <RecentAiLearning innsikter={live?.nyesteInnsikter ?? []} aiLearning={live?.aiLearning} loading={loadingLive} />
        <Sjekkliste items={live?.sjekkliste ?? []} loading={loadingLive} onReset={async () => {
          await fetch('/api/stream-syklus/reset', { method: 'POST' });
          hentLive();
        }} />
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

      {/* ── Debug panel ──────────────────────────────────────────────────────── */}
      {live?.debug && (
        <div className="border border-g-border/30 rounded-lg overflow-hidden">
          <button onClick={() => setVisDebug(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left">
            <span className="text-[9px] text-g-muted/60 uppercase tracking-widest font-bold">Debug</span>
            <span className="text-[9px] text-g-muted/40">{visDebug ? '▲ Skjul' : '▼ Vis'}</span>
          </button>
          {visDebug && (
            <div className="px-4 py-3 bg-g-bg/20 grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(live.debug).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <span className="text-[9px] text-g-muted/50 font-mono w-32 flex-shrink-0">{k}</span>
                  <span className="text-[9px] text-g-text font-mono truncate">{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Hurtiglenker ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Hurtiglenker</p>
        <div className="grid grid-cols-6 gap-2">
          {[
            { href: '/stream-briefing',            icon: '◆', label: 'Stream Briefing' },
            { href: '/ai-producer',                icon: '◈', label: 'AI Producer' },
            { href: '/content-factory-admin',      icon: '▶', label: 'Content Factory' },
            { href: '/content-factory-admin/highlights', icon: '✂', label: 'Highlights' },
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
