'use client';

import { useEffect, useState, useCallback } from 'react';

interface TiltakInnhold {
  tiktok?: string;
  instagram?: string;
  twitter?: string;
  discord?: string;
  chat?: string;
  generelt?: string;
}

interface Tiltak {
  tekst: string;
  prioritet: 'lav' | 'medium' | 'høy' | 'kritisk';
  type?: string;
  innhold?: TiltakInnhold;
}

interface ProducerData {
  isLive: boolean;
  stream: { title: string; game: string; viewerCount: number; thumbnailUrl?: string } | null;
  analyse: string;
  tiltak: Tiltak[];
  metrics: { viewers: number; activeDiscord: number; raidsToday: number; giftSubsToday: number; engagementScore: number };
  harHistorikk?: boolean;
}

interface DiagData {
  altOk: boolean;
  erLive: boolean;
  kritiskeFeil: string[];
  detaljer: Record<string, { ok: boolean; melding: string; verdi?: string }>;
  settings: { autoPostLive: boolean; discordLiveChannelId: string; lastNotifiedStreamId: string | null; twitchUsername: string };
}

const PRIORITET_STIL: Record<string, string> = {
  lav:     'border-g-border text-g-muted bg-g-bg',
  medium:  'border-blue-400/30 text-blue-400 bg-blue-400/10',
  høy:     'border-yellow-400/30 text-yellow-400 bg-yellow-400/10',
  kritisk: 'border-red-400/40 text-red-400 bg-red-400/15 animate-pulse',
};

function MetricKort({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-g-bg border border-g-border rounded-lg p-4 text-center">
      <p className="text-[9px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-black text-g-green font-mono mt-1">{value}</p>
      {sub && <p className="text-[9px] text-g-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Live Nødpanel ─────────────────────────────────────────────────────────────

function LiveNødpanel({ onRefresh }: { onRefresh: () => void }) {
  const [diag, setDiag] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [melding, setMelding] = useState<{ ok: boolean; tekst: string } | null>(null);

  const hentDiag = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/live/diagnostics');
      if (res.ok) setDiag(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { hentDiag(); }, [hentDiag]);

  const forceNotify = async () => {
    setNotifying(true);
    setMelding(null);
    try {
      const res = await fetch('/api/live/force-notify', { method: 'POST' });
      const d = await res.json();
      setMelding({ ok: d.ok, tekst: d.ok ? `✓ ${d.melding}` : `✗ ${d.feil}` });
      if (d.ok) onRefresh();
    } catch (e: any) {
      setMelding({ ok: false, tekst: `Feil: ${e.message}` });
    }
    setNotifying(false);
  };

  const resetId = async () => {
    setResetting(true);
    setMelding(null);
    try {
      const res = await fetch('/api/live/reset-id', { method: 'POST' });
      const d = await res.json();
      setMelding({ ok: true, tekst: d.melding });
      await hentDiag();
    } catch {}
    setResetting(false);
  };

  return (
    <div className="bg-g-card border border-red-500/30 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-red-400 uppercase tracking-wider">⚠ Live-deteksjon feilet</p>
          <p className="text-[9px] text-g-muted mt-0.5">Systemet klarer ikke oppdage at du er live. Diagnostikk og manuell override nedenfor.</p>
        </div>
        <button onClick={hentDiag} className="text-[9px] text-g-muted hover:text-g-green transition-colors">↻ Oppdater</button>
      </div>

      {/* Hurtighandlinger */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={forceNotify}
          disabled={notifying}
          className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-black rounded hover:bg-red-500/20 transition-all disabled:opacity-50"
        >
          {notifying ? '⏳ Sender...' : '🔴 TVING DISCORD-VARSEL NÅ'}
        </button>
        <button
          onClick={resetId}
          disabled={resetting}
          className="px-4 py-2 border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all disabled:opacity-50"
        >
          {resetting ? '⏳...' : '↺ Nullstill live-ID (boten varsler om < 2min)'}
        </button>
      </div>

      {melding && (
        <div className={`p-3 rounded border text-xs font-bold ${melding.ok ? 'border-g-green/30 text-g-green bg-g-green/5' : 'border-red-500/30 text-red-400 bg-red-500/5'}`}>
          {melding.tekst}
        </div>
      )}

      {/* Diagnostikk */}
      {loading && <div className="h-24 bg-g-bg border border-g-border rounded-lg animate-pulse" />}
      {diag && !loading && (
        <div className="space-y-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Diagnostikk</p>
          {Object.entries(diag.detaljer).map(([key, val]) => (
            <div key={key} className={`flex items-start gap-2 p-2 rounded border text-[10px] ${val.ok ? 'border-g-border' : 'border-red-500/30 bg-red-500/5'}`}>
              <span className={`flex-shrink-0 font-black ${val.ok ? 'text-g-green' : 'text-red-400'}`}>{val.ok ? '✓' : '✗'}</span>
              <span className={`flex-shrink-0 w-40 font-mono ${val.ok ? 'text-g-muted' : 'text-red-400 font-bold'}`}>{key.replace(/_/g, ' ')}</span>
              <span className={val.ok ? 'text-g-muted' : 'text-red-400'}>{val.melding}</span>
              {val.verdi && <span className="ml-auto text-g-muted/50 font-mono">{val.verdi}</span>}
            </div>
          ))}
        </div>
      )}

      {diag?.kritiskeFeil && diag.kritiskeFeil.length > 0 && (
        <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
          <p className="text-[9px] text-red-400 font-black uppercase mb-2">Slik fikser du det:</p>
          {!diag.detaljer.twitch_client_id?.ok && (
            <p className="text-[9px] text-g-muted mb-1">• Legg til <code className="text-yellow-400">TWITCH_CLIENT_ID</code> og <code className="text-yellow-400">TWITCH_CLIENT_SECRET</code> i Vercel Environment Variables</p>
          )}
          {!diag.detaljer.discord_live_channel?.ok && (
            <p className="text-[9px] text-g-muted mb-1">• Gå til <a href="/innstillinger" className="text-g-green underline">Innstillinger</a> og sett Discord Live-kanal ID</p>
          )}
          {!diag.detaljer.auto_post_live?.ok && (
            <p className="text-[9px] text-g-muted mb-1">• Skru på «Auto Post Live» i <a href="/innstillinger" className="text-g-green underline">Innstillinger</a></p>
          )}
          {diag.settings.lastNotifiedStreamId && (
            <p className="text-[9px] text-g-muted mb-1">• Klikk «Nullstill live-ID» ovenfor – forrige stream-ID blokkerer nytt varsel</p>
          )}
          {!diag.detaljer.discord_bot_token?.ok && (
            <p className="text-[9px] text-g-muted mb-1">• Legg til <code className="text-yellow-400">DISCORD_BOT_TOKEN</code> i Vercel og Railway Environment Variables</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tiltak-kort med kopier-klar innhold ─────────────────────────────────────

const PLATTFORM_IKON: Record<string, string> = {
  tiktok: '▶ TikTok',
  instagram: '◉ Instagram',
  twitter: '✦ Twitter/X',
  discord: '◈ Discord',
  chat: '💬 Chat',
  generelt: '◆ Innhold',
};

function TiltakKort({ tiltak }: { tiltak: Tiltak }) {
  const [åpen, setÅpen] = useState(false);
  const [kopiert, setKopiert] = useState<string | null>(null);
  const harInnhold = tiltak.innhold && Object.keys(tiltak.innhold).length > 0;

  function kopier(tekst: string, platform: string) {
    navigator.clipboard.writeText(tekst).catch(() => {});
    setKopiert(platform);
    setTimeout(() => setKopiert(null), 2000);
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${PRIORITET_STIL[tiltak.prioritet]}`}>
      <button
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => harInnhold && setÅpen(o => !o)}
      >
        <span className="text-[10px] font-black uppercase tracking-widest w-16 flex-shrink-0">{tiltak.prioritet}</span>
        <p className="text-xs font-semibold flex-1">{tiltak.tekst}</p>
        {harInnhold && (
          <span className="text-[9px] text-current/60 flex-shrink-0">{åpen ? '▲' : '▼ innhold'}</span>
        )}
      </button>

      {harInnhold && åpen && (
        <div className="border-t border-current/10 bg-black/20 p-3 space-y-2">
          {Object.entries(tiltak.innhold!).map(([platform, tekst]) => tekst ? (
            <div key={platform} className="bg-black/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest text-current/70">
                  {PLATTFORM_IKON[platform] ?? platform}
                </span>
                <button
                  onClick={() => kopier(tekst, platform)}
                  className="text-[9px] font-bold px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 transition-all"
                >
                  {kopiert === platform ? '✓ Kopiert!' : 'Kopier'}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-current/90">{tekst}</p>
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}

// ─── Hoved-komponent ───────────────────────────────────────────────────────────

export default function AIProducerPage() {
  const [data, setData] = useState<ProducerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sisteOppdatert, setSisteOppdatert] = useState<Date | null>(null);

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-producer');
      if (res.ok) {
        setData(await res.json());
        setSisteOppdatert(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    hent();
    const interval = setInterval(hent, 15_000);
    return () => clearInterval(interval);
  }, [hent]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Producer</h1>
          <p className="text-xs text-g-muted mt-0.5">Sanntids stream-analyse og AI-anbefalinger</p>
        </div>
        <div className="text-right">
          {sisteOppdatert && (
            <p className="text-[9px] text-g-muted">Oppdatert {sisteOppdatert.toLocaleTimeString('no-NO')}</p>
          )}
          <div className={`flex items-center gap-1.5 justify-end mt-1 ${data?.isLive ? 'text-red-400' : 'text-g-muted'}`}>
            <span className={`w-2 h-2 rounded-full ${data?.isLive ? 'bg-red-400 animate-pulse' : 'bg-g-muted'}`} />
            <span className="text-xs font-bold">{data?.isLive ? 'LIVE NÅ' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-12 text-center">
          <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
        </div>
      ) : !data?.isLive ? (
        <LiveNødpanel onRefresh={hent} />
      ) : (
        <>
          {/* Live banner */}
          <div className="bg-g-card border border-red-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
              <p className="text-xs font-black text-red-400 uppercase tracking-widest">LIVE NÅ</p>
            </div>
            {data.stream && (
              <div className="flex gap-4 items-start">
                {data.stream.thumbnailUrl && (
                  <img src={data.stream.thumbnailUrl} alt="Stream" className="w-32 rounded border border-g-border flex-shrink-0" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest">{data.stream.game}</p>
                  <p className="text-sm font-bold text-g-text mt-0.5">{data.stream.title}</p>
                </div>
              </div>
            )}
          </div>

          {/* Metrics */}
          {data.metrics && (
            <div className="grid grid-cols-5 gap-3">
              <MetricKort label="Seere" value={data.metrics.viewers} />
              <MetricKort label="Discord aktive" value={data.metrics.activeDiscord} />
              <MetricKort label="Raids i dag" value={data.metrics.raidsToday} />
              <MetricKort label="Gift subs" value={data.metrics.giftSubsToday} />
              <MetricKort label="Engagement" value={`${data.metrics.engagementScore}%`} />
            </div>
          )}

          {/* AI Analyse */}
          {data.analyse && (
            <div className="bg-g-card border border-g-border rounded-xl p-5">
              <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">◆ AI Analyse</p>
              <p className="text-sm text-g-text leading-relaxed">{data.analyse}</p>
            </div>
          )}

          {/* Tiltak med innhold */}
          {data.tiltak.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">AI Tiltak</p>
                {data.harHistorikk && (
                  <span className="text-[9px] text-g-green/70 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-g-green/70" /> Basert på din Stream Coach-historikk
                  </span>
                )}
              </div>
              {data.tiltak.map((t, i) => (
                <TiltakKort key={i} tiltak={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
