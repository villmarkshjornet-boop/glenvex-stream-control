'use client';

import { useEffect, useState, useCallback } from 'react';
import type {
  SlowData, LiveData, HeroStream, RecentStream,
  AiInnsikt, VodStatus, KlippetHighlight,
} from '@/components/dashboard/types';
import { tidSiden } from '@/components/dashboard/helpers';
import { Hero } from '@/components/dashboard/Hero';
import { StreamCompletionCard } from '@/components/dashboard/StreamCompletionCard';
import { AiInsightFeed } from '@/components/dashboard/AiInsightFeed';
import { ActionCenter } from '@/components/dashboard/ActionCenter';
import { RecentStreams } from '@/components/dashboard/RecentStreams';
import { SystemHealth } from '@/components/dashboard/SystemHealth';
import { PartnerEngineStatus } from '@/components/dashboard/PartnerEngineStatus';
import { CreatorBrainLearning } from '@/components/dashboard/CreatorBrainLearning';
import { AiStatusRow } from '@/components/dashboard/AiStatusRow';
import { LiveCommandCenter } from '@/components/dashboard/LiveCommandCenter';
import { NextStreamBrief } from '@/components/dashboard/NextStreamBrief';
import { StorageHealthCard } from '@/components/dashboard/StorageHealthCard';
import { WhatToDoNow } from '@/components/dashboard/WhatToDoNow';
import { CommunitySnapshot } from '@/components/dashboard/CommunitySnapshot';
import { CreatorOSStatus } from '@/components/dashboard/CreatorOSStatus';
import { CreatorOSHealthCheck } from '@/components/dashboard/CreatorOSHealthCheck';
import { GoalsWidget } from '@/components/dashboard/GoalsWidget';

// ─────────────────────────────────────────────────────────────────────────────
// V2 Inline components
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = {
  S: '#00ff41', A: '#7fff7f', B: '#d4ff41', C: '#ff9f41', D: '#ff5141',
};

function ScoreRingMini({ score, grade }: { score: number; grade: string }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(score / 100, 1) * circ;
  const c = GRADE_COLOR[grade] ?? '#4a6a4a';
  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      <svg width="40" height="40" className="-rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} stroke="#1a2f1a" strokeWidth="3.5" fill="none" />
        <circle cx="20" cy="20" r={r} stroke={c} strokeWidth="3.5" fill="none"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
        style={{ color: c }}>{grade}</span>
    </div>
  );
}

function MiniSparkline({ streams }: { streams: RecentStream[] }) {
  const sorted = [...streams]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-6);
  if (sorted.length < 2) return <div className="w-16 h-6" />;
  const vals = sorted.map(s => s.avgViewers);
  const mx = Math.max(...vals, 1);
  const mn = Math.min(...vals);
  const W = 64, H = 24, P = 2;
  const xp = (i: number) => P + (i / (vals.length - 1)) * (W - P * 2);
  const yp = (v: number) => P + (1 - (v - mn) / Math.max(mx - mn, 1)) * (H - P * 2);
  const pts = vals.map((v, i) => `${xp(i)},${yp(v)}`).join(' ');
  const area = `M ${xp(0)},${H} ${vals.map((v, i) => `L ${xp(i)},${yp(v)}`).join(' ')} L ${xp(vals.length - 1)},${H} Z`;
  return (
    <svg width={W} height={H} className="overflow-visible">
      <defs>
        <linearGradient id="spk-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00ff41" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00ff41" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spk-fill)" />
      <polyline points={pts} fill="none" stroke="#00ff41" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xp(vals.length - 1)} cy={yp(vals[vals.length - 1])} r="2.5" fill="#00ff41" />
    </svg>
  );
}

// Each point in MiniSparkline represents one stream's avgViewers — not intra-stream time series.

// ── StreamHeroCard ────────────────────────────────────────────────────────────

interface HeroCardProps { hero: HeroStream | null | undefined; streams: RecentStream[]; loading: boolean; }

function StreamHeroCard({ hero, streams, loading }: HeroCardProps) {
  if (loading && !hero) {
    return <div className="bg-g-card border border-g-border rounded-2xl p-6 animate-pulse" style={{ minHeight: 200 }} />;
  }
  if (!hero) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-6 flex flex-col items-center justify-center gap-2" style={{ minHeight: 200 }}>
        <p className="text-g-muted text-sm">Ingen stream-data tilgjengelig</p>
      </div>
    );
  }

  const sorted = [...streams].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const prev = sorted.find(s => s.streamId !== hero.streamId);
  const trendDiff = prev ? hero.avgViewers - prev.avgViewers : null;
  const trendPct = trendDiff !== null && prev
    ? Math.round((trendDiff / Math.max(prev.avgViewers, 1)) * 100)
    : null;

  const dimLabels: Record<string, string> = {
    viewers: 'Seere', retention: 'Ret.', chat: 'Chat', growth: 'Vekst', community: 'Comm.',
  };

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-1">Siste stream</p>
          <h2 className="text-base font-semibold text-g-text leading-snug truncate">{hero.title}</h2>
          <p className="text-xs text-g-muted mt-0.5">{hero.game}</p>
        </div>
        <ScoreRingMini score={hero.streamScore} grade={hero.grade} />
      </div>

      <div className="mt-5 flex items-end gap-7">
        <div>
          <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1">Snitt seere</p>
          <p className="text-3xl font-bold text-g-text tabular-nums leading-none">{hero.avgViewers}</p>
          {trendPct !== null && (
            <p className={`text-[11px] mt-1.5 ${trendPct >= 0 ? 'text-g-green' : 'text-g-muted'}`}>
              {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}% fra forrige
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1">Peak</p>
          <p className="text-3xl font-bold text-g-text tabular-nums leading-none">{hero.peakViewers}</p>
        </div>
        <div>
          <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1">Chat</p>
          <p className="text-3xl font-bold text-g-text tabular-nums leading-none">{hero.chatMessages}</p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <MiniSparkline streams={streams} />
          {streams.length > 1 && (
            <p className="text-[10px] text-g-muted/50">Snitt seere · {Math.min(6, streams.length)} str.</p>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-5 gap-2">
        {Object.entries(hero.scoreBreakdown).map(([key, val]) => (
          <div key={key}>
            <div className="h-1 bg-g-border/60 rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(val / 20, 1) * 100}%`, backgroundColor: GRADE_COLOR[hero.grade] ?? '#00ff41', opacity: 0.7 }}
              />
            </div>
            <p className="text-[9px] text-g-muted/60 text-center">{dimLabels[key] ?? key}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── KanalstatusCard ───────────────────────────────────────────────────────────

function KanalstatusCard({ slow, loading }: { slow: SlowData | null; loading: boolean }) {
  if (loading && !slow) {
    return <div className="bg-g-card border border-g-border rounded-2xl p-5 animate-pulse" style={{ minHeight: 200 }} />;
  }
  const services = slow ? [
    { label: 'Twitch',    ok: slow.health.twitch.ok },
    { label: 'Discord',   ok: slow.health.discord.ok },
    { label: 'AI Producer', ok: slow.health.openai.ok },
    { label: 'Supabase',  ok: slow.health.supabase.ok },
    { label: 'Scheduler', ok: slow.health.scheduler.ok },
    { label: 'Klipping',  ok: slow.health.clipWorker.ok },
  ] : [];
  const allOk = services.length > 0 && services.every(s => s.ok);
  const downCount = services.filter(s => !s.ok).length;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5 flex flex-col">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-4">Kanalstatus</p>
      <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-5 ${
        allOk
          ? 'bg-g-green/10 text-g-green border border-g-green/20'
          : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${allOk ? 'bg-g-green' : 'bg-orange-400'}`} />
        {services.length === 0 ? 'Laster…' : allOk ? 'Alle operative' : `${downCount} nede`}
      </div>
      <div className="flex flex-col gap-2.5 flex-1">
        {services.map(s => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-xs text-g-text/80">{s.label}</span>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              s.ok ? 'bg-g-green shadow-[0_0_6px_rgba(0,255,65,0.4)]' : 'bg-red-500'
            }`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analytics row cards ───────────────────────────────────────────────────────

function StreamYtelseCard({ hero, streams, loading }: HeroCardProps) {
  const avg = hero?.avgViewers ?? null;
  const peak = hero?.peakViewers ?? null;
  const sorted = [...streams].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const prev = sorted.find(s => s.streamId !== hero?.streamId);
  const trendPct = avg !== null && prev
    ? Math.round(((avg - prev.avgViewers) / Math.max(prev.avgViewers, 1)) * 100)
    : null;
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-1">Seerantall</p>
      {loading && avg === null ? (
        <div className="animate-pulse h-8 bg-g-border/30 rounded mt-3" />
      ) : (
        <>
          <p className="text-3xl font-bold text-g-text tabular-nums mt-3 leading-none">{avg ?? '—'}</p>
          <p className="text-xs text-g-muted mt-2">Peak: {peak ?? '—'}</p>
          {trendPct !== null && (
            <p className={`text-xs mt-2 font-medium ${trendPct >= 0 ? 'text-g-green' : 'text-g-muted'}`}>
              {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}% fra forrige
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RetensjonCard({ streams, loading }: { streams: RecentStream[]; loading: boolean }) {
  // retentionPct = per-stream retention average, not an intra-stream curve
  const sorted = [...streams].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = sorted[0];
  const ret = latest?.retentionPct ?? null;
  const avg = streams.length >= 2
    ? Math.round(streams.reduce((acc, s) => acc + s.retentionPct, 0) / streams.length)
    : null;
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-1">Retensjon</p>
      <p className="text-[10px] text-g-muted/50 mb-1">Siste stream</p>
      {loading && ret === null ? (
        <div className="animate-pulse h-8 bg-g-border/30 rounded mt-3" />
      ) : (
        <>
          <p className="text-3xl font-bold text-g-text tabular-nums mt-1 leading-none">
            {ret !== null ? `${ret}%` : '—'}
          </p>
          {avg !== null && (
            <p className="text-xs text-g-muted mt-2">Snitt {streams.length} str.: {avg}%</p>
          )}
          {ret !== null && (
            <div className="mt-3 h-1 bg-g-border/60 rounded-full overflow-hidden">
              <div className="h-full bg-g-green/70 rounded-full" style={{ width: `${Math.min(ret, 100)}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChatAktivitetCard({ hero, loading }: { hero: HeroStream | null | undefined; loading: boolean }) {
  const msgs = hero?.chatMessages ?? null;
  const chatters = hero?.uniqueChatters ?? null;
  // msgs/min derived from real durationMinutes — no per-minute data available
  const msgsPerMin = msgs !== null && hero?.durationMinutes && hero.durationMinutes > 0
    ? (msgs / hero.durationMinutes).toFixed(1) : null;
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-1">Chat-aktivitet</p>
      {loading && msgs === null ? (
        <div className="animate-pulse h-8 bg-g-border/30 rounded mt-3" />
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-3xl font-bold text-g-text tabular-nums leading-none">{msgs ?? '—'}</p>
            <p className="text-[10px] text-g-muted/60 mt-0.5">meldinger</p>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-base font-semibold text-g-text tabular-nums">{chatters ?? '—'}</p>
              <p className="text-[10px] text-g-muted/60">unike chattere</p>
            </div>
            {msgsPerMin !== null && (
              <div>
                <p className="text-base font-semibold text-g-text tabular-nums">{msgsPerMin}</p>
                <p className="text-[10px] text-g-muted/60">msg/min</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI + Content row ──────────────────────────────────────────────────────────

function AIAnbefalingerCard({ innsikter, loading }: { innsikter: AiInnsikt[]; loading: boolean }) {
  // AiInnsikt only has: title, summary, confidenceScore, createdAt — no CTA or priority fields
  const top = innsikter.slice(0, 3);
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5 col-span-2">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-4">AI-anbefalinger</p>
      {loading && top.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse h-10 bg-g-border/30 rounded-xl" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="text-sm text-g-muted">Ingen anbefalinger ennå.</p>
      ) : (
        <div className="space-y-2.5">
          {top.map((ins, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-g-bg/50 rounded-xl border border-g-border/40">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-g-green/10 text-g-green text-[10px] font-bold flex items-center justify-center border border-g-green/20">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-g-text leading-snug">{ins.title}</p>
                <p className="text-[11px] text-g-muted mt-0.5 line-clamp-2">{ins.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InnholdsflowCard({ resultater, loading }: { resultater: VodStatus[]; loading: boolean }) {
  // VodStatus fields used: title, status, progressPercent, highlights, klipp
  const active = resultater.slice(0, 3);
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-4">Innholdsflyt</p>
      {loading && active.length === 0 ? (
        <div className="animate-pulse h-24 bg-g-border/30 rounded-xl" />
      ) : active.length === 0 ? (
        <p className="text-sm text-g-muted">Ingen aktive VOD-jobber</p>
      ) : (
        <div className="space-y-3">
          {active.map(v => {
            const pct = v.progressPercent ?? 0;
            const sc = v.status === 'complete' ? 'text-g-green'
              : v.status === 'failed' ? 'text-red-400' : 'text-g-muted';
            return (
              <div key={v.id}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-g-text truncate max-w-[72%]">{v.title}</p>
                  <p className={`text-[10px] font-medium ${sc}`}>{v.status}</p>
                </div>
                <div className="h-1 bg-g-border/60 rounded-full overflow-hidden mb-1">
                  <div className="h-full bg-g-green/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                {(v.highlights > 0 || v.klipp > 0) && (
                  <p className="text-[10px] text-g-muted/60">
                    {v.highlights > 0 ? `${v.highlights} høydepkt` : ''}
                    {v.highlights > 0 && v.klipp > 0 ? ' · ' : ''}
                    {v.klipp > 0 ? `${v.klipp} klipp` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToppOyeblikkCard({ highlights, loading }: { highlights: KlippetHighlight[]; loading: boolean }) {
  // KlippetHighlight fields: id, vodId, title, vodTitle, clip_url_16_9, clip_url_9_16, clippedAt
  const top = highlights.slice(0, 4);
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-4">Topp øyeblikk</p>
      {loading && top.length === 0 ? (
        <div className="animate-pulse h-24 bg-g-border/30 rounded-xl" />
      ) : top.length === 0 ? (
        <p className="text-sm text-g-muted">Ingen klipp ennå</p>
      ) : (
        <div className="space-y-2.5">
          {top.map(h => (
            <div key={h.id} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-1 h-1 rounded-full bg-g-green mt-[5px]" />
              <p className="text-[11px] text-g-text leading-snug line-clamp-2">
                {h.title ?? h.vodTitle ?? 'Høydepunkt'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── KommendeHandlingerRow ─────────────────────────────────────────────────────

function KommendeHandlingerRow({ live }: { live: LiveData | null }) {
  const neste = live?.nesteStream ?? null;
  const hype = live?.preHype ?? null;
  const actions = (live?.actionCenter ?? []).slice(0, 3);

  if (!neste && !hype && actions.length === 0) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-4">Kommende handlinger</p>
      <div className="flex flex-wrap gap-3">
        {neste && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-g-bg/50 border border-g-border/40 rounded-xl">
            <span className="text-[10px] text-g-muted uppercase tracking-wider">Neste</span>
            <span className="text-sm font-medium text-g-text">{neste.dag} {neste.tid}</span>
            <span className="text-xs text-g-muted">{neste.spill}</span>
            {neste.nedtelling && (
              <span className="text-[11px] text-g-green font-medium">{neste.nedtelling}</span>
            )}
          </div>
        )}
        {hype && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium ${
            hype.status === 'sendt'
              ? 'bg-g-green/10 border-g-green/20 text-g-green'
              : hype.status === 'klar' || hype.status === 'planlagt'
                ? 'bg-g-bg/50 border-g-border/40 text-g-text'
                : 'bg-g-bg/50 border-g-border/40 text-g-muted'
          }`}>
            {hype.status === 'sendt' ? '✓ Hype sendt'
              : hype.status === 'klar' ? 'Hype klar'
              : hype.status === 'planlagt' ? `Hype om ${hype.tidTilUtsending ?? '…'}`
              : 'Hype ikke planlagt'}
          </div>
        )}
        {actions.map((a, i) => (
          <a
            key={i}
            href={a.href}
            className="flex items-center gap-2.5 px-4 py-2.5 bg-g-bg/50 border border-g-border/40 rounded-xl hover:border-g-green/30 transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              a.priority === 'error' ? 'bg-red-500'
              : a.priority === 'warning' ? 'bg-orange-400'
              : 'bg-g-green'
            }`} />
            <span className="text-xs text-g-text">{a.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [slow, setSlow]               = useState<SlowData | null>(null);
  const [live, setLive]               = useState<LiveData | null>(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [sistOppdatert, setSistOppdatert] = useState<string | null>(null);
  const [visDebug, setVisDebug]       = useState(false);
  const [visAvansert, setVisAvansert] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const handleApiResponse = useCallback((res: Response) => {
    if (res.status === 401) { window.location.href = '/login'; return false; }
    return res.ok;
  }, []);

  const hentLive = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/live');
      if (handleApiResponse(res)) {
        const d: LiveData = await res.json();
        setLive(d);
        setSistOppdatert(d.ts);
      }
    } catch {}
    setLoadingLive(false);
  }, [handleApiResponse]);

  const hentSlow = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (handleApiResponse(res)) setSlow(await res.json());
    } catch {}
    setLoadingSlow(false);
  }, [handleApiResponse]);

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

  const isLive = slow?.streamStatus?.isLive ?? false;
  const streams = live?.recentStreams ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between py-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight gradient-text">
            {isLive ? 'Live Command Center' : 'Creator OS'}
          </h1>
          {sistOppdatert && (
            <p className="text-[11px] text-g-muted/50 mt-0.5">
              Oppdatert {tidSiden(sistOppdatert)}
            </p>
          )}
        </div>
        <button
          onClick={hentAlt}
          disabled={refreshing}
          className="text-xs text-g-muted/50 hover:text-g-muted transition-colors disabled:cursor-not-allowed"
        >
          {refreshing ? 'Laster…' : 'Oppdater'}
        </button>
      </div>

      {/* ── LIVE MODE ──────────────────────────────────────────────────────── */}
      {isLive && live && slow ? (
        <LiveCommandCenter live={live} slow={slow} />
      ) : (
        <>
          {/* Action items — compact, only when present */}
          {(live?.actionCenter?.length ?? 0) > 0 && (
            <ActionCenter items={live?.actionCenter} loading={loadingLive} />
          )}

          {/* ── Row 1: Hero + Kanalstatus ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
            <StreamHeroCard hero={live?.heroStream} streams={streams} loading={loadingLive} />
            <KanalstatusCard slow={slow} loading={loadingSlow} />
          </div>

          {/* ── Row 2: Analytics 3-col ───────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StreamYtelseCard hero={live?.heroStream} streams={streams} loading={loadingLive} />
            <RetensjonCard streams={streams} loading={loadingLive} />
            <ChatAktivitetCard hero={live?.heroStream} loading={loadingLive} />
          </div>

          {/* ── Row 3: AI + Content 4-col ────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <AIAnbefalingerCard innsikter={live?.nyesteInnsikter ?? []} loading={loadingLive} />
            <InnholdsflowCard resultater={live?.sisteResultater ?? []} loading={loadingLive} />
            <ToppOyeblikkCard highlights={live?.clipStatus?.sisteKlippede ?? []} loading={loadingLive} />
          </div>

          {/* ── Row 4: Kommende handlinger ───────────────────────────────── */}
          <KommendeHandlingerRow live={live} />

          {/* ── Streamhistorikk ──────────────────────────────────────────── */}
          <RecentStreams streams={live?.recentStreams} loading={loadingLive} />

          {/* ── Mer innsikt ──────────────────────────────────────────────── */}
          <div className="border border-g-border/30 rounded-xl overflow-hidden">
            <button
              onClick={() => setVisAvansert(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left"
            >
              <span className="text-[11px] text-g-muted/60 uppercase tracking-widest font-bold">
                Mer innsikt
              </span>
              <span className="text-[11px] text-g-muted/40">{visAvansert ? '▲ Skjul' : '▼ Vis'}</span>
            </button>
            {visAvansert && (
              <div className="px-4 py-4 bg-g-bg/20 space-y-4">
                {/* AI-innsikter + lærdom — more detail than the V2 summary card */}
                <AiInsightFeed
                  innsikter={live?.nyesteInnsikter ?? []}
                  lærdom={live?.lærdom}
                  loading={loadingLive}
                  heroIntegrity={live?.heroStream?.dataIntegrity}
                />

                {/* Full hero detail with checklist + data integrity */}
                <Hero heroStream={live?.heroStream} loading={loadingLive} lastVodSync={live?.lastVodSync} />
                {live?.heroStream && (
                  <StreamCompletionCard heroStream={live.heroStream} loading={loadingLive} />
                )}

                {/* What to do next */}
                <WhatToDoNow slow={slow} live={live} />

                {/* Goals + community */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NextStreamBrief />
                  <div className="flex flex-col gap-4">
                    <CommunitySnapshot />
                    <GoalsWidget />
                  </div>
                </div>

                {/* ── Systemdiagnostikk ─────────────────────────────── */}
                <p className="text-[11px] text-g-muted/50 uppercase tracking-widest font-semibold pt-2 border-t border-g-border/20">
                  Systemdiagnostikk
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <SystemHealth
                    live={live}
                    loading={loadingLive}
                    onResetSyklus={async () => {
                      await fetch('/api/stream-syklus/reset', { method: 'POST' });
                      hentLive();
                    }}
                  />
                  <AiStatusRow coverage={live?.coverage} loading={loadingLive} />
                  <StorageHealthCard />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <PartnerEngineStatus />
                  <CreatorBrainLearning />
                </div>

                <CreatorOSStatus />
                <CreatorOSHealthCheck />

                {/* Debug */}
                {live?.debug && (
                  <div className="border border-g-border/30 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setVisDebug(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2 bg-g-bg/40 hover:bg-g-bg/70 transition-all text-left"
                    >
                      <span className="text-[11px] text-g-muted/60 uppercase tracking-widest font-bold">Debug</span>
                      <span className="text-[11px] text-g-muted/40">{visDebug ? '▲ Skjul' : '▼ Vis'}</span>
                    </button>
                    {visDebug && (
                      <div className="px-4 py-3 bg-g-bg/20 grid grid-cols-2 gap-x-6 gap-y-1">
                        {Object.entries(live.debug).map(([k, v]) => (
                          <div key={k} className="flex items-baseline gap-2">
                            <span className="text-[11px] text-g-muted/50 font-mono w-32 flex-shrink-0">{k}</span>
                            <span className="text-[11px] text-g-text font-mono truncate">{String(v ?? '—')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
