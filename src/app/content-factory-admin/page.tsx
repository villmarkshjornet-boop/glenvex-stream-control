'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

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
  _pollTid?: string; // satt av klienten
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
  if (sek < 3600) return `${Math.floor(sek/60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek/3600)}t siden`;
  return d.toLocaleDateString('no-NO');
}

function progresjonsFarge(status: string): string {
  if (status === 'COMPLETE') return 'bg-g-green';
  if (status === 'FAILED') return 'bg-red-500';
  if (['ANALYZING', 'PROCESSING'].includes(status)) return 'bg-yellow-400';
  return 'bg-blue-400';
}

function statusTekst(v: Vod): string {
  if (v.status === 'COMPLETE') return '✓ KOMPLETT';
  if (v.status === 'FAILED') return '✗ FEILET';
  if (v.status === 'PENDING') return '◎ VENTER...';
  if (v.status === 'ANALYZING') return '⟳ PROSESSERER';
  return v.status;
}

const PIPELINE_STEG = [
  { id: 'DOWNLOAD',     label: 'Last ned',   pct: 5  },
  { id: 'TRANSCRIBING', label: 'Transkriber', pct: 35 },
  { id: 'DISCOVER',     label: 'Highlights',  pct: 55 },
  { id: 'RANK',         label: 'Ranger',      pct: 65 },
  { id: 'COPYWRITE',    label: 'Tekster',     pct: 80 },
  { id: 'CLIP',         label: 'Klipp',       pct: 95 },
  { id: 'COMPLETE',     label: 'Ferdig',      pct: 100 },
];

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
  const autoTriggertRef = useRef<Set<string>>(new Set()); // dedup: ikke trigger Phase 2 to ganger
  const [aktivertVod, setAktivertVod] = useState<string | null>(null);
  const [aktivert, setAktivert] = useState<boolean | null>(null);
  const [detekterer, setDetekterer] = useState(false);
  const [detektFeil, setDetektFeil] = useState('');
  const [sisteVods, setSisteVods] = useState<{ id: string; title: string; duration: string; published_at: string; url: string }[]>([]);

  // ─── Hent VOD-liste ──────────────────────────────────────────────────────
  const hentVods = useCallback(async () => {
    const res = await fetch('/api/content-factory').catch(() => null);
    if (!res) return;
    if (res.status === 403) { setAktivert(false); return; }
    setAktivert(true);
    const d = await res.json().catch(() => ({}));
    setVods(d.vods ?? []);
  }, []);

  // ─── Auto-cleanup: sett FAILED på hengete jobber ─────────────────────────
  const kjørCleanup = useCallback(async () => {
    const res = await fetch('/api/content-factory/cleanup', { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.ryddet > 0) await hentVods();
    }
  }, [hentVods]);

  useEffect(() => {
    hentVods();
    kjørCleanup(); // rydd hengete jobber ved load
    const id = setInterval(hentVods, 10_000);
    const cleanupId = setInterval(kjørCleanup, 60_000); // cleanup hvert minutt
    return () => { clearInterval(id); clearInterval(cleanupId); };
  }, [hentVods, kjørCleanup]);

  // ─── Auto-trigger Phase 2 når Railway er ferdig (status = TRANSCRIBED) ──────
  useEffect(() => {
    const transcribed = vods.filter(v => v.status === 'TRANSCRIBED');
    for (const v of transcribed) {
      if (!autoTriggertRef.current.has(v.id) && phase2Running !== v.id) {
        autoTriggertRef.current.add(v.id);
        console.log(`[AutoPhase2] Starter Phase 2 for ${v.id}`);
        kjørPhase2(v.id);
      }
    }
  }, [vods]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Health check ─────────────────────────────────────────────────────────
  const sjekkHealth = async () => {
    setHealthLoading(true);
    const res = await fetch('/api/content-factory/health').catch(() => null);
    if (res?.ok) setHealth(await res.json());
    setHealthLoading(false);
  };

  useEffect(() => { sjekkHealth(); }, []);

  // ─── Poll Railway for aktive jobber ──────────────────────────────────────
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

        // Oppdater Supabase via phase2 når Railway er ferdig
        if (st.status === 'COMPLETE' && st.transcribed) {
          setRailwayStatusMap(prev => ({ ...prev, [v.id]: { ...st, status: 'RAILWAY_COMPLETE' } }));
        }
      }
    };

    poll();
    const id = setInterval(poll, 8_000);
    return () => clearInterval(id);
  }, [vods]);

  // ─── Start pipeline ───────────────────────────────────────────────────────
  async function startPipeline() {
    if (!vodInput.trim()) return;
    setStarter(true);
    setStartFeil('');
    setNyligStartet(null);

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

  // ─── Kjør Phase 2 manuelt ─────────────────────────────────────────────────
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

  // ─── Retry Railway (reset VOD til PENDING) ────────────────────────────────
  async function retryRailway(vodId: string) {
    const res = await fetch('/api/content-factory/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId }),
    });
    if (res.ok) await hentVods();
  }

  // ─── Slett VOD og all tilhørende data ────────────────────────────────────
  async function slettVod(vodId: string, tittel: string) {
    if (!confirm(`Slett "${tittel}" og alle tilhørende transkripter, highlights og klipp?\n\nDette kan ikke angres.`)) return;
    const res = await fetch(`/api/content-factory/${vodId}`, { method: 'DELETE' });
    if (res.ok) await hentVods();
    else alert('Sletting feilet – prøv igjen');
  }

  // ─── Hent siste VOD fra Twitch og start pipeline ──────────────────────
  async function hentSisteVodFraTwitch() {
    setDetekterer(true);
    setDetektFeil('');
    // Hent liste over siste VODs for preview
    const previewRes = await fetch('/api/vod/detect-latest').catch(() => null);
    if (previewRes?.ok) {
      const d = await previewRes.json();
      setSisteVods(d.vods ?? []);
    }
    setDetekterer(false);
  }

  async function startLatestVodPipeline() {
    setDetekterer(true);
    setDetektFeil('');
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
      setDetektFeil(d.error ?? d.detalj ?? 'Ukjent feil');
    }
    setDetekterer(false);
  }

  // ─── Slett alle VODs ─────────────────────────────────────────────────────
  async function slettAlle() {
    if (!confirm(`Slett ALLE ${vods.length} VODs og all tilhørende data?\n\nDette tømmer Content Factory fullstendig og kan ikke angres.`)) return;
    for (const v of vods) {
      await fetch(`/api/content-factory/${v.id}`, { method: 'DELETE' });
    }
    await hentVods();
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (aktivert === false) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-black text-lg">Content Factory deaktivert</p>
          <p className="text-g-muted text-xs mt-2">Sett <code className="text-red-400 font-mono">CONTENT_FACTORY_ENABLED=true</code> i Vercel og Railway</p>
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
    <div className="max-w-5xl mx-auto space-y-5">
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Content Factory</h1>
          <p className="text-[10px] text-g-muted mt-0.5">Pipeline manager · Ingen autopublisering</p>
        </div>
        <div className="flex gap-2">
          {vods.length > 0 && (
            <button
              onClick={slettAlle}
              className="px-3 py-2 border border-red-500/20 text-red-400/70 text-xs font-bold rounded hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400 transition-all"
              title="Slett alle VODs og start fra scratch"
            >
              🗑 Slett alt
            </button>
          )}
          <a href="/content-factory-admin/highlights"
            className="px-3 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
            ▶ Highlight Viewer
          </a>
        </div>
      </div>

      {/* ─── System Health ────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">System Health</p>
          <button onClick={sjekkHealth} disabled={healthLoading}
            className="text-[9px] text-g-muted hover:text-g-green transition-colors">
            {healthLoading ? '⟳...' : '↻ Sjekk'}
          </button>
        </div>
        {health ? (
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'Railway', ...health.railway },
              { label: 'Supabase', ...health.supabase },
              { label: 'Storage', ...health.storage },
              { label: 'OpenAI', ...health.openai },
              { label: 'Twitch', ...health.twitch },
            ].map(s => (
              <div key={s.label} className={`p-2 rounded-lg border text-center ${s.ok ? 'border-g-green/20 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <p className={`text-[10px] font-black ${s.ok ? 'text-g-green' : 'text-red-400'}`}>{s.ok ? '✓' : '✗'} {s.label}</p>
                <p className="text-[8px] text-g-muted mt-0.5 truncate" title={s.melding}>{s.melding}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            {['Railway', 'Supabase', 'Storage', 'OpenAI', 'Twitch'].map(s => (
              <div key={s} className="flex-1 h-8 bg-g-bg border border-g-border rounded animate-pulse" />
            ))}
          </div>
        )}
        {health && !health.altOk && (
          <p className="text-[9px] text-red-400 mt-2 p-2 bg-red-500/5 border border-red-500/20 rounded">
            ⚠ En eller flere tjenester er nede. Pipeline vil feile inntil alle er grønne.
          </p>
        )}
      </div>

      {/* ─── Auto-detect siste VOD fra Twitch ────────────────────────────── */}
      <div className="bg-g-card border border-g-green/20 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-g-text">🔍 Hent siste VOD automatisk</p>
            <p className="text-[9px] text-g-muted mt-0.5">Henter siste arkiverte stream fra Twitch og starter pipeline direkte</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={hentSisteVodFraTwitch}
              disabled={detekterer}
              className="px-3 py-2 border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all disabled:opacity-40"
            >
              {detekterer ? '⏳...' : '↻ Forhåndsvis'}
            </button>
            <button
              onClick={startLatestVodPipeline}
              disabled={detekterer}
              className="px-4 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-black rounded hover:bg-g-green/20 transition-all disabled:opacity-40"
            >
              {detekterer ? '⏳ Detekterer...' : '▶ Start siste VOD'}
            </button>
          </div>
        </div>

        {sisteVods.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste VODs på Twitch:</p>
            {sisteVods.map(v => (
              <div key={v.id} className="flex items-center gap-3 p-2 rounded-lg bg-g-bg border border-g-border">
                <span className="font-mono text-[9px] text-g-muted">{v.id}</span>
                <span className="flex-1 text-[10px] text-g-text truncate">{v.title}</span>
                <span className="text-[9px] text-g-muted">{v.duration}</span>
                <span className="text-[9px] text-g-muted">{new Date(v.published_at).toLocaleDateString('no-NO')}</span>
              </div>
            ))}
          </div>
        )}

        {detektFeil && (
          <p className="text-[10px] text-red-400 p-2 bg-red-500/5 border border-red-500/20 rounded">{detektFeil}</p>
        )}
      </div>

      {/* ─── Start ny VOD ─────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <p className="text-xs font-bold text-g-text mb-3">▶ Start manuelt med VOD-ID</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <input
              value={vodInput}
              onChange={e => setVodInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startPipeline()}
              placeholder="Twitch VOD ID (f.eks. 2786985500) eller full URL"
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50 font-mono"
            />
            <p className="text-[9px] text-g-muted mt-1">
              Finn på twitch.tv/glenvex/videos → klikk video → kopier tall fra URL
            </p>
          </div>
          <button
            onClick={startPipeline}
            disabled={!vodInput.trim() || starter}
            className="px-5 py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all disabled:opacity-40 whitespace-nowrap self-start"
          >
            {starter ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                Starter...
              </span>
            ) : '◆ Start pipeline'}
          </button>
        </div>

        {startFeil && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400 font-bold mb-1">✗ Pipeline feilet</p>
            <p className="text-[10px] text-red-400 font-mono break-all">{startFeil}</p>
            <div className="mt-2 text-[9px] text-g-muted space-y-0.5">
              <p>Sjekk:</p>
              <p>• Railway er online (grønn health above)</p>
              <p>• CONTENT_FACTORY_ENABLED=true på Railway</p>
              <p>• yt-dlp og ffmpeg er installert på Railway</p>
              <p>• SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY er satt på Railway</p>
            </div>
          </div>
        )}

        {nyligStartet && (
          <div className="mt-3 p-3 bg-g-green/5 border border-g-green/20 rounded-lg">
            <p className="text-[10px] text-g-green font-bold">✓ Pipeline startet! Railway laster ned og transkriberer VOD.</p>
            <p className="text-[9px] text-g-muted mt-1">Dette tar 10–45 min avhengig av VOD-lengde. Statusen oppdateres automatisk nedenfor.</p>
            <p className="text-[9px] text-g-muted">Når Railway er ferdig, klikk <strong className="text-g-green">Kjør Phase 2</strong> for highlights og klipp.</p>
          </div>
        )}
      </div>

      {/* ─── Aktive jobber ────────────────────────────────────────────────── */}
      {aktiveVods.length > 0 && (
        <div className="space-y-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">
            Aktive jobber ({aktiveVods.length})
          </p>
          {aktiveVods.map(v => {
            const rs = railwayStatusMap[v.id];
            const pct = v.progress_percent ?? 10;
            const erRailwayFerdig = rs?.status === 'COMPLETE' || rs?.status === 'RAILWAY_COMPLETE';
            const erUkjent = rs?.status === 'UNKNOWN';
            const minderAktiv = Math.floor((Date.now() - new Date(v.created_at).getTime()) / 60000);
            const erSannsynligHengt = erUkjent && minderAktiv > 10;
            // Stuck-terskel er status-avhengig: nedlasting kan ta 10 min, transkribering er rask per segment
            const stuckTerskel = rs?.status === 'DOWNLOADING' ? 10 : rs?.status === 'TRANSCRIBING' ? 8 : 5;

            return (
              <div key={v.id} className={`bg-g-card border rounded-xl p-4 ${erSannsynligHengt ? 'border-red-500/30' : 'border-yellow-400/20'}`}>
                <div className="flex items-start gap-3">
                  <span className={`w-4 h-4 border-2 rounded-full flex-shrink-0 mt-0.5 ${erSannsynligHengt ? 'border-red-500/40 border-t-red-400 animate-spin' : 'border-yellow-400/40 border-t-yellow-400 animate-spin'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text truncate">{v.title}</p>
                    <p className="text-[9px] text-g-muted">{v.category} · {tidSiden(v.created_at)}</p>

                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 bg-g-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${progresjonsFarge(v.status)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[9px] mt-1">
                      {v.status === 'TRANSCRIBED'
                        ? <span className="text-g-green font-bold">✓ Transkribering ferdig – Phase 2 starter automatisk...</span>
                        : <span className="text-g-muted">{v.status_message ?? v.current_step ?? v.status} ({pct}%)</span>
                      }
                    </p>

                    {/* Railway live status */}
                    {rs && (() => {
                      const oppdatertTs = rs.sisteOppdatering ?? rs._pollTid;
                      const minSiden = oppdatertTs
                        ? Math.floor((Date.now() - new Date(oppdatertTs).getTime()) / 60000)
                        : null;
                      const sitter = !erUkjent && minSiden !== null && minSiden >= stuckTerskel;
                      return (
                        <div className={`mt-1 p-1.5 rounded border text-[9px] ${erSannsynligHengt ? 'border-red-500/30 bg-red-500/5' : sitter ? 'border-red-500/20 bg-red-500/5' : 'border-transparent'}`}>
                          <span className="text-g-muted">Railway: </span>
                          <span className={`font-bold ${erRailwayFerdig ? 'text-g-green' : erUkjent ? 'text-red-400' : sitter ? 'text-red-400' : 'text-yellow-400'}`}>
                            {rs.status}
                          </span>
                          {rs.melding && <span className="text-g-muted"> – {rs.melding.slice(0, 80)}</span>}
                          {rs.segmenter && <span className="text-g-green"> ({rs.segmenter} seg)</span>}
                          {erSannsynligHengt && (
                            <span className="ml-2 text-red-400 font-bold">⚠ Railway har ingen data – klikk Retry Railway</span>
                          )}
                          {!erUkjent && minSiden !== null && (
                            <span className={`ml-2 ${sitter ? 'text-red-400 font-bold' : 'text-g-muted/60'}`}>
                              · oppdatert {minSiden === 0 ? 'nå' : `${minSiden}m siden`}
                              {sitter && ' ⚠ STUCK?'}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Høyre-side: Phase 2 eller Retry/Force Reset */}
                  <div className="flex-shrink-0 flex flex-col gap-1.5">
                    {erRailwayFerdig && (
                      <button
                        onClick={() => kjørPhase2(v.id)}
                        disabled={phase2Running === v.id}
                        className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-[10px] font-bold rounded hover:bg-g-green/20 transition-all"
                      >
                        {phase2Running === v.id ? '⏳...' : '◆ Kjør Phase 2'}
                      </button>
                    )}
                    <button
                      onClick={() => retryRailway(v.id)}
                      className={`px-3 py-1.5 border text-[10px] font-bold rounded transition-all ${
                        erSannsynligHengt
                          ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                          : 'bg-g-bg border-g-border text-g-muted hover:border-red-500/30 hover:text-red-400'
                      }`}
                      title="Avbryt og start Railway på nytt"
                    >
                      {erSannsynligHengt ? '↺ Retry Railway' : '↺ Force Reset'}
                    </button>
                  </div>
                </div>

                {/* Phase 2 resultat */}
                {phase2Res[v.id] && (
                  <div className={`mt-3 p-3 rounded border text-xs ${phase2Res[v.id].ok ? 'border-g-green/30 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    {phase2Res[v.id].ok ? (
                      <p className="text-g-green font-bold">✓ {phase2Res[v.id].antallHighlights} highlights · {phase2Res[v.id].antallCopy} tekster</p>
                    ) : (
                      <p className="text-red-400">✗ {phase2Res[v.id].error}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Feilede VODs ─────────────────────────────────────────────────── */}
      {feilede.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Feilede ({feilede.length})</p>
          {feilede.map(v => (
            <div key={v.id} className="bg-g-card border border-red-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-red-400 truncate">{v.title}</p>
                  <p className="text-[9px] text-g-muted">{tidSiden(v.created_at)}</p>
                  {v.error_message && (
                    <p className="text-[9px] text-red-400 mt-1 font-mono break-all">{v.error_message}</p>
                  )}
                </div>
                <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                  <button
                    onClick={() => retryRailway(v.id)}
                    className="px-2 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-bold rounded hover:bg-red-500/20 transition-all"
                  >
                    ↻ Retry
                  </button>
                  <button
                    onClick={() => kjørPhase2(v.id)}
                    disabled={phase2Running === v.id}
                    className="px-2 py-1 bg-g-bg border border-g-border text-g-muted text-[9px] font-bold rounded hover:text-g-green transition-all"
                  >
                    {phase2Running === v.id ? '⏳' : 'Phase 2'}
                  </button>
                  <button
                    onClick={() => slettVod(v.id, v.title)}
                    className="px-2 py-1 bg-g-bg border border-g-border text-g-muted text-[9px] font-bold rounded hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all"
                    title="Slett VOD og all data"
                  >
                    🗑
                  </button>
                </div>
              </div>
              {phase2Res[v.id] && (
                <div className={`mt-2 p-2 rounded border text-[10px] ${phase2Res[v.id].ok ? 'border-g-green/30 text-g-green' : 'border-red-500/30 text-red-400'}`}>
                  {phase2Res[v.id].ok ? `✓ ${phase2Res[v.id].antallHighlights} highlights` : `✗ ${phase2Res[v.id].error}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Ferdige VODs ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">
            Fullførte VODs ({ferdige.length})
          </p>
          <button onClick={hentVods} className="text-[9px] text-g-muted hover:text-g-green transition-colors">↻</button>
        </div>

        {ferdige.length === 0 ? (
          <div className="bg-g-card border border-g-border rounded-xl p-6 text-center">
            <p className="text-xs text-g-muted">Ingen fullførte VODs ennå.</p>
            <p className="text-[9px] text-g-muted mt-1">Start en pipeline ovenfor for å komme i gang.</p>
          </div>
        ) : ferdige.map(v => {
          const erÅpen = aktivertVod === v.id;
          return (
            <div key={v.id} className={`bg-g-card border rounded-xl overflow-hidden transition-all ${erÅpen ? 'border-g-green/30' : 'border-g-border'}`}>
              <div className="p-4 cursor-pointer" onClick={() => setAktivertVod(erÅpen ? null : v.id)}>
                <div className="flex items-start gap-3">
                  <span className="text-g-green font-bold text-sm flex-shrink-0 mt-0.5">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text truncate">{v.title}</p>
                    <p className="text-[9px] text-g-muted">{v.category} · {tidSiden(v.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href="/content-factory-admin/highlights"
                      onClick={e => e.stopPropagation()}
                      className="px-2 py-1 bg-g-green/10 border border-g-green/20 text-g-green text-[9px] font-bold rounded hover:bg-g-green/20 transition-all"
                    >
                      ▶ Vis highlights
                    </a>
                    <button
                      onClick={e => { e.stopPropagation(); slettVod(v.id, v.title); }}
                      className="px-2 py-1 border border-g-border text-g-muted text-[9px] font-bold rounded hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all"
                      title="Slett VOD og all data"
                    >
                      🗑
                    </button>
                    <span className="text-g-muted text-xs">{erÅpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Full progress bar */}
                <div className="mt-2 h-1 bg-g-border rounded-full overflow-hidden">
                  <div className="h-full bg-g-green rounded-full w-full" />
                </div>
              </div>

              {erÅpen && (
                <div className="border-t border-g-border p-4 space-y-3">
                  {/* Pipeline steg-visualisering */}
                  <div>
                    <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Pipeline</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {PIPELINE_STEG.map(s => (
                        <div key={s.id} className="px-2 py-1 bg-g-green/5 border border-g-green/20 rounded text-center">
                          <p className="text-[8px] font-bold text-g-green uppercase">{s.label}</p>
                          <p className="text-[8px] text-g-green">✓</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Re-kjør Phase 2 */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => kjørPhase2(v.id)}
                      disabled={phase2Running === v.id}
                      className="px-3 py-1.5 bg-g-bg border border-g-border text-g-muted text-[10px] font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all"
                    >
                      {phase2Running === v.id ? '⏳ Kjører...' : '↻ Re-kjør Phase 2'}
                    </button>
                    <p className="text-[9px] text-g-muted">Oppdaterer highlights + tekster fra eksisterende transkripsjon</p>
                  </div>

                  {phase2Res[v.id] && (
                    <div className={`p-3 rounded border text-xs ${phase2Res[v.id].ok ? 'border-g-green/30 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
                      {phase2Res[v.id].ok ? (
                        <div className="space-y-1">
                          <p className="text-g-green font-bold">✓ Phase 2 ferdig!</p>
                          <p className="text-g-muted">{phase2Res[v.id].antallHighlights} highlights · {phase2Res[v.id].antallCopy} tekster</p>
                          {(phase2Res[v.id].steg ?? []).map((s: any, i: number) => (
                            <p key={i} className={`text-[10px] ${s.status === 'OK' ? 'text-g-green' : s.status === 'FEILET' ? 'text-red-400' : 'text-g-muted'}`}>
                              {s.status === 'OK' ? '✓' : s.status === 'FEILET' ? '✗' : '○'} {s.steg}{s.melding ? ` – ${s.melding}` : ''}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-red-400">✗ {phase2Res[v.id].error}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Manuell Phase 2 (backup) ─────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border/50 rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Manuell Phase 2 (ved behov)</p>
        <div className="flex gap-2">
          <input
            id="manual-phase2-vodid"
            placeholder="VOD ID fra Supabase..."
            className="flex-1 bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50 font-mono"
          />
          <button
            onClick={async () => {
              const el = document.getElementById('manual-phase2-vodid') as HTMLInputElement;
              if (!el?.value) return;
              await kjørPhase2(el.value);
            }}
            className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all whitespace-nowrap"
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

      <div className="border border-yellow-400/20 rounded-lg p-3 text-center">
        <p className="text-[9px] text-yellow-400">⚠ Intern side · Ingen autopublisering · Alle assets lastes ned manuelt</p>
      </div>
    </div>
  );
}
