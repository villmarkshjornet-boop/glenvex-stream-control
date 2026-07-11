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
// Design system constants
// ─────────────────────────────────────────────────────────────────────────────

const V2_CARD = "bg-[#0c1115] border border-emerald-500/15 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.22)]";
const V2_LABEL = "text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500";

const GRADE_COLOR: Record<string, string> = {
  S: '#a78bfa', A: '#34d399', B: '#60a5fa', C: '#fbbf24', D: '#f87171',
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const GRADE_BG: Record<string, string> = {
  S: 'bg-violet-500/10 border-violet-500/30',
  A: 'bg-emerald-500/10 border-emerald-500/30',
  B: 'bg-blue-500/10 border-blue-500/30',
  C: 'bg-amber-500/10 border-amber-500/30',
  D: 'bg-red-500/10 border-red-500/30',
};

// ─────────────────────────────────────────────────────────────────────────────
// ScoreRing — large SVG ring with grade and score
// ─────────────────────────────────────────────────────────────────────────────

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const SIZE = 120, STROKE = 8;
  const r = (SIZE - STROKE * 2) / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(score / 100, 1) * circ;
  const c = GRADE_COLOR[grade] ?? '#6b7280';
  const gradeExpl: Record<string, string> = {
    S: 'Utmerket', A: 'Veldig bra', B: 'Over snitt', C: 'Under snitt', D: 'Svak stream',
  };
  return (
    <div className="flex flex-col items-center gap-2 flex-shrink-0">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90" viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke="#1c1f26" strokeWidth={STROKE} fill="none" />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={c} strokeWidth={STROKE} fill="none"
            strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-3xl font-bold leading-none" style={{ color: c }}>{grade}</span>
          <span className="text-base font-semibold text-zinc-100 leading-none">{score}</span>
        </div>
      </div>
      <p className="text-xs font-medium" style={{ color: c }}>{gradeExpl[grade] ?? ''}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MiniSparkline — avgViewers per stream, configurable size
// ─────────────────────────────────────────────────────────────────────────────

// Each point represents one stream's avgViewers — not intra-stream time series.
function MiniSparkline({ streams, width = 180, height = 40 }: { streams: RecentStream[]; width?: number; height?: number }) {
  const sorted = [...streams]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-6);
  if (sorted.length < 2) return <div style={{ width, height }} />;
  const vals = sorted.map(s => s.avgViewers);
  const mx = Math.max(...vals, 1);
  const mn = Math.min(...vals);
  const W = width, H = height, P = 2;
  const xp = (i: number) => P + (i / (vals.length - 1)) * (W - P * 2);
  const yp = (v: number) => P + (1 - (v - mn) / Math.max(mx - mn, 1)) * (H - P * 2);
  const pts = vals.map((v, i) => `${xp(i)},${yp(v)}`).join(' ');
  const area = `M ${xp(0)},${H} ${vals.map((v, i) => `L ${xp(i)},${yp(v)}`).join(' ')} L ${xp(vals.length - 1)},${H} Z`;
  return (
    <svg width={W} height={H} className="overflow-visible">
      <defs>
        <linearGradient id="spk-fill-v2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spk-fill-v2)" />
      <polyline points={pts} fill="none" stroke="#34d399" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xp(vals.length - 1)} cy={yp(vals[vals.length - 1])} r="2.5" fill="#34d399" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StreamHeroCard — dominant hero section
// ─────────────────────────────────────────────────────────────────────────────

interface HeroCardProps { hero: HeroStream | null | undefined; streams: RecentStream[]; loading: boolean; }

function StreamHeroCard({ hero, streams, loading }: HeroCardProps) {
  if (loading && !hero) {
    return <div className={`${V2_CARD} p-6 animate-pulse`} style={{ minHeight: 220 }} />;
  }
  if (!hero) {
    return (
      <div className={`${V2_CARD} p-6 flex flex-col items-center justify-center gap-2`} style={{ minHeight: 220 }}>
        <p className="text-zinc-500 text-sm">Ingen stream-data tilgjengelig</p>
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

  const dur = hero.durationMinutes
    ? `${Math.floor(hero.durationMinutes / 60)}t ${hero.durationMinutes % 60}min`
    : null;

  return (
    <div className={`${V2_CARD} p-6`}>
      <div className="flex gap-8">

        {/* Left: stream info + metrics + sparkline */}
        <div className="flex-1 min-w-0 flex flex-col gap-5">

          {/* Title area */}
          <div>
            <p className={V2_LABEL}>Siste stream</p>
            <h2 className="text-xl font-semibold text-zinc-100 leading-snug mt-1.5 line-clamp-2">{hero.title}</h2>
            <p className="text-sm text-zinc-400 mt-1">
              {hero.game}{dur ? ` · ${dur}` : ''} · {tidSiden(hero.endedAt)}
            </p>
          </div>

          {/* Big metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Snitt seere', value: hero.avgViewers, trend: trendPct },
              { label: 'Peak seere', value: hero.peakViewers, trend: null },
              { label: 'Chat-meldinger', value: hero.chatMessages, trend: null },
              { label: 'Chattere', value: hero.uniqueChatters, trend: null },
            ].map(m => (
              <div key={m.label}>
                <p className={V2_LABEL}>{m.label}</p>
                <p className="text-4xl font-semibold text-zinc-100 tabular-nums mt-1 leading-none">{m.value}</p>
                {m.trend !== null && (
                  <p className={`text-xs mt-1.5 font-medium ${m.trend >= 0 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                    {m.trend >= 0 ? '▲' : '▼'} {Math.abs(m.trend)}% fra forrige
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Sparkline */}
          {streams.length >= 2 && (
            <div>
              <MiniSparkline streams={streams} width={280} height={40} />
              <p className="text-[10px] text-zinc-500 mt-1.5">Gjennomsnittlige seere — {Math.min(6, streams.length)} siste streams</p>
            </div>
          )}
        </div>

        {/* Right: score ring + breakdown bars */}
        <div className="flex-shrink-0 flex flex-col items-center gap-5 pl-6 border-l border-zinc-800">
          <ScoreRing score={hero.streamScore} grade={hero.grade} />

          {/* Score breakdown bars */}
          <div className="w-32 space-y-2">
            {Object.entries(hero.scoreBreakdown).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <p className="text-[10px] text-zinc-500 w-12 text-right shrink-0">{dimLabels[key] ?? key}</p>
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(val / 20, 1) * 100}%`,
                      backgroundColor: GRADE_COLOR[hero.grade] ?? '#34d399',
                      opacity: 0.7,
                    }}
                  />
                </div>
                <p className="text-[10px] text-zinc-400 w-4 text-right shrink-0">{val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KanalstatusCard
// ─────────────────────────────────────────────────────────────────────────────

function KanalstatusCard({ slow, loading }: { slow: SlowData | null; loading: boolean }) {
  if (loading && !slow) {
    return <div className={`${V2_CARD} p-5 animate-pulse`} style={{ minHeight: 200 }} />;
  }
  const services = slow ? [
    { label: 'Twitch',       ok: slow.health.twitch.ok },
    { label: 'Discord',      ok: slow.health.discord.ok },
    { label: 'AI Producer',  ok: slow.health.openai.ok },
    { label: 'Supabase',     ok: slow.health.supabase.ok },
    { label: 'Scheduler',    ok: slow.health.scheduler.ok },
    { label: 'Klipping',     ok: slow.health.clipWorker.ok },
  ] : [];
  const allOk = services.length > 0 && services.every(s => s.ok);
  const downCount = services.filter(s => !s.ok).length;

  return (
    <div className={`${V2_CARD} p-5 flex flex-col`}>
      <p className={`${V2_LABEL} mb-4`}>Kanalstatus</p>

      {/* Overall badge */}
      <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border mb-5 ${
        allOk
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
          : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${allOk ? 'bg-emerald-400' : 'bg-orange-400'}`} />
        {services.length === 0 ? 'Laster…' : allOk ? 'Alle operative' : `${downCount} nede`}
      </div>

      {/* Services grid 2x3 */}
      <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
        {services.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-xs text-zinc-400">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics row cards
// ─────────────────────────────────────────────────────────────────────────────

function StreamYtelseCard({ hero, streams, loading }: HeroCardProps) {
  const avg = hero?.avgViewers ?? null;
  const peak = hero?.peakViewers ?? null;
  const sorted = [...streams].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const prev = sorted.find(s => s.streamId !== hero?.streamId);
  const trendPct = avg !== null && prev
    ? Math.round(((avg - prev.avgViewers) / Math.max(prev.avgViewers, 1)) * 100)
    : null;

  return (
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-3`}>Seerantall</p>
      {loading && avg === null ? (
        <div className="animate-pulse h-10 bg-zinc-800/60 rounded mt-2" />
      ) : (
        <>
          <p className="text-4xl font-semibold text-zinc-100 tabular-nums leading-none">{avg ?? '—'}</p>
          <p className="text-xs text-zinc-500 mt-1">snitt per stream</p>

          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">Peak: <span className="text-zinc-100 font-medium">{peak ?? '—'}</span></p>
            </div>
            {trendPct !== null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trendPct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-400'
              }`}>
                {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}%
              </span>
            )}
          </div>

          <div className="mt-4">
            <MiniSparkline streams={streams} width={160} height={32} />
            <p className="text-[10px] text-zinc-600 mt-1">per stream</p>
          </div>
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
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-1`}>Retensjon</p>
      <p className="text-[10px] text-zinc-600 mb-3">Siste stream</p>
      {loading && ret === null ? (
        <div className="animate-pulse h-10 bg-zinc-800/60 rounded" />
      ) : (
        <>
          <p className="text-4xl font-semibold text-zinc-100 tabular-nums leading-none">
            {ret !== null ? `${ret}%` : '—'}
          </p>
          {avg !== null && (
            <p className="text-xs text-zinc-400 mt-2">Snitt {streams.length} streams: {avg}%</p>
          )}
          {ret !== null && (
            <div className="mt-4">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(ret, 100)}%`,
                    background: 'linear-gradient(90deg, #34d399 0%, #10b981 100%)',
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-zinc-600">0%</span>
                <span className="text-[10px] text-zinc-600">100%</span>
              </div>
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
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-3`}>Chat-aktivitet</p>
      {loading && msgs === null ? (
        <div className="animate-pulse h-10 bg-zinc-800/60 rounded" />
      ) : (
        <>
          <p className="text-4xl font-semibold text-zinc-100 tabular-nums leading-none">{msgs ?? '—'}</p>
          <p className="text-xs text-zinc-500 mt-1">meldinger totalt</p>

          <div className="mt-4 grid grid-cols-2 gap-3 pt-3 border-t border-zinc-800">
            <div>
              <p className="text-xl font-semibold text-zinc-100 tabular-nums">{chatters ?? '—'}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">unike chattere</p>
            </div>
            {msgsPerMin !== null && (
              <div>
                <p className="text-xl font-semibold text-zinc-100 tabular-nums">{msgsPerMin}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">meldinger/min</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI + Content row
// ─────────────────────────────────────────────────────────────────────────────

function AIAnbefalingerCard({ innsikter, loading }: { innsikter: AiInnsikt[]; loading: boolean }) {
  // AiInnsikt only has: title, summary, confidenceScore, createdAt — no CTA or priority fields
  const top = innsikter.slice(0, 3);

  return (
    <div className={`${V2_CARD} p-5 col-span-2`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className={V2_LABEL}>AI-anbefalinger</p>
          <p className="text-sm text-zinc-400 mt-0.5">Basert på siste stream-analyse</p>
        </div>
      </div>

      {loading && top.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse h-16 bg-zinc-800/60 rounded-xl" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500 text-lg">✦</div>
          <p className="text-sm font-medium text-zinc-400">Ingen anbefalinger ennå</p>
          <p className="text-xs text-zinc-600 text-center max-w-[240px]">Etter neste stream genererer AI konkrete forbedringer basert på dine data.</p>
        </div>
      ) : (
        <div>
          {top.map((ins, i) => (
            <div key={i} className="flex gap-4 p-4 bg-zinc-900/60 rounded-xl border border-zinc-800 mb-2.5">
              <div className="flex-shrink-0 w-7 h-7 rounded-lg border border-zinc-700 flex items-center justify-center text-zinc-400 text-xs font-bold">
                {i + 1}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100 leading-snug">{ins.title}</p>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{ins.summary}</p>
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
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-4`}>Innholdsflyt</p>
      {loading && active.length === 0 ? (
        <div className="animate-pulse h-24 bg-zinc-800/60 rounded-xl" />
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500">▶</div>
          <p className="text-sm font-medium text-zinc-400">Ingen aktive VOD-jobber</p>
          <p className="text-xs text-zinc-600 text-center">Etter en stream vil behandling og klippestatus vises her.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(v => {
            const pct = v.progressPercent ?? 0;
            const sc = v.status === 'complete' ? 'text-emerald-400'
              : v.status === 'failed' ? 'text-red-400' : 'text-zinc-500';
            return (
              <div key={v.id}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-zinc-100 truncate max-w-[72%]">{v.title}</p>
                  <p className={`text-[10px] font-medium ${sc}`}>{v.status}</p>
                </div>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-1">
                  <div className="h-full bg-emerald-500/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                {(v.highlights > 0 || v.klipp > 0) && (
                  <p className="text-[10px] text-zinc-500">
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
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-4`}>Topp øyeblikk</p>
      {loading && top.length === 0 ? (
        <div className="animate-pulse h-24 bg-zinc-800/60 rounded-xl" />
      ) : top.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500">◆</div>
          <p className="text-sm font-medium text-zinc-400">Ingen klipp ennå</p>
          <p className="text-xs text-zinc-600 text-center">Høydepunkter fra streams vil vises her.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {top.map(h => (
            <div key={h.id} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500/60 mt-[5px]" />
              <p className="text-[11px] text-zinc-200 leading-snug line-clamp-2">
                {h.title ?? h.vodTitle ?? 'Høydepunkt'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KommendeHandlingerRow
// ─────────────────────────────────────────────────────────────────────────────

function KommendeHandlingerRow({ live }: { live: LiveData | null }) {
  const neste = live?.nesteStream ?? null;
  const hype = live?.preHype ?? null;
  const actions = (live?.actionCenter ?? []).slice(0, 3);

  if (!neste && !hype && actions.length === 0) return null;

  return (
    <div className={`${V2_CARD} p-5`}>
      <p className={`${V2_LABEL} mb-4`}>Kommende handlinger</p>
      <div className="flex flex-wrap gap-3">
        {neste && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900/60 border border-zinc-800 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Neste</span>
            <span className="text-sm font-medium text-zinc-100">{neste.dag} {neste.tid}</span>
            <span className="text-xs text-zinc-400">{neste.spill}</span>
            {neste.nedtelling && (
              <span className="text-[11px] text-emerald-400 font-medium">{neste.nedtelling}</span>
            )}
          </div>
        )}
        {hype && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium ${
            hype.status === 'sendt'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : hype.status === 'klar' || hype.status === 'planlagt'
                ? 'bg-zinc-900/60 border-zinc-800 text-zinc-100'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-500'
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
            className="flex items-center gap-2.5 px-4 py-2.5 bg-zinc-900/60 border border-zinc-800 rounded-xl hover:border-emerald-500/30 transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              a.priority === 'error' ? 'bg-red-500'
              : a.priority === 'warning' ? 'bg-orange-400'
              : 'bg-emerald-400'
            }`} />
            <span className="text-xs text-zinc-200">{a.title}</span>
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
    <div className="w-full max-w-[1600px] mx-auto space-y-4 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between py-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            {isLive ? 'Live Command Center' : 'Creator OS'}
          </h1>
          {sistOppdatert && (
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Oppdatert {tidSiden(sistOppdatert)}
            </p>
          )}
        </div>
        <button
          onClick={hentAlt}
          disabled={refreshing}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors disabled:cursor-not-allowed"
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
          <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setVisAvansert(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 bg-zinc-900/40 hover:bg-zinc-900/70 transition-all text-left"
            >
              <span className={V2_LABEL}>
                Mer innsikt
              </span>
              <span className="text-[11px] text-zinc-600">{visAvansert ? '▲ Skjul' : '▼ Vis'}</span>
            </button>
            {visAvansert && (
              <div className="px-4 py-4 bg-zinc-900/20 space-y-4">
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
                <p className={`${V2_LABEL} pt-2 border-t border-zinc-800/40`}>
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
                  <div className="border border-zinc-800/40 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setVisDebug(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2 bg-zinc-900/40 hover:bg-zinc-900/70 transition-all text-left"
                    >
                      <span className={V2_LABEL}>Debug</span>
                      <span className="text-[11px] text-zinc-600">{visDebug ? '▲ Skjul' : '▼ Vis'}</span>
                    </button>
                    {visDebug && (
                      <div className="px-4 py-3 bg-zinc-900/20 grid grid-cols-2 gap-x-6 gap-y-1">
                        {Object.entries(live.debug).map(([k, v]) => (
                          <div key={k} className="flex items-baseline gap-2">
                            <span className="text-[11px] text-zinc-600 font-mono w-32 flex-shrink-0">{k}</span>
                            <span className="text-[11px] text-zinc-300 font-mono truncate">{String(v ?? '—')}</span>
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
