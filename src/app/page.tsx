'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { StatusResponse } from '@/types';

interface BotHealth { online: boolean; latency?: number; }
interface Partner { navn: string; rabattkode: string; affiliateLink: string; beskrivelse: string; }
interface Scores { communityScore: number; growthScore: number; sponsorScore: number; prioriteter: string[]; data: any; }
interface StreamDay { dag: string; tid: string; spill: string; aktiv: boolean; }

function StatKort({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-g-card border border-g-border rounded-lg p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-black font-mono mt-1 ${color ?? 'text-g-green'}`}>{value}</p>
      {sub && <p className="text-[9px] text-g-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function HurtigKnapp({ href, icon, label, desc, farge }: { href: string; icon: string; label: string; desc: string; farge?: string }) {
  return (
    <Link href={href}
      className={`bg-g-card border border-g-border rounded-lg p-4 hover:border-g-green/30 hover:bg-g-green/5 transition-all group flex flex-col gap-1.5`}>
      <span className={`text-lg ${farge ?? 'text-g-green'}`}>{icon}</span>
      <p className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors">{label}</p>
      <p className="text-[9px] text-g-muted leading-tight">{desc}</p>
    </Link>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [featured, setFeatured] = useState<Partner | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [plan, setPlan] = useState<StreamDay[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    fetch('/api/bot-health').then(r => r.json()).then(setBotHealth).catch(() => {});
    fetch('/api/partners/featured').then(r => r.json()).then(d => { if (d?.navn) setFeatured(d); }).catch(() => {});
    fetch('/api/ai-scores').then(r => r.json()).then(setScores).catch(() => {});
    fetch('/api/streamplan').then(r => r.json()).then(setPlan).catch(() => {});
  }, []);

  const isLive = status?.stream?.isLive;
  const aktivePlan = plan.filter(d => d.aktiv);
  const dagNavn = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const idagIndex = new Date().getDay();
  const nestePlan = aktivePlan.find(d => dagNavn.indexOf(d.dag) >= idagIndex) ?? aktivePlan[0];

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ─── Topbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Dashboard</h1>
          <p className="text-[10px] text-g-muted mt-0.5">GLENVEX Creator Operating System</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Live-status pill */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${
            isLive ? 'border-red-500/40 text-red-400 bg-red-500/10' : 'border-g-border text-g-muted bg-g-bg'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-400 animate-pulse' : 'bg-g-muted'}`} />
            {isLive ? 'LIVE NÅ' : 'OFFLINE'}
          </div>
          {/* Bot status */}
          <div className={`flex items-center gap-1.5 text-[10px] font-bold ${botHealth?.online ? 'text-g-green' : 'text-yellow-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${botHealth?.online ? 'bg-g-green' : 'bg-yellow-400'}`} />
            Bot {botHealth?.online ? 'online' : 'offline'}
            {botHealth?.latency && <span className="text-g-muted font-normal">({botHealth.latency}ms)</span>}
          </div>
        </div>
      </div>

      {/* ─── Live-info (kun når live) ──────────────────────────────────── */}
      {isLive && status?.stream && (
        <div className="bg-g-card border border-red-500/20 rounded-xl p-5 flex gap-4 items-start">
          {status.stream.thumbnailUrl && (
            <img src={status.stream.thumbnailUrl} alt="Stream" className="w-36 rounded-lg border border-g-border flex-shrink-0 object-cover" style={{ aspectRatio: '16/9' }} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] text-red-400 font-bold uppercase tracking-widest">🔴 Live</span>
              <span className="text-[9px] text-g-muted">{status.stream.game}</span>
            </div>
            <p className="text-sm font-bold text-g-text truncate">{status.stream.title}</p>
            <p className="text-2xl font-black text-red-400 font-mono mt-1">{status.stream.viewerCount ?? 0} <span className="text-sm text-g-muted font-normal">seere</span></p>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/ai-producer" className="px-3 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all whitespace-nowrap">
              ◆ AI Producer
            </Link>
            <Link href="/raid-manager" className="px-3 py-2 bg-g-bg border border-g-border text-g-muted text-xs font-bold rounded hover:border-g-green/30 hover:text-g-green transition-all whitespace-nowrap">
              ⟐ Raid Manager
            </Link>
          </div>
        </div>
      )}

      {/* ─── AI Scores ────────────────────────────────────────────────── */}
      {scores && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Community Score', value: scores.communityScore, color: '#00ff41' },
            { label: 'Growth Score', value: scores.growthScore, color: '#00aaff' },
            { label: 'Sponsor Score', value: scores.sponsorScore, color: '#ffd700' },
          ].map(s => (
            <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <div className="flex items-end gap-1 mt-1">
                <p className="text-3xl font-black font-mono" style={{ color: s.color }}>{s.value}</p>
                <p className="text-g-muted text-xs mb-1">/100</p>
              </div>
              <div className="w-full bg-g-border rounded-full h-1 mt-2">
                <div className="h-1 rounded-full transition-all" style={{ width: `${s.value}%`, backgroundColor: s.color }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Nøkkelstatistikk ─────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <StatKort
          label="Twitch API"
          value={status?.twitchApi === 'online' ? 'Online' : 'Offline'}
          color={status?.twitchApi === 'online' ? 'text-g-green' : 'text-red-400'}
        />
        <StatKort
          label="Discord Bot"
          value={status?.discordBot === 'online' ? 'Online' : status?.discordBot ?? '–'}
          color={status?.discordBot === 'online' ? 'text-g-green' : 'text-yellow-400'}
        />
        <StatKort
          label="Server-membres"
          value={(status?.guild?.approximate_member_count ?? status?.guild?.member_count ?? '–').toLocaleString()}
        />
        <StatKort
          label="Live-varsler sendt"
          value={status?.totalAlerts ?? 0}
          sub="alle tider"
        />
      </div>

      {/* ─── Neste stream + Featured partner ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Neste stream */}
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Neste stream</p>
          {nestePlan ? (
            <div className="space-y-2">
              <p className="text-sm font-black text-g-text">{nestePlan.dag} kl. {nestePlan.tid}</p>
              <p className="text-xs text-g-green">{nestePlan.spill}</p>
              <div className="flex gap-2 mt-3">
                <Link href="/pre-live" className="flex-1 py-2 text-center bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
                  ((•)) Pre-Live Hype
                </Link>
                <Link href="/streamplan" className="flex-1 py-2 text-center bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold rounded transition-all">
                  Rediger plan
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-g-muted">Ingen streams planlagt.</p>
              <Link href="/streamplan" className="block py-2 text-center border border-dashed border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                + Sett opp streamplan
              </Link>
            </div>
          )}
        </div>

        {/* Featured partner */}
        {featured ? (
          <a href={featured.affiliateLink} target="_blank" rel="noopener noreferrer"
            className="bg-g-card border border-yellow-400/20 rounded-lg p-5 hover:border-yellow-400/40 transition-all group block">
            <p className="text-[9px] text-yellow-400 uppercase tracking-widest font-bold mb-2">★ Featured Partner</p>
            <p className="text-sm font-black text-g-text">{featured.navn}</p>
            <p className="text-xs text-g-muted mt-0.5 leading-relaxed">{featured.beskrivelse}</p>
            {featured.rabattkode && (
              <p className="text-xs font-mono font-black text-yellow-400 mt-2 tracking-widest">Kode: {featured.rabattkode}</p>
            )}
            <span className="text-[10px] text-yellow-400 mt-3 block group-hover:underline">Besøk partner ↗</span>
          </a>
        ) : (
          <Link href="/partner-hub"
            className="bg-g-card border border-dashed border-g-border rounded-lg p-5 hover:border-g-green/30 transition-all flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl text-g-muted">◇</span>
            <p className="text-xs font-bold text-g-muted">Ingen featured partner</p>
            <p className="text-[9px] text-g-muted">Gå til Partner Hub for å sette opp</p>
          </Link>
        )}
      </div>

      {/* ─── AI Prioriteter ───────────────────────────────────────────── */}
      {(scores?.prioriteter?.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">◆ AI Prioriteter denne uken</p>
            <Link href="/ai-command-center" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alt →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {scores!.prioriteter.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-g-bg border border-g-border rounded-lg">
                <span className="text-g-green font-black font-mono text-xs w-4 flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-g-text leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Hurtighandlinger ─────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Hurtighandlinger</p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          <HurtigKnapp href="/ai-producer" icon="◆" label="AI Producer" desc="Sanntids stream-analyse" />
          <HurtigKnapp href="/clip-factory" icon="▶" label="Clip Factory" desc="Lag innhold fra clips" />
          <HurtigKnapp href="/partner-hub" icon="◇" label="Partner Hub" desc="Affiliate og sponsorer" farge="text-yellow-400" />
          <HurtigKnapp href="/discord" icon="◈" label="Discord" desc="Kanaler og bot" />
          <HurtigKnapp href="/event-generator" icon="⊛" label="Event" desc="Lag community-event" />
          <HurtigKnapp href="/rp-manager" icon="◉" label="RP Manager" desc="Future RP karakterer" />
          <HurtigKnapp href="/community-manager" icon="⊕" label="Community" desc="Membres og XP" />
          <HurtigKnapp href="/ai-assistent" icon="◆" label="AI Promo" desc="Generer promo-tekst" />
          <HurtigKnapp href="/polls" icon="◈" label="Poll" desc="Discord-avstemning" />
          <HurtigKnapp href="/pre-live" icon="((•))" label="Pre-Live" desc="Send hype-meldinger" />
          <HurtigKnapp href="/highlights" icon="🎬" label="Highlights" desc="Beste clips AI" />
          <HurtigKnapp href="/sponsor-manager" icon="◎" label="Sponsorrapport" desc="Generer rapport" />
        </div>
      </div>

      {/* ─── Hurtige actions (API-kall) ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '((•)) Test Live Varsel', fn: () => fetch('/api/discord/test-live', { method: 'POST' }), color: 'text-g-green border-g-green/20 bg-g-green/5 hover:bg-g-green/10' },
          { label: '◆ Auto-promoter Partner', fn: () => fetch('/api/partners/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), color: 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5 hover:bg-yellow-400/10' },
          { label: '↻ Oppdater data', fn: refresh, color: 'text-g-muted border-g-border bg-g-bg hover:border-g-green/20 hover:text-g-green' },
        ].map(({ label, fn, color }) => (
          <button key={label} onClick={fn}
            className={`py-3 border rounded-lg text-xs font-bold tracking-wide transition-all ${color}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── Siste logg ───────────────────────────────────────────────── */}
      {(status?.recentLogs?.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Siste aktivitet</p>
            <Link href="/logs" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alle →</Link>
          </div>
          <div className="space-y-2">
            {status!.recentLogs.slice(0, 5).map((log, i) => (
              <div key={i} className="flex items-center gap-3 py-1 border-b border-g-border/30 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  log.type === 'success' ? 'bg-g-green' : log.type === 'error' ? 'bg-red-400' : log.type === 'warning' ? 'bg-yellow-400' : 'bg-g-muted'
                }`} />
                <p className="text-xs text-g-text flex-1 truncate">{log.message}</p>
                <p className="text-[9px] text-g-muted flex-shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
