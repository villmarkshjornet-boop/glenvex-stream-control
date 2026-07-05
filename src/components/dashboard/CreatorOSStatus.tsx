'use client';

import { useEffect, useState, useCallback } from 'react';

interface CreatorOSData {
  workspace: { id: string; alpha_enabled: boolean; activeWorkspaces: number };
  uptime: {
    botLastHeartbeat: string | null;
    botUptimeMinutes: number | null;
  };
  lastRuns: {
    creatorBrain:     string | null;
    learningEngine:   string | null;
    pollManager:      string | null;
    communityManager: string | null;
    aiProducer:       string | null;
    streamCoach:      string | null;
    contentFactory:   string | null;
    partnerEngine:    string | null;
    xpSystem:         string | null;
  };
  activeWorkspaceCount: number;
  streamCount24h: number;
  pollCount7d: number;
  decisionsToday: number;
}

/** Norwegian relative time string */
function tidSiden(iso: string | null): string {
  if (!iso) return 'Aldri';
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60)    return 'akkurat nå';
  if (sek < 3600)  return `${Math.floor(sek / 60)} min siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)} timer siden`;
  const dager = Math.floor(sek / 86400);
  return `${dager} dager siden`;
}

/** Returns minutes since a timestamp, or null if no timestamp */
function minutterSiden(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

/** Color class for "last active" timestamps */
function sistAktivFarge(iso: string | null): string {
  if (!iso) return 'text-red-400';
  const dager = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (dager >= 7) return 'text-red-400';
  return 'text-g-muted';
}

/** Dot color class for bot heartbeat */
function heartbeatDotKlasse(iso: string | null): string {
  const min = minutterSiden(iso);
  if (min === null) return 'bg-red-400';
  if (min < 5)  return 'bg-g-green animate-pulse';
  if (min < 15) return 'bg-yellow-400';
  return 'bg-red-400';
}

/** Text color class for heartbeat label */
function heartbeatTekstFarge(iso: string | null): string {
  const min = minutterSiden(iso);
  if (min === null) return 'text-red-400';
  if (min < 5)  return 'text-g-green';
  if (min < 15) return 'text-yellow-400';
  return 'text-red-400';
}

const SUBSYSTEMER: Array<{ emoji: string; label: string; key: keyof CreatorOSData['lastRuns'] }> = [
  { emoji: '🧠', label: 'Creator Brain',    key: 'creatorBrain' },
  { emoji: '📚', label: 'Learning Engine',  key: 'learningEngine' },
  { emoji: '🗳️', label: 'Poll Manager',     key: 'pollManager' },
  { emoji: '👥', label: 'Community Mgr',    key: 'communityManager' },
  { emoji: '🤖', label: 'AI Producer',      key: 'aiProducer' },
  { emoji: '📊', label: 'Stream Coach',     key: 'streamCoach' },
  { emoji: '🏭', label: 'Content Factory',  key: 'contentFactory' },
  { emoji: '🤝', label: 'Partner Engine',   key: 'partnerEngine' },
  { emoji: '⭐', label: 'XP-system',        key: 'xpSystem' },
];

export function CreatorOSStatus() {
  const [data, setData] = useState<CreatorOSData | null>(null);
  const [loading, setLoading] = useState(true);

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/creator-os-status');
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, [hent]);

  if (loading) {
    return (
      <div className="bg-g-card border border-g-border rounded-xl px-4 py-3">
        <div className="h-3 w-48 bg-g-border/40 rounded animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const hbDot = heartbeatDotKlasse(data.uptime.botLastHeartbeat);
  const hbTekst = heartbeatTekstFarge(data.uptime.botLastHeartbeat);

  return (
    <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-g-border/40">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hbDot}`} />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-g-muted">
          Creator OS — Operasjonsstatus
        </h3>
        {data.uptime.botLastHeartbeat && (
          <span className={`ml-auto text-[11px] font-mono ${hbTekst}`}>
            {tidSiden(data.uptime.botLastHeartbeat)}
          </span>
        )}
      </div>

      {/* ── Two-column body ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 divide-x divide-g-border/30">

        {/* Left — Sist aktiv */}
        <div className="px-4 py-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-g-muted/50 font-bold mb-2">
            Sist aktiv
          </p>
          {SUBSYSTEMER.map(({ emoji, label, key }) => {
            const ts = data.lastRuns[key];
            const farge = sistAktivFarge(ts);
            return (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-[12px] leading-none flex-shrink-0">
                  {emoji}
                </span>
                <span className="text-[11px] text-g-muted flex-1 truncate">
                  {label}
                </span>
                <span className={`text-[11px] font-mono flex-shrink-0 ${farge}`}>
                  {tidSiden(ts)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right — Tall */}
        <div className="px-4 py-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-g-muted/50 font-bold mb-2">
            Tall
          </p>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-g-muted">Aktive workspaces</span>
            <span className="text-[11px] font-mono font-bold text-g-text tabular-nums">
              {data.activeWorkspaceCount}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-g-muted">Streams siste 24t</span>
            <span className="text-[11px] font-mono font-bold text-g-text tabular-nums">
              {data.streamCount24h}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-g-muted">Polls siste 7 dager</span>
            <span className="text-[11px] font-mono font-bold text-g-text tabular-nums">
              {data.pollCount7d}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-g-muted">AI-beslutninger i dag</span>
            <span className="text-[11px] font-mono font-bold text-g-text tabular-nums">
              {data.decisionsToday}
            </span>
          </div>

          <div className="pt-1 border-t border-g-border/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-g-muted">Bot heartbeat</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hbDot}`} />
                <span className={`text-[11px] font-mono ${hbTekst}`}>
                  {data.uptime.botLastHeartbeat ? tidSiden(data.uptime.botLastHeartbeat) : 'Aldri'}
                </span>
              </div>
            </div>
            {data.uptime.botUptimeMinutes !== null && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-g-muted">Uptime i dag</span>
                <span className="text-[11px] font-mono text-g-muted/70 tabular-nums">
                  {data.uptime.botUptimeMinutes < 60
                    ? `${data.uptime.botUptimeMinutes} min`
                    : `${Math.floor(data.uptime.botUptimeMinutes / 60)}t ${data.uptime.botUptimeMinutes % 60}m`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
