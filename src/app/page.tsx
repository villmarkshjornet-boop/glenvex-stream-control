'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { StatusResponse } from '@/types';

interface BotHealth { online: boolean; latency?: number; }
interface Partner { navn: string; rabattkode: string; affiliateLink: string; beskrivelse: string; }
interface Scores { communityScore: number; growthScore: number; sponsorScore: number; prioriteter: string[]; }
interface StreamDay { dag: string; tid: string; spill: string; aktiv: boolean; }
interface BotRapport {
  handlinger: { type: string; melding: string; tid: string }[];
  analyse: string;
  anbefalinger: { tekst: string; prioritet: string; kategori: string }[];
  stats: { hendelser24t: number; aktiveMedlemmer: number; raids: number; featuredPartner: string | null };
}

const PRIORITET_STIL: Record<string, string> = {
  høy: 'border-l-2 border-l-g-green bg-g-green/5',
  medium: 'border-l-2 border-l-yellow-400 bg-yellow-400/5',
  lav: 'border-l-2 border-l-g-muted',
};

const LOG_FARGE: Record<string, string> = {
  success: 'bg-g-green',
  error: 'bg-red-400',
  warning: 'bg-yellow-400',
  info: 'bg-g-muted',
};

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [featured, setFeatured] = useState<Partner | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [plan, setPlan] = useState<StreamDay[]>([]);
  const [rapport, setRapport] = useState<BotRapport | null>(null);
  const [rapportLoading, setRapportLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  const hentRapport = useCallback(async () => {
    setRapportLoading(true);
    try {
      const res = await fetch('/api/bot-rapport');
      if (res.ok) setRapport(await res.json());
    } catch {}
    setRapportLoading(false);
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
    hentRapport();
    const id = setInterval(hentRapport, 5 * 60 * 1000); // Oppdater hvert 5. min
    return () => clearInterval(id);
  }, [hentRapport]);

  const isLive = status?.stream?.isLive;
  const dagNavn = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const idagIndex = new Date().getDay();
  const aktivePlan = Array.isArray(plan) ? plan.filter(d => d.aktiv) : [];
  // Finn neste stream fra i dag og fremover, wrap rundt til neste uke
  const nestePlan = aktivePlan.find(d => dagNavn.indexOf(d.dag) >= idagIndex)
    ?? aktivePlan[0]
    ?? null;

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Topprad ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Dashboard</h1>
          <p className="text-[10px] text-g-muted mt-0.5">GLENVEX Creator OS – oppdateres automatisk</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold ${
            isLive ? 'border-red-500/40 text-red-400 bg-red-500/10' : 'border-g-border text-g-muted'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-red-400 animate-pulse' : 'bg-g-muted'}`} />
            {isLive ? 'LIVE NÅ' : 'OFFLINE'}
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] font-bold ${botHealth?.online ? 'text-g-green' : 'text-yellow-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${botHealth?.online ? 'bg-g-green animate-pulse' : 'bg-yellow-400'}`} />
            Bot {botHealth?.online ? 'online' : 'sjekker...'}
          </div>
        </div>
      </div>

      {/* ── Live-banner ──────────────────────────────────────────────── */}
      {isLive && status?.stream && (
        <div className="bg-g-card border border-red-500/20 rounded-xl p-5 flex gap-4 items-center">
          {status.stream.thumbnailUrl && (
            <img src={status.stream.thumbnailUrl} alt="Stream" className="w-32 rounded border border-g-border flex-shrink-0 object-cover" style={{ aspectRatio: '16/9' }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-red-400 font-bold uppercase tracking-widest">{status.stream.game}</p>
            <p className="text-sm font-bold text-g-text truncate mt-0.5">{status.stream.title}</p>
            <p className="text-3xl font-black text-red-400 font-mono">{status.stream.viewerCount ?? 0}</p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <Link href="/ai-producer" className="px-4 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">◆ AI Producer</Link>
            <Link href="/raid-manager" className="px-4 py-2 bg-g-bg border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all">Raid Manager</Link>
          </div>
        </div>
      )}

      {/* ── 3 kolonner: Scores + Neste stream + Partner ──────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* AI Scores */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Scores</p>
          {scores ? (
            [
              { label: 'Community', value: scores.communityScore, c: '#00ff41' },
              { label: 'Growth', value: scores.growthScore, c: '#00aaff' },
              { label: 'Sponsor', value: scores.sponsorScore, c: '#ffd700' },
            ].map(s => (
              <div key={s.label}>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-g-muted">{s.label}</span>
                  <span className="font-black" style={{ color: s.c }}>{s.value}</span>
                </div>
                <div className="w-full bg-g-border rounded-full h-1">
                  <div className="h-1 rounded-full transition-all" style={{ width: `${s.value}%`, backgroundColor: s.c }} />
                </div>
              </div>
            ))
          ) : <p className="text-xs text-g-muted">Laster...</p>}
          <Link href="/ai-command-center" className="block text-center text-[9px] text-g-muted hover:text-g-green transition-colors pt-1">Se detaljer →</Link>
        </div>

        {/* Neste stream */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Neste stream</p>
          {nestePlan ? (
            <>
              <div>
                <p className="text-sm font-black text-g-text">{nestePlan.dag} kl. {nestePlan.tid}</p>
                <p className="text-xs text-g-green mt-0.5">{nestePlan.spill}</p>
              </div>
              <div className="space-y-1.5">
                <Link href="/pre-live" className="flex items-center gap-2 px-3 py-2 bg-g-green/10 border border-g-green/20 rounded text-xs text-g-green font-bold hover:bg-g-green/20 transition-all">
                  <span>((•))</span> Start Pre-Live Hype
                </Link>
                <Link href="/streamplan" className="flex items-center gap-2 px-3 py-2 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  Rediger plan
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-g-muted">Ingen streams planlagt.</p>
              <Link href="/streamplan" className="block px-3 py-2 text-center border border-dashed border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                + Sett opp streamplan
              </Link>
            </>
          )}
        </div>

        {/* Featured partner */}
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Featured Partner</p>
          {featured ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-black text-g-text">{featured.navn}</p>
                <p className="text-xs text-g-muted leading-relaxed mt-0.5 line-clamp-2">{featured.beskrivelse}</p>
                {featured.rabattkode && <p className="text-xs font-mono font-black text-yellow-400 mt-1">Kode: {featured.rabattkode}</p>}
              </div>
              <div className="space-y-1.5">
                <a href={featured.affiliateLink} target="_blank" rel="noopener noreferrer"
                  className="block px-3 py-2 text-center bg-yellow-400/10 border border-yellow-400/20 rounded text-xs text-yellow-400 font-bold hover:bg-yellow-400/20 transition-all">
                  Besøk partner ↗
                </a>
                <button onClick={() => fetch('/api/partners/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })}
                  className="w-full px-3 py-2 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  Post til Discord
                </button>
              </div>
            </div>
          ) : (
            <Link href="/partner-hub" className="flex flex-col items-center justify-center gap-2 h-24 border border-dashed border-g-border rounded text-center hover:border-g-green/30 transition-all">
              <span className="text-2xl text-g-muted">◇</span>
              <p className="text-[9px] text-g-muted">Sett opp partner</p>
            </Link>
          )}
        </div>
      </div>

      {/* ── Bot-rapport (hovedkort) ──────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-bold text-g-text">Bot-rapport & AI-analyse</p>
            <p className="text-[9px] text-g-muted mt-0.5">Hva boten har gjort og hva den anbefaler nå</p>
          </div>
          <button onClick={hentRapport} className="text-[9px] text-g-muted hover:text-g-green transition-colors">
            ↻ Oppdater
          </button>
        </div>

        {rapportLoading ? (
          <div className="flex items-center gap-2 py-4">
            <span className="w-4 h-4 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
            <p className="text-xs text-g-muted">Analyserer...</p>
          </div>
        ) : rapport ? (
          <div className="grid grid-cols-2 gap-5">
            {/* Venstre: Analyse + Anbefalinger */}
            <div className="space-y-3">
              {rapport.analyse && (
                <div className="p-3 bg-g-bg border-l-2 border-l-g-green rounded-r-lg">
                  <p className="text-[9px] text-g-green uppercase tracking-widest font-bold mb-1">◆ AI-analyse</p>
                  <p className="text-xs text-g-text leading-relaxed">{rapport.analyse}</p>
                </div>
              )}

              {rapport.anbefalinger.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Anbefalinger</p>
                  {rapport.anbefalinger.map((a, i) => (
                    <div key={i} className={`px-3 py-2 rounded-r-lg ${PRIORITET_STIL[a.prioritet] ?? 'border-l-2 border-l-g-muted'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[8px] font-black uppercase tracking-widest ${
                          a.prioritet === 'høy' ? 'text-g-green' : a.prioritet === 'medium' ? 'text-yellow-400' : 'text-g-muted'
                        }`}>{a.prioritet}</span>
                        <span className="text-[8px] text-g-muted">{a.kategori}</span>
                      </div>
                      <p className="text-xs text-g-text">{a.tekst}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Høyre: Bot-aktivitet + stats */}
            <div className="space-y-3">
              {/* Mini-stats */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Hendelser 24t', value: rapport.stats.hendelser24t },
                  { label: 'Aktive membres', value: rapport.stats.aktiveMedlemmer },
                  { label: 'Raids i dag', value: rapport.stats.raids },
                  { label: 'Featured partner', value: rapport.stats.featuredPartner ?? '–' },
                ].map(s => (
                  <div key={s.label} className="bg-g-bg border border-g-border rounded p-2 text-center">
                    <p className="text-[8px] text-g-muted uppercase tracking-widest">{s.label}</p>
                    <p className="text-xs font-black text-g-green font-mono mt-0.5 truncate">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Bot-handlinger */}
              {rapport.handlinger.length > 0 && (
                <div>
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Boten har gjort</p>
                  <div className="space-y-1">
                    {rapport.handlinger.slice(0, 6).map((h, i) => (
                      <div key={i} className="flex items-start gap-2 py-1">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${LOG_FARGE[h.type] ?? 'bg-g-muted'}`} />
                        <p className="text-[10px] text-g-text flex-1 leading-relaxed">{h.melding}</p>
                        <p className="text-[9px] text-g-muted flex-shrink-0">
                          {new Date(h.tid).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-g-muted">Ingen rapport tilgjengelig.</p>
        )}
      </div>

      {/* ── Hurtighandlinger ─────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Hurtighandlinger</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {[
            { href: '/clip-factory', icon: '▶', label: 'Clip Factory', desc: 'Lag innhold' },
            { href: '/ai-assistent', icon: '◆', label: 'AI Promo', desc: 'Generer tekst' },
            { href: '/partner-hub', icon: '◇', label: 'Partner Hub', desc: 'Affiliates' },
            { href: '/discord', icon: '◈', label: 'Discord', desc: 'Kanalanalyse' },
            { href: '/event-generator', icon: '⊛', label: 'Event', desc: 'Community' },
            { href: '/rp-manager', icon: '◉', label: 'RP Manager', desc: 'Future RP' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="bg-g-card border border-g-border rounded-lg p-3 hover:border-g-green/30 hover:bg-g-green/5 transition-all group">
              <p className="text-g-green text-base">{l.icon}</p>
              <p className="text-[10px] font-bold text-g-text group-hover:text-g-green transition-colors mt-1">{l.label}</p>
              <p className="text-[9px] text-g-muted mt-0.5">{l.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Systemstatus ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Twitch API', value: status?.twitchApi === 'online' ? 'Online' : 'Offline', ok: status?.twitchApi === 'online' },
          { label: 'Discord Bot', value: status?.discordBot === 'online' ? 'Online' : status?.discordBot ?? '–', ok: status?.discordBot === 'online' },
          { label: 'Discord-membres', value: (status?.guild?.approximate_member_count ?? status?.guild?.member_count ?? '–').toLocaleString(), ok: true },
          { label: 'Live-varsler', value: `${status?.totalAlerts ?? 0} totalt`, ok: true },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-3 flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.ok ? 'bg-g-green' : 'bg-red-400'}`} />
            <div className="min-w-0">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <p className="text-xs font-bold text-g-text truncate">{s.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
