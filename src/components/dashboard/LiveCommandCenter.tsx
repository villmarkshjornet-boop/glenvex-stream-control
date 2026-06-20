'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Brain, Clock, Zap, ChevronRight } from 'lucide-react';
import type { LiveData, SlowData, LiveAgentTip } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(startIso).getTime());
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  const s  = Math.floor((ms % 60_000) / 1_000);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function LiveTimer({ startIso }: { startIso: string }) {
  const [t, setT] = useState(() => formatDuration(startIso));
  useEffect(() => {
    const id = setInterval(() => setT(formatDuration(startIso)), 1_000);
    return () => clearInterval(id);
  }, [startIso]);
  return <span className="text-sm font-mono text-g-muted tabular-nums">{t}</span>;
}

function catHref(cat?: string): string {
  const map: Record<string, string> = {
    chat: '/', viewers: '/', promotion: '/partner-hub',
    raid: '/raid-manager', sponsor: '/partner-hub', content: '/content-factory-admin',
  };
  return map[cat ?? ''] ?? '/';
}

// ── AI Producer voice — synthesizes from liveAgentTips → actionCenter → insights ──

interface Voice {
  anbefaling: string;
  hvorfor: string | null;
  kilde: string;
  href: string;
  confidence: number | null;
}

function buildVoice(live: LiveData): Voice {
  const tips = [...(live.liveAgentTips ?? [])].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
  const top  = tips[0];
  if (top?.message) {
    return {
      anbefaling: top.message,
      hvorfor:    top.reasoning ?? null,
      kilde:      'Live Agent V2',
      href:       catHref(top.category),
      confidence: top.priority ?? null,
    };
  }

  const la = live.actionCenter?.find(a => a.type?.startsWith('live_agent'));
  if (la) {
    return { anbefaling: la.title, hvorfor: la.detail ?? null, kilde: 'Action Center', href: la.href, confidence: null };
  }

  const ins = live.nyesteInnsikter?.[0];
  if (ins) {
    return {
      anbefaling: ins.title,
      hvorfor:    ins.summary,
      kilde:      'AI Memory',
      href:       '/stream-coach',
      confidence: ins.confidenceScore ? Math.round(ins.confidenceScore * 100) : null,
    };
  }

  return { anbefaling: 'Alle systemer aktive — overvåker stream.', hvorfor: null, kilde: '', href: '/', confidence: null };
}

// ── Tidsplan — derived from stream duration + known optimal timing windows ────

interface PlanItem { label: string; delta: number; href: string; ready: boolean }

const TIMING_TARGETS = [
  { label: 'Første chat-engasjement', min: 5,  href: '/'                   },
  { label: 'Partner-nevnelse',         min: 20, href: '/partner-hub'        },
  { label: 'Poll om spillvalg',        min: 35, href: '/'                   },
  { label: 'Discord CTA',             min: 40, href: '/'                   },
  { label: 'Sponsor-nevnelse',        min: 60, href: '/partner-hub'        },
  { label: 'Raid-vurdering',          min: 90, href: '/raid-manager'       },
];

function buildPlan(startIso: string | null): PlanItem[] {
  if (!startIso) return [];
  const elapsedMin = (Date.now() - new Date(startIso).getTime()) / 60_000;
  return TIMING_TARGETS
    .map(p => ({
      label: p.label,
      delta: Math.round(p.min - elapsedMin),
      href:  p.href,
      ready: Math.abs(p.min - elapsedMin) <= 3,
    }))
    .filter(p => p.delta > -5)
    .slice(0, 6);
}

// ── Learning items — from lærdom, innsikter, poll results ─────────────────────

function buildLearning(live: LiveData): string[] {
  return [
    ...(live.lærdom?.utførteTiltak?.slice(0, 2).map(t => t.summary) ?? []),
    ...(live.nyesteInnsikter?.slice(0, 2).map(i => i.summary || i.title) ?? []),
    ...(live.pollManager?.pollLearning ? [live.pollManager.pollLearning] : []),
  ].filter(Boolean).slice(0, 4) as string[];
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LiveCommandCenter({ live, slow }: { live: LiveData; slow: SlowData }) {
  const status    = slow.streamStatus;
  const startIso  = live.systemEvents?.find(e =>
    e.event_type === 'LIVE_AGENT_STARTED' || e.event_type === 'LIVE_DETECTED'
  )?.created_at ?? null;

  const voice     = buildVoice(live);
  const plan      = buildPlan(startIso);
  const learning  = buildLearning(live);
  const pollMgr   = live.pollManager;

  const systemer      = live.kontrollsenter ?? [];
  const activeCount   = systemer.filter(s => s.status === 'ok').length;
  const errorSystems  = systemer.filter(s => s.status === 'feil');

  // Actions: everything except the top live-agent tip (already in voice) and next_stream
  const topTipType   = live.liveAgentTips?.[0]
    ? `live_agent_${live.liveAgentTips[0].category}` : null;
  const actions = (live.actionCenter ?? [])
    .filter(a => !(topTipType && a.type === topTipType) && a.type !== 'next_stream')
    .slice(0, 5);

  const PRIORITY_DOT: Record<string, string> = {
    error: 'text-red-400', warning: 'text-yellow-400', action: 'text-g-green',
  };

  return (
    <div className="space-y-4">

      {/* ── Stream header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-g-card border border-red-500/30 rounded-2xl px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-2 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-black text-red-400 tracking-widest">LIVE</span>
          </span>
          {status.game  && <span className="text-sm font-bold text-g-text flex-shrink-0">{status.game}</span>}
          {status.title && <span className="text-sm text-g-muted truncate hidden sm:block">{status.title}</span>}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="text-sm font-bold text-g-text">{status.viewers} seere</span>
          {startIso && <LiveTimer startIso={startIso} />}
        </div>
      </div>

      {/* ── AI Producer ───────────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-green/30 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-g-green" />
            <p className="text-xs text-g-green uppercase tracking-widest font-black">AI Producer</p>
          </div>
          {voice.confidence != null && (
            <span className="text-[10px] text-g-muted/40 font-mono">{voice.confidence}% confidence</span>
          )}
        </div>
        <Link href={voice.href} className="block group">
          <p className="text-[15px] font-bold text-g-text leading-snug group-hover:text-g-green transition-colors">
            {voice.anbefaling}
          </p>
          {voice.hvorfor && (
            <p className="mt-2 text-sm text-g-muted leading-relaxed">{voice.hvorfor}</p>
          )}
        </Link>
        {voice.kilde && (
          <p className="mt-3 pt-3 border-t border-g-border/30 text-[10px] text-g-muted/40 uppercase tracking-wider">
            Kilde: {voice.kilde}
          </p>
        )}
      </div>

      {/* ── Handlinger + Tidsplan ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Handlinger */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Handlinger</p>
          {actions.length === 0 ? (
            <p className="text-sm text-g-muted">Ingen ventende handlinger.</p>
          ) : (
            <div className="space-y-1.5">
              {actions.map((item, i) => (
                <Link key={i} href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all group">
                  <Zap size={12} className={`flex-shrink-0 ${PRIORITY_DOT[item.priority] ?? 'text-g-green'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text leading-snug">{item.title}</p>
                    {item.detail && (
                      <p className="text-[11px] text-g-muted mt-0.5 truncate">{item.detail}</p>
                    )}
                  </div>
                  <ChevronRight size={12} className="text-g-muted/30 group-hover:text-g-muted flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Tidsplan */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Tidsplan</p>
          {plan.length === 0 ? (
            <p className="text-sm text-g-muted">Beregner tidsplan…</p>
          ) : (
            <div className="space-y-1.5">
              {plan.map((item, i) => (
                <Link key={i} href={item.href}
                  className="flex items-center gap-3 px-3 py-2 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all">
                  <Clock size={12} className={`flex-shrink-0 ${item.ready ? 'text-g-green animate-pulse' : 'text-g-muted/30'}`} />
                  <p className={`flex-1 text-xs font-bold ${item.ready ? 'text-g-green' : 'text-g-text'}`}>{item.label}</p>
                  <span className={`text-[11px] font-mono font-bold ${item.ready ? 'text-g-green' : 'text-g-muted/50'}`}>
                    {item.ready ? 'NÅ →' : item.delta > 0 ? `+${item.delta}m` : `${item.delta}m`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Poll pågår ────────────────────────────────────────────────────────── */}
      {pollMgr?.activePoll && (
        <div className="bg-g-card border border-yellow-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <p className="text-xs text-yellow-400 uppercase tracking-widest font-black">Poll pågår</p>
            <span className="ml-auto text-[10px] text-g-muted/40">{pollMgr.activePoll.pollType}</span>
          </div>
          <p className="text-sm font-bold text-g-text">{pollMgr.activePoll.question}</p>
          {pollMgr.activePoll.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pollMgr.activePoll.options.map((o, i) => (
                <span key={i} className="px-2.5 py-1 text-[11px] border border-yellow-500/20 rounded-lg text-g-muted bg-yellow-500/5">
                  {o.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Siste poll-resultat ───────────────────────────────────────────────── */}
      {!pollMgr?.activePoll && pollMgr?.lastPoll?.winner && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">Siste poll-resultat</p>
          <p className="text-sm text-g-text">
            <span className="font-bold text-g-green">{pollMgr.lastPoll.winner}</span>
            {(pollMgr.lastPoll.totalVotes ?? 0) > 0 && (
              <span className="text-g-muted ml-2">({pollMgr.lastPoll.totalVotes} stemmer)</span>
            )}
          </p>
          {pollMgr.pollLearning && (
            <p className="mt-1 text-xs text-g-muted">{pollMgr.pollLearning}</p>
          )}
        </div>
      )}

      {/* ── Hva AI vet om kanalen ─────────────────────────────────────────────── */}
      {learning.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Hva AI vet om deg</p>
          <div className="space-y-2">
            {learning.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-g-green/60 text-xs mt-0.5 flex-shrink-0 font-mono">→</span>
                <p className="text-sm text-g-text leading-snug">{item}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Systemer ──────────────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Alle systemer</p>
          <span className="text-[11px] font-bold text-g-green">{activeCount}/{systemer.length} aktive</span>
        </div>
        {errorSystems.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {errorSystems.map(s => (
              <span key={s.key} className="px-2 py-0.5 text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg font-bold">
                {s.label} — feil
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {systemer.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                s.status === 'ok'   ? 'bg-g-green'  :
                s.status === 'feil' ? 'bg-red-400'  : 'bg-g-muted/25'
              }`} />
              <span className={`text-[11px] ${
                s.status === 'feil' ? 'text-red-400' :
                s.status === 'ok'   ? 'text-g-muted' : 'text-g-muted/40'
              }`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
