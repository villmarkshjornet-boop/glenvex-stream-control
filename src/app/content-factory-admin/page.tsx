'use client';

import { useEffect, useState, useCallback, useRef, memo } from 'react';

// ─── Typer ────────────────────────────────────────────────────────────────────
interface Vod {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string;
  twitch_vod_id?: string;
  duration_seconds?: number;
  current_step?: string;
  progress_percent?: number;
  status_message?: string;
  error_message?: string;
}

interface RailwayStatus {
  status: string;
  melding?: string;
  segmenter?: number;
  transcribed?: boolean;
  sisteOppdatering?: string;
  _pollTid?: string;
}

interface HealthStatus { ok: boolean; melding: string; }
interface Health {
  railway: HealthStatus;
  supabase: HealthStatus;
  storage: HealthStatus;
  openai: HealthStatus;
  twitch: HealthStatus;
  altOk: boolean;
}

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────
function tidSiden(dato: string): string {
  const d = new Date(dato);
  if (isNaN(d.getTime())) return '–';
  const sek = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sek < 60) return `${sek}s siden`;
  if (sek < 3600) return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return d.toLocaleDateString('no-NO');
}

function statusFarge(status: string) {
  if (status === 'COMPLETE') return 'text-g-green';
  if (status === 'FAILED') return 'text-red-400';
  if (['ANALYZING', 'PROCESSING', 'PENDING'].includes(status)) return 'text-yellow-400';
  return 'text-blue-400';
}

function barFarge(status: string) {
  if (status === 'COMPLETE') return 'bg-g-green';
  if (status === 'FAILED') return 'bg-red-500';
  if (['ANALYZING', 'PROCESSING'].includes(status)) return 'bg-yellow-400';
  return 'bg-blue-400';
}

const PIPELINE_STEG = [
  { id: 'DOWNLOAD',     label: 'Nedlasting' },
  { id: 'TRANSCRIBING', label: 'Transkripsjon' },
  { id: 'DISCOVER',     label: 'Highlights' },
  { id: 'RANK',         label: 'Rangering' },
  { id: 'COPYWRITE',    label: 'Tekster' },
  { id: 'CLIP',         label: 'Klipp' },
  { id: 'COMPLETE',     label: 'Ferdig' },
];

// ─── VOD Timeline ─────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  source: string;
  event_type: string;
  title: string;
  description?: string;
  severity: string;
  metadata?: any;
  created_at: string;
}

const TIMELINE_ORDER = [
  'VOD_DETECTED', 'DOWNLOAD_STARTED', 'DOWNLOAD_DONE', 'DOWNLOAD_COMPLETED', 'DOWNLOAD_FAILED',
  'TRANSCRIPTION_STARTED', 'TRANSCRIPTION_COMPLETED', 'TRANSCRIPTION_DONE',
  'TRANSCRIPTION_FAILED_ZERO_SEGMENTS', 'TRANSCRIPTION_FAILED',
  'PHASE2_TRIGGER_DELAYED_FOR_DB_COMMIT', 'PHASE2_TRIGGER_STARTED',
  'DISCOVERY_STARTED', 'DISCOVERY_COMPLETED',
  'RANKING_COMPLETED', 'COPYWRITING_COMPLETED',
  'VOD_PIPELINE_DONE',
  'CLIP_EXTRACTED', 'THUMBNAIL_DONE',
];

const SEV_DOT_TL: Record<string, string> = {
  info:    'bg-g-muted/60',
  warning: 'bg-yellow-400',
  error:   'bg-red-400',
  critical:'bg-red-500',
  success: 'bg-g-green',
};

const SEV_TEXT_TL: Record<string, string> = {
  info:    'text-g-text',
  warning: 'text-yellow-300',
  error:   'text-red-300',
  critical:'text-red-400',
  success: 'text-g-green',
};

function tidKort(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const VodTimeline = memo(function VodTimeline({ vodId }: { vodId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hentet, setHentet] = useState(false);

  useEffect(() => {
    if (hentet) return;
    setLoading(true);
    setHentet(true);
    // Hent events siste 30 dager for denne VOD-en
    fetch(`/api/system-events?vodId=${encodeURIComponent(vodId)}&minutesBack=43200&limit=100`)
      .then(r => r.json())
      .then(d => {
        // Sort ascending for timeline view
        const sorted = (d.events ?? []).sort(
          (a: TimelineEvent, b: TimelineEvent) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setEvents(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vodId, hentet]);

  if (loading) return (
    <div className="space-y-1.5 py-1">
      {[1, 2, 3].map(i => <div key={i} className="h-6 bg-g-bg border border-g-border rounded animate-pulse" />)}
    </div>
  );

  if (!events.length) return (
    <p className="text-[9px] text-g-muted py-2">Ingen system-events funnet for denne VOD-en.</p>
  );

  const isError = (e: TimelineEvent) => e.severity === 'error' || e.severity === 'critical' || e.event_type.includes('FAILED');

  return (
    <div className="space-y-0">
      {events.map((e, idx) => (
        <div key={e.id} className="flex gap-2.5 group">
          {/* Connector line */}
          <div className="flex flex-col items-center flex-shrink-0">
            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT_TL[e.severity] ?? SEV_DOT_TL.info}`} />
            {idx < events.length - 1 && <div className="w-px flex-1 bg-g-border/40 mt-0.5" />}
          </div>
          {/* Content */}
          <div className={`pb-2 flex-1 min-w-0 ${isError(e) ? 'bg-red-500/5 border border-red-500/10 rounded-lg px-2 py-1 -ml-0.5 mb-0.5' : ''}`}>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className={`text-[8px] font-bold uppercase font-mono ${isError(e) ? 'text-red-400' : 'text-g-muted/50'}`}>
                {e.event_type}
              </span>
              <span className="text-[8px] text-g-muted/30 font-mono">{tidKort(e.created_at)}</span>
            </div>
            <p className={`text-[10px] leading-snug ${SEV_TEXT_TL[e.severity] ?? SEV_TEXT_TL.info}`}>{e.title}</p>
            {e.description && <p className="text-[9px] text-g-muted/60 leading-snug">{e.description}</p>}
            {e.metadata && isError(e) && (
              <p className="text-[9px] text-red-400/60 font-mono mt-0.5 break-all">
                {e.metadata.possible_reason ?? e.metadata.error ?? ''}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Komponent ─────────────────────────────────────────────────────────────────
export default function ContentFactoryAdminPage() {
  const [vods, setVods] = useState<Vod[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [vodInput, setVodInput] = useState('');
  const [starter, setStarter] = useState(false);
  const [startFeil, setStartFeil] = useState('');
  const [nyligStartet, setNyligStartet] = useState<string | null>(null);
  const [railwayStatusMap, setRailwayStatusMap] = useState<Record<string, RailwayStatus>>({});
  const [phase2Running, setPhase2Running] = useState<string | null>(null);
  const [phase2Res, setPhase2Res] = useState<Record<string, any>>({});
  const autoTriggertRef = useRef<Set<string>>(new Set());
  const [aktivertVod, setAktivertVod] = useState<string | null>(null);
  const [monitorertKanal, setMonitorertKanal] = useState<string | null>(null);
  const [aktivert, setAktivert] = useState<boolean | null>(null);
  const [detekterer, setDetekterer] = useState(false);
  const [detektFeil, setDetektFeil] = useState('');
  const [sisteVods, setSisteVods] = useState<{ id: string; title: string; duration: string; published_at: string; url: string }[]>([]);

  const hentVods = useCallback(async () => {
    const res = await fetch('/api/content-factory').catch(() => null);
    if (!res) return;
    if (res.status === 403) { setAktivert(false); return; }
    setAktivert(true);
    const d = await res.json().catch(() => ({}));
    setVods(d.vods ?? []);
  }, []);

  const loggEvent = useCallback(async (event_type: string, title: string, severity: string, metadata?: any) => {
    fetch('/api/system-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'content_factory', event_type, title, severity, metadata }),
    }).catch(() => {});
  }, []);

  // Last inn sessionStorage-persistert auto-trigger-sett ved første render
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('cf_auto_triggered');
      if (stored) {
        const ids: string[] = JSON.parse(stored);
        ids.forEach(id => autoTriggertRef.current.add(id));
      }
    } catch {}

    // Hent hvilken kanal som overvåkes
    fetch('/api/vod/detect-latest').then(r => r.json()).then(d => {
      if (d.channel) setMonitorertKanal(d.channel);
    }).catch(() => {});
  }, []);

  const kjørCleanup = useCallback(async () => {
    const res = await fetch('/api/content-factory/cleanup', { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.ryddet > 0) await hentVods();
    }
  }, [hentVods]);

  useEffect(() => {
    hentVods();
    kjørCleanup();
    const id = setInterval(hentVods, 10_000);
    const cleanupId = setInterval(kjørCleanup, 60_000);
    return () => { clearInterval(id); clearInterval(cleanupId); };
  }, [hentVods, kjørCleanup]);

  useEffect(() => {
    const transcribed = vods.filter(v => v.status === 'TRANSCRIBED');
    for (const v of transcribed) {
      if (autoTriggertRef.current.has(v.id) || phase2Running === v.id) {
        // Already triggered or running — skip silently (no repeated event)
        continue;
      }
      autoTriggertRef.current.add(v.id);

      // Persist til sessionStorage så reload ikke trigger på nytt
      try {
        const stored: string[] = JSON.parse(sessionStorage.getItem('cf_auto_triggered') ?? '[]');
        if (!stored.includes(v.id)) {
          stored.push(v.id);
          sessionStorage.setItem('cf_auto_triggered', JSON.stringify(stored));
        }
      } catch {}

      // Log commit-wait start
      loggEvent('PHASE2_TRIGGER_DELAYED_FOR_DB_COMMIT',
        `Phase 2 venter 2s for DB-commit: ${v.title ?? v.id}`,
        'info',
        { vodId: v.id, delay_ms: 2000 });

      // 2s delay for å sikre at alle transkripsjonssegmenter er committet i Supabase
      const id = v.id;
      setTimeout(() => kjørPhase2(id), 2000);
    }
  }, [vods, loggEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  const sjekkHealth = async () => {
    setHealthLoading(true);
    const res = await fetch('/api/content-factory/health').catch(() => null);
    if (res?.ok) setHealth(await res.json());
    setHealthLoading(false);
  };

  useEffect(() => { sjekkHealth(); }, []);

  useEffect(() => {
    const aktive = vods.filter(v => ['PENDING', 'ANALYZING'].includes(v.status));
    if (aktive.length === 0) return;
    const poll = async () => {
      for (const v of aktive) {
        const res = await fetch(`/api/content-factory/railway-status/${v.id}`).catch(() => null);
        if (!res?.ok) continue;
        const st: RailwayStatus = await res.json();
        st._pollTid = new Date().toISOString();
        setRailwayStatusMap(prev => ({ ...prev, [v.id]: st }));
        if (st.status === 'COMPLETE' && st.transcribed) {
          setRailwayStatusMap(prev => ({ ...prev, [v.id]: { ...st, status: 'RAILWAY_COMPLETE' } }));
        }
      }
    };
    poll();
    const id = setInterval(poll, 8_000);
    return () => clearInterval(id);
  }, [vods]);

  async function startPipeline() {
    if (!vodInput.trim()) return;
    setStarter(true); setStartFeil(''); setNyligStartet(null);
    const res = await fetch('/api/content-factory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: vodInput.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      setStartFeil(d.railwayFeil ?? d.error ?? 'Ukjent feil');
    } else {
      setNyligStartet(d.vodId);
      setVodInput('');
      await hentVods();
    }
    setStarter(false);
  }

  async function kjørPhase2(vodId: string) {
    setPhase2Running(vodId);
    setPhase2Res(prev => ({ ...prev, [vodId]: null }));
    const res = await fetch('/api/content-factory/phase2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId }),
    });
    const d = await res.json().catch(() => ({ error: 'Timeout/feil' }));
    setPhase2Res(prev => ({ ...prev, [vodId]: d }));
    setPhase2Running(null);
    await hentVods();
  }

  async function retryRailway(vodId: string) {
    const res = await fetch('/api/content-factory/retry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId }),
    });
    if (res.ok) await hentVods();
  }

  async function slettVod(vodId: string, tittel: string) {
    if (!confirm(`Slett "${tittel}" og alle transkripter, highlights og klipp?\n\nKan ikke angres.`)) return;
    await fetch(`/api/content-factory/${vodId}`, { method: 'DELETE' });
    await hentVods();
  }

  async function hentSisteVodFraTwitch() {
    setDetekterer(true); setDetektFeil('');
    const previewRes = await fetch('/api/vod/detect-latest').catch(() => null);
    if (previewRes?.ok) { const d = await previewRes.json(); setSisteVods(d.vods ?? []); }
    setDetekterer(false);
  }

  async function startLatestVodPipeline() {
    setDetekterer(true); setDetektFeil('');
    const res = await fetch('/api/vod/detect-latest', { method: 'POST' }).catch(() => null);
    if (!res) { setDetektFeil('Nettverksfeil'); setDetekterer(false); return; }
    const d = await res.json();
    if (d.ok) {
      setNyligStartet(d.vodId ?? d.vod?.id ?? null);
      setSisteVods([]);
      await hentVods();
    } else if (d.alleredeBehandlet) {
      setDetektFeil(d.melding);
    } else {
      setDetektFeil((d.error ?? d.detalj ?? 'Ukjent feil') + (d.hint ? ` – ${d.hint}` : ''));
    }
    setDetekterer(false);
  }

  async function slettAlle() {
    if (!confirm(`Slett ALLE ${vods.length} VODs og all data?\n\nKan ikke angres.`)) return;
    for (const v of vods) await fetch(`/api/content-factory/${v.id}`, { method: 'DELETE' });
    await hentVods();
  }

  // ─── States ────────────────────────────────────────────────────────────────
  if (aktivert === false) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="border border-red-500/30 bg-red-500/5 rounded-2xl p-8 text-center max-w-sm">
          <p className="text-red-400 font-black text-lg mb-2">Content Factory deaktivert</p>
          <p className="text-g-muted text-xs">Sett <code className="text-red-400 font-mono">CONTENT_FACTORY_ENABLED=true</code> i Vercel og Railway</p>
        </div>
      </div>
    );
  }

  if (aktivert === null) return (
    <div className="flex items-center justify-center h-64">
      <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
    </div>
  );

  const aktiveVods = vods.filter(v => ['PENDING', 'ANALYZING', 'TRANSCRIBED'].includes(v.status));
  const ferdige = vods.filter(v => v.status === 'COMPLETE');
  const feilede = vods.filter(v => v.status === 'FAILED');

  return (
    <div className="space-y-6">

      {/* ─── KPI-rad ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Aktive jobber', value: aktiveVods.length, accent: aktiveVods.length > 0 ? 'text-yellow-400' : 'text-g-muted' },
          { label: 'Fullførte VODs', value: ferdige.length, accent: 'text-g-green' },
          { label: 'Feilede', value: feilede.length, accent: feilede.length > 0 ? 'text-red-400' : 'text-g-muted' },
          { label: 'Totalt', value: vods.length, accent: 'text-g-text' },
        ].map(k => (
          <div key={k.label} className="bg-g-card border border-g-border rounded-2xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-1">{k.label}</p>
            <p className={`text-3xl font-black ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ─── Hoved-grid: System Health + Start ny ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* System Health */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-black">System Health</p>
            <button onClick={sjekkHealth} disabled={healthLoading}
              className="text-[9px] text-g-muted hover:text-g-green transition-colors px-2 py-1 border border-g-border rounded-lg">
              {healthLoading ? '⟳ Sjekker...' : '↻ Sjekk nå'}
            </button>
          </div>
          {health ? (
            <div className="space-y-2">
              {[
                { label: 'Railway',  ...health.railway },
                { label: 'Supabase', ...health.supabase },
                { label: 'Storage',  ...health.storage },
                { label: 'OpenAI',   ...health.openai },
                { label: 'Twitch',   ...health.twitch },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? 'bg-g-green' : 'bg-red-400'}`} />
                  <span className="text-[11px] font-bold text-g-text w-20 flex-shrink-0">{s.label}</span>
                  <span className={`text-[10px] truncate ${s.ok ? 'text-g-muted' : 'text-red-400'}`}>{s.melding}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-5 bg-g-bg border border-g-border rounded animate-pulse" />)}
            </div>
          )}
          {health && !health.altOk && (
            <div className="mt-4 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
              <p className="text-[10px] text-red-400">Pipeline vil feile inntil alle tjenester er grønne.</p>
            </div>
          )}
        </div>

        {/* Start ny jobb */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5 flex flex-col gap-4">
          {/* Auto-detect */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-black">Hent siste VOD automatisk</p>
              {monitorertKanal && (
                <span className="text-[9px] text-g-muted font-mono">
                  twitch.tv/<span className="text-g-green">{monitorertKanal}</span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={hentSisteVodFraTwitch} disabled={detekterer}
                className="flex-1 px-3 py-2 border border-g-border text-g-muted text-[11px] font-bold rounded-xl hover:text-g-green hover:border-g-green/30 transition-all disabled:opacity-40">
                {detekterer ? '⏳ Henter...' : '↻ Forhåndsvis'}
              </button>
              <button onClick={startLatestVodPipeline} disabled={detekterer}
                className="flex-1 px-3 py-2 bg-g-green text-black text-[11px] font-black rounded-xl hover:bg-g-green/80 transition-all disabled:opacity-40">
                {detekterer ? '⏳...' : '▶ Start siste VOD'}
              </button>
            </div>
            {sisteVods.length > 0 && (
              <div className="mt-3 space-y-1">
                {sisteVods.map(v => (
                  <div key={v.id} className="flex items-center gap-2 p-2 rounded-lg bg-g-bg border border-g-border text-[10px]">
                    <span className="font-mono text-g-muted">{v.id}</span>
                    <span className="flex-1 text-g-text truncate">{v.title}</span>
                    <span className="text-g-muted flex-shrink-0">{v.duration}</span>
                  </div>
                ))}
              </div>
            )}
            {detektFeil && <p className="mt-2 text-[10px] text-red-400 p-2 bg-red-500/5 border border-red-500/20 rounded-lg">{detektFeil}</p>}
          </div>

          <div className="border-t border-g-border/40" />

          {/* Manuell ID */}
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-black mb-3">Manuelt med VOD-ID</p>
            <div className="flex gap-2">
              <input
                value={vodInput}
                onChange={e => setVodInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startPipeline()}
                placeholder="Twitch VOD ID eller full URL..."
                className="flex-1 bg-g-bg border border-g-border rounded-xl px-3 py-2 text-[11px] text-g-text outline-none focus:border-g-green/50 font-mono"
              />
              <button onClick={startPipeline} disabled={!vodInput.trim() || starter}
                className="px-4 py-2 bg-g-green/10 border border-g-green/30 text-g-green text-[11px] font-black rounded-xl hover:bg-g-green/20 transition-all disabled:opacity-40 whitespace-nowrap">
                {starter ? <span className="flex items-center gap-1"><span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" /> Starter...</span> : '◆ Start'}
              </button>
            </div>
            <p className="text-[9px] text-g-muted mt-1.5">twitch.tv/videos/[TALL] – ta tallene fra URL</p>
          </div>

          {startFeil && (
            <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
              <p className="text-[10px] text-red-400 font-bold mb-1">Pipeline feilet</p>
              <p className="text-[10px] text-red-400 font-mono break-all">{startFeil}</p>
            </div>
          )}
          {nyligStartet && (
            <div className="p-3 bg-g-green/5 border border-g-green/20 rounded-xl">
              <p className="text-[10px] text-g-green font-bold">Pipeline startet! Railway laster ned og transkriberer.</p>
              <p className="text-[9px] text-g-muted mt-1">10–45 min avhengig av VOD-lengde. Oppdateres automatisk.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Aktive jobber ────────────────────────────────────────────────────── */}
      {aktiveVods.length > 0 && (
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-black mb-3">
            Aktive jobber <span className="text-yellow-400 ml-1">({aktiveVods.length})</span>
          </p>
          <div className="space-y-3">
            {aktiveVods.map(v => {
              const rs = railwayStatusMap[v.id];
              const pct = v.progress_percent ?? 10;
              const erRailwayFerdig = rs?.status === 'COMPLETE' || rs?.status === 'RAILWAY_COMPLETE';
              const erUkjent = rs?.status === 'UNKNOWN';
              const minderAktiv = Math.floor((Date.now() - new Date(v.created_at).getTime()) / 60000);
              const erHengt = erUkjent && minderAktiv > 10;
              const stuckTerskel = rs?.status === 'DOWNLOADING' ? 50 : rs?.status === 'TRANSCRIBING' ? 20 : 10;
              const oppdatertTs = rs?.sisteOppdatering ?? rs?._pollTid;
              const minSiden = oppdatertTs ? Math.floor((Date.now() - new Date(oppdatertTs).getTime()) / 60000) : null;
              const erStuck = !erUkjent && minSiden !== null && minSiden >= stuckTerskel;

              return (
                <div key={v.id} className={`bg-g-card border rounded-2xl p-5 ${erHengt ? 'border-red-500/30' : 'border-yellow-400/20'}`}>
                  <div className="flex items-start gap-4">
                    <span className={`w-4 h-4 border-2 rounded-full flex-shrink-0 mt-1 animate-spin ${erHengt ? 'border-red-500/40 border-t-red-400' : 'border-yellow-400/40 border-t-yellow-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-g-text truncate">{v.title}</p>
                      <p className="text-[10px] text-g-muted mt-0.5">{v.category} · startet {tidSiden(v.created_at)}</p>
                      <div className="mt-3 h-1.5 bg-g-border rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-1000 ${barFarge(v.status)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px]">
                          {v.status === 'TRANSCRIBED'
                            ? <span className="text-g-green font-bold">✓ Transkribering ferdig – Phase 2 starter...</span>
                            : <span className="text-g-muted">{v.status_message ?? v.current_step ?? v.status}</span>}
                        </p>
                        <span className="text-[10px] text-g-muted">{pct}%</span>
                      </div>
                      {rs && (
                        <div className={`mt-2 flex items-center gap-2 text-[10px] p-2 rounded-lg ${erHengt || erStuck ? 'bg-red-500/5 border border-red-500/20' : 'bg-g-bg/50'}`}>
                          <span className="text-g-muted">Railway:</span>
                          <span className={`font-bold ${erRailwayFerdig ? 'text-g-green' : erUkjent ? 'text-red-400' : erStuck ? 'text-red-400' : 'text-yellow-400'}`}>{rs.status}</span>
                          {rs.melding && <span className="text-g-muted truncate">– {rs.melding.slice(0, 60)}</span>}
                          {rs.segmenter && <span className="text-g-green ml-auto">({rs.segmenter} seg)</span>}
                          {(erHengt || erStuck) && <span className="text-red-400 font-bold ml-auto">⚠ STUCK</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex flex-col gap-2">
                      {erRailwayFerdig && (
                        <button onClick={() => kjørPhase2(v.id)} disabled={phase2Running === v.id}
                          className="px-4 py-2 bg-g-green text-black text-[11px] font-black rounded-xl hover:bg-g-green/80 transition-all disabled:opacity-40">
                          {phase2Running === v.id ? '⏳...' : '◆ Phase 2'}
                        </button>
                      )}
                      <button onClick={() => retryRailway(v.id)}
                        className={`px-4 py-2 border text-[11px] font-bold rounded-xl transition-all ${erHengt ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' : 'border-g-border text-g-muted hover:border-red-500/30 hover:text-red-400'}`}>
                        ↺ {erHengt ? 'Retry' : 'Reset'}
                      </button>
                    </div>
                  </div>
                  {phase2Res[v.id] && (
                    <div className={`mt-3 p-3 rounded-xl border text-[11px] ${phase2Res[v.id].ok ? 'border-g-green/30 bg-g-green/5 text-g-green' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
                      {phase2Res[v.id].ok ? `✓ ${phase2Res[v.id].antallHighlights} highlights · ${phase2Res[v.id].antallCopy} tekster` : `✗ ${phase2Res[v.id].error}`}
                    </div>
                  )}
                  {/* Pipeline-tidslinje for aktiv jobb */}
                  <details className="mt-3 group">
                    <summary className="text-[9px] text-g-muted cursor-pointer hover:text-g-green transition-colors select-none">
                      ▶ Vis pipeline-tidslinje
                    </summary>
                    <div className="mt-2 pl-2 border-l border-g-border/40">
                      <VodTimeline vodId={v.id} />
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Feilede ──────────────────────────────────────────────────────────── */}
      {feilede.length > 0 && (
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-black mb-3">
            Feilede <span className="text-red-400 ml-1">({feilede.length})</span>
          </p>
          <div className="space-y-2">
            {feilede.map(v => (
              <div key={v.id} className="bg-g-card border border-red-500/20 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-red-400 truncate">{v.title}</p>
                    <p className="text-[9px] text-g-muted">{tidSiden(v.created_at)}</p>
                    {v.error_message && <p className="text-[9px] text-red-400 mt-1 font-mono break-all">{v.error_message}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => retryRailway(v.id)}
                      className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold rounded-xl hover:bg-red-500/20 transition-all">
                      ↻ Retry
                    </button>
                    <button onClick={() => kjørPhase2(v.id)} disabled={phase2Running === v.id}
                      className="px-3 py-1.5 border border-g-border text-g-muted text-[10px] font-bold rounded-xl hover:text-g-green transition-all">
                      {phase2Running === v.id ? '⏳' : 'Phase 2'}
                    </button>
                    <button onClick={() => slettVod(v.id, v.title)}
                      className="px-3 py-1.5 border border-g-border text-g-muted text-[10px] font-bold rounded-xl hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all">
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Fullførte VODs ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-black">
            Fullført <span className="text-g-green ml-1">({ferdige.length})</span>
          </p>
          <div className="flex gap-2">
            <button onClick={hentVods} className="text-[9px] text-g-muted hover:text-g-green transition-colors px-2 py-1 border border-g-border rounded-lg">↻</button>
            {vods.length > 0 && (
              <button onClick={slettAlle}
                className="text-[9px] text-red-400/60 hover:text-red-400 transition-colors px-2 py-1 border border-red-500/20 rounded-lg">
                Slett alt
              </button>
            )}
          </div>
        </div>

        {ferdige.length === 0 ? (
          <div className="bg-g-card border border-g-border rounded-2xl p-10 text-center">
            <p className="text-g-muted text-sm">Ingen fullførte VODs ennå.</p>
            <p className="text-[10px] text-g-muted/60 mt-1">Start en pipeline ovenfor.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ferdige.map(v => {
              const erÅpen = aktivertVod === v.id;
              return (
                <div key={v.id} className={`bg-g-card border rounded-2xl overflow-hidden transition-all ${erÅpen ? 'border-g-green/30' : 'border-g-border'}`}>
                  <div className="p-4 cursor-pointer flex items-center gap-4" onClick={() => setAktivertVod(erÅpen ? null : v.id)}>
                    <span className="w-5 h-5 rounded-full bg-g-green/10 border border-g-green/30 flex items-center justify-center text-g-green text-[9px] font-black flex-shrink-0">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-black text-g-text truncate">{v.title}</p>
                      <p className="text-[9px] text-g-muted">{v.category} · {tidSiden(v.created_at)}</p>
                    </div>
                    {/* Pipeline steg mini */}
                    <div className="hidden lg:flex items-center gap-1">
                      {PIPELINE_STEG.map(s => (
                        <span key={s.id} className="text-[8px] text-g-green/60 px-1.5 py-0.5 border border-g-green/20 rounded font-bold">{s.label}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a href="/content-factory-admin/highlights" onClick={e => e.stopPropagation()}
                        className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-[10px] font-bold rounded-xl hover:bg-g-green/20 transition-all">
                        ▶ Highlights
                      </a>
                      <button onClick={e => { e.stopPropagation(); slettVod(v.id, v.title); }}
                        className="px-2 py-1.5 border border-g-border text-g-muted text-[10px] rounded-xl hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all">
                        🗑
                      </button>
                      <span className="text-g-muted/60 text-xs">{erÅpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {erÅpen && (
                    <div className="border-t border-g-border/40 p-4 space-y-4 bg-g-bg/30">
                      <div className="flex items-center gap-2">
                        <button onClick={() => kjørPhase2(v.id)} disabled={phase2Running === v.id}
                          className="px-4 py-2 bg-g-bg border border-g-border text-g-muted text-[10px] font-bold rounded-xl hover:text-g-green hover:border-g-green/30 transition-all">
                          {phase2Running === v.id ? '⏳ Kjører...' : '↻ Re-kjør Phase 2'}
                        </button>
                        <p className="text-[9px] text-g-muted">Oppdaterer highlights + tekster fra eksisterende transkripsjon</p>
                      </div>
                      {phase2Res[v.id] && (
                        <div className={`p-3 rounded-xl border text-[11px] ${phase2Res[v.id].ok ? 'border-g-green/30 bg-g-green/5 text-g-green' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
                          {phase2Res[v.id].ok
                            ? <span className="font-bold">✓ {phase2Res[v.id].antallHighlights} highlights · {phase2Res[v.id].antallCopy} tekster</span>
                            : <span>✗ {phase2Res[v.id].error}</span>}
                        </div>
                      )}
                      {/* VOD event-tidslinje */}
                      <div>
                        <p className="text-[9px] text-g-muted uppercase tracking-widest font-black mb-2">Pipeline-tidslinje</p>
                        <VodTimeline vodId={v.id} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Manuell Phase 2 ──────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border/40 rounded-2xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-black mb-3">Manuell Phase 2</p>
        <div className="flex gap-2">
          <input
            id="manual-phase2-vodid"
            placeholder="VOD ID fra Supabase..."
            className="flex-1 bg-g-bg border border-g-border rounded-xl px-3 py-2 text-[11px] text-g-text outline-none focus:border-g-green/50 font-mono"
          />
          <button
            onClick={async () => {
              const el = document.getElementById('manual-phase2-vodid') as HTMLInputElement;
              if (!el?.value) return;
              await kjørPhase2(el.value);
            }}
            className="px-4 py-2 bg-g-green/10 border border-g-green/30 text-g-green text-[11px] font-bold rounded-xl hover:bg-g-green/20 transition-all whitespace-nowrap"
          >
            ◆ Start Phase 2
          </button>
        </div>
        {phase2Res['manual'] && (
          <p className={`text-[10px] mt-2 ${phase2Res['manual'].ok ? 'text-g-green' : 'text-red-400'}`}>
            {phase2Res['manual'].ok ? '✓ Ferdig' : `✗ ${phase2Res['manual'].error}`}
          </p>
        )}
      </div>
    </div>
  );
}
