'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { StatusResponse } from '@/types';

interface BotHealth { online: boolean; latency?: number; }
interface Partner { navn: string; rabattkode: string; affiliateLink: string; beskrivelse: string; }
interface Scores { communityScore: number; growthScore: number; sponsorScore: number; prioriteter: string[]; }
interface StreamDay { dag: string; tid: string; spill: string; tittel: string; aktiv: boolean; }
interface BotActivity {
  streamplan: StreamDay[];
  nesteStream: StreamDay | null;
  sistPublisert: { type: string; tittel: string; kanal: string; tid: string; modul: string }[];
  planlagte: { hva: string; når: string; type: string; prioritet: string }[];
  metrics: { followers: number; discordMembres: number; aktiveMembers: number; raidsUke: number; giftSubsUke: number };
}

const TYPE_IKON: Record<string, string> = {
  'live-varsel': '🔴', 'rp-karakter': '🎭', 'promo': '📣', 'partner-post': '🤝',
  'streamplan': '📅', 'discord-melding': '💬', 'event': '⭐', 'clip-post': '🎬',
  'live': '🔴', 'discord': '💬', 'twitch': '🟣',
};

const PRIORITET_FARGE: Record<string, string> = {
  høy: 'text-g-green border-g-green/30 bg-g-green/10',
  medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  lav: 'text-g-muted border-g-border bg-g-bg',
};

function MetricKort({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const innhold = (
    <div className="bg-g-card border border-g-border rounded-lg p-4 hover:border-g-green/20 transition-all">
      <p className="text-[9px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-black text-g-green font-mono mt-1">{value}</p>
      {sub && <p className="text-[9px] text-g-muted mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{innhold}</Link> : innhold;
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [featured, setFeatured] = useState<Partner | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [activity, setActivity] = useState<BotActivity | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  const hentActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/bot-activity');
      if (res.ok) setActivity(await res.json());
    } catch {}
    setLoadingActivity(false);
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
    hentActivity();
    const id = setInterval(hentActivity, 60_000);
    return () => clearInterval(id);
  }, [hentActivity]);

  const isLive = status?.stream?.isLive;
  const m = activity?.metrics;

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Toppbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Dashboard</h1>
          <p className="text-[10px] text-g-muted">GLENVEX Creator OS · Kontrollsenter</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold ${isLive ? 'border-red-500/40 text-red-400 bg-red-500/10' : 'border-g-border text-g-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-red-400 animate-pulse' : 'bg-g-muted'}`} />
            {isLive ? 'LIVE NÅ' : 'OFFLINE'}
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] font-bold ${botHealth?.online ? 'text-g-green' : 'text-yellow-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${botHealth?.online ? 'bg-g-green animate-pulse' : 'bg-yellow-400'}`} />
            Bot {botHealth?.online ? 'aktiv' : 'sjekker...'}
          </div>
        </div>
      </div>

      {/* ── Live-banner ─────────────────────────────────────────────── */}
      {isLive && status?.stream && (
        <div className="bg-g-card border border-red-500/20 rounded-xl p-5 flex gap-4 items-center">
          {status.stream.thumbnailUrl && (
            <img src={status.stream.thumbnailUrl} alt="Stream" className="w-32 rounded border border-g-border flex-shrink-0 object-cover" style={{ aspectRatio: '16/9' }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-red-400 font-bold uppercase">{status.stream.game}</p>
            <p className="text-sm font-bold text-g-text truncate mt-0.5">{status.stream.title}</p>
            <p className="text-3xl font-black text-red-400 font-mono">{status.stream.viewerCount ?? 0} <span className="text-xs text-g-muted font-normal">seere</span></p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <Link href="/ai-producer" className="px-4 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">◆ AI Producer</Link>
            <Link href="/raid-manager" className="px-4 py-2 bg-g-bg border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all">Raid Manager</Link>
          </div>
        </div>
      )}

      {/* ── Nøkkelmetrikker ────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        <MetricKort label="Twitch-følgere" value={m?.followers?.toLocaleString() ?? '–'} href="/viewer-goals" />
        <MetricKort label="Discord-membres" value={m?.discordMembres?.toLocaleString() ?? status?.guild?.approximate_member_count ?? '–'} href="/community-manager" />
        <MetricKort label="Aktive membres (7d)" value={m?.aktiveMembers ?? '–'} />
        <MetricKort label="Raids denne uken" value={m?.raidsUke ?? '–'} href="/statistikk" />
        <MetricKort label="Gift subs uka" value={m?.giftSubsUke ?? '–'} href="/statistikk" />
      </div>

      {/* ── AI Scores + Neste stream + Featured partner ────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* AI Scores */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Scores</p>
            <Link href="/ai-command-center" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Detaljer →</Link>
          </div>
          {scores ? [
            { label: 'Community', value: scores.communityScore, c: '#00ff41' },
            { label: 'Growth', value: scores.growthScore, c: '#00aaff' },
            { label: 'Sponsor', value: scores.sponsorScore, c: '#ffd700' },
          ].map(s => (
            <div key={s.label}>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-g-muted">{s.label}</span>
                <span className="font-black" style={{ color: s.c }}>{s.value}/100</span>
              </div>
              <div className="w-full bg-g-border rounded-full h-1.5">
                <div className="h-1.5 rounded-full" style={{ width: `${s.value}%`, backgroundColor: s.c }} />
              </div>
            </div>
          )) : <p className="text-xs text-g-muted">Laster...</p>}
        </div>

        {/* Neste stream */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Neste stream</p>
          {activity?.nesteStream ? (
            <>
              <div>
                <p className="text-base font-black text-g-text">{activity.nesteStream.dag} kl. {activity.nesteStream.tid}</p>
                <p className="text-sm text-g-green font-semibold">{activity.nesteStream.spill}</p>
                {activity.nesteStream.tittel && <p className="text-xs text-g-muted italic mt-0.5">{activity.nesteStream.tittel}</p>}
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
              <p className="text-xs text-g-muted">Ingen plan satt opp.</p>
              <Link href="/streamplan" className="block px-3 py-2 text-center border border-dashed border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                + Sett opp streamplan
              </Link>
            </>
          )}
          {activity?.streamplan && activity.streamplan.filter(d => d.aktiv).length > 0 && (
            <div className="border-t border-g-border/40 pt-2 space-y-0.5">
              {activity.streamplan.filter(d => d.aktiv).slice(0, 3).map(d => (
                <div key={d.dag} className="flex justify-between text-[9px]">
                  <span className="text-g-muted">{d.dag}</span>
                  <span className="text-g-text">{d.tid} · {d.spill}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Featured partner */}
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Featured Partner</p>
          {featured ? (
            <div className="space-y-2">
              <p className="text-sm font-black text-g-text">{featured.navn}</p>
              <p className="text-xs text-g-muted leading-relaxed line-clamp-2">{featured.beskrivelse}</p>
              {featured.rabattkode && <p className="text-xs font-mono font-black text-yellow-400">Kode: {featured.rabattkode}</p>}
              <a href={featured.affiliateLink} target="_blank" rel="noopener noreferrer"
                className="block px-3 py-2 text-center bg-yellow-400/10 border border-yellow-400/20 rounded text-xs text-yellow-400 font-bold hover:bg-yellow-400/20 transition-all">
                Besøk partner ↗
              </a>
              <button onClick={() => fetch('/api/partners/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => hentActivity())}
                className="w-full px-3 py-2 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                Post til Discord nå
              </button>
            </div>
          ) : (
            <Link href="/partner-hub" className="flex flex-col items-center justify-center gap-2 h-24 border border-dashed border-g-border rounded hover:border-g-green/30 transition-all">
              <span className="text-2xl text-g-muted">◇</span>
              <p className="text-[9px] text-g-muted">Sett opp featured partner</p>
            </Link>
          )}
        </div>
      </div>

      {/* ── Bot-kontrollrom: aktivitet + planer ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Hva boten har gjort */}
        <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-g-text">Bot-aktivitet</p>
              <p className="text-[9px] text-g-muted">Siste handlinger utført automatisk</p>
            </div>
            <Link href="/discord-library" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alt →</Link>
          </div>
          {loadingActivity ? (
            <div className="flex items-center gap-2 py-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              <p className="text-xs text-g-muted">Henter aktivitet...</p>
            </div>
          ) : (activity?.sistPublisert?.length ?? 0) === 0 ? (
            <p className="text-xs text-g-muted py-2">Ingen aktivitet registrert ennå. Boten rapporterer hit når den publiserer noe.</p>
          ) : (
            <div className="space-y-2">
              {activity!.sistPublisert.map((p, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-g-border/20 last:border-0">
                  <span className="text-base flex-shrink-0">{TYPE_IKON[p.type] ?? '◆'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-g-text truncate">{p.tittel}</p>
                    <p className="text-[9px] text-g-muted">{p.modul}{p.kanal ? ` · #${p.kanal}` : ''}</p>
                  </div>
                  <p className="text-[9px] text-g-muted flex-shrink-0">
                    {new Date(p.tid).toLocaleString('no-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hva boten planlegger */}
        <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-3">
          <div>
            <p className="text-xs font-bold text-g-text">Bot-planer</p>
            <p className="text-[9px] text-g-muted">Hva som skjer automatisk fremover</p>
          </div>
          {(activity?.planlagte?.length ?? 0) === 0 ? (
            <p className="text-xs text-g-muted py-2">Ingen planlagte handlinger.</p>
          ) : (
            <div className="space-y-2">
              {activity!.planlagte.map((p, i) => (
                <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border ${PRIORITET_FARGE[p.prioritet] ?? PRIORITET_FARGE.lav}`}>
                  <span className="text-base flex-shrink-0">{TYPE_IKON[p.type] ?? '◆'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{p.hva}</p>
                    <p className="text-[9px] opacity-70">{p.når}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── AI Prioriteter ──────────────────────────────────────────── */}
      {(scores?.prioriteter?.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-g-text">◆ AI Vekstanbefalinger denne uken</p>
              <p className="text-[9px] text-g-muted">Basert på followers, aktivitet og community-data</p>
            </div>
            <Link href="/ai-command-center" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Full analyse →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {scores!.prioriteter.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-g-bg border border-g-border rounded-lg">
                <span className="text-g-green font-black font-mono text-sm w-4 flex-shrink-0">{i + 1}</span>
                <p className="text-xs text-g-text leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Hurtighandlinger ─────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Hurtighandlinger</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {[
            { href: '/ai-producer', icon: '◆', label: 'AI Producer', desc: 'Sanntids analyse' },
            { href: '/clip-factory', icon: '▶', label: 'Clip Factory', desc: 'Lag innhold' },
            { href: '/partner-hub', icon: '◇', label: 'Partner Hub', desc: 'Affiliates' },
            { href: '/event-generator', icon: '⊛', label: 'Event', desc: 'Community' },
            { href: '/rp-manager', icon: '◉', label: 'RP Manager', desc: 'Future RP' },
            { href: '/discord-control', icon: '◈', label: 'Bot-kontroll', desc: 'Pauser & plan' },
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

      {/* ── 3 API-knapper ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '((•)) Test Live Varsel', fn: () => fetch('/api/discord/test-live', { method: 'POST' }).then(() => hentActivity()), color: 'text-g-green border-g-green/20 bg-g-green/5 hover:bg-g-green/10' },
          { label: '◆ Auto-promoter Partner', fn: () => fetch('/api/partners/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => hentActivity()), color: 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5 hover:bg-yellow-400/10' },
          { label: '↻ Oppdater alt', fn: () => { refresh(); hentActivity(); }, color: 'text-g-muted border-g-border bg-g-bg hover:border-g-green/20 hover:text-g-green' },
        ].map(({ label, fn, color }) => (
          <button key={label} onClick={fn}
            className={`py-3 border rounded-lg text-xs font-bold tracking-wide transition-all ${color}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Systemstatus ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Twitch API', value: status?.twitchApi === 'online' ? 'Online' : 'Offline', ok: status?.twitchApi === 'online' },
          { label: 'Discord Bot', value: status?.discordBot === 'online' ? 'Online' : status?.discordBot ?? '–', ok: status?.discordBot === 'online' },
          { label: 'Live-varsler', value: `${status?.totalAlerts ?? 0} totalt`, ok: true },
          { label: 'System', value: botHealth?.online ? `Bot online (${botHealth.latency ?? '?'}ms)` : 'Sjekker...', ok: botHealth?.online ?? false },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-3 flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.ok ? 'bg-g-green animate-pulse' : 'bg-red-400'}`} />
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
