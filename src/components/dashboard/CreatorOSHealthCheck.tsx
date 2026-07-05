'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warning' | 'error' | 'unknown';

interface SystemCheck {
  status: CheckStatus;
  message: string;
  lastSeen?: string;
  scopes?: string[];
}

interface SystemChecks {
  workspace: SystemCheck;
  twitchOAuth: SystemCheck;
  discordOAuth: SystemCheck;
  discordBot: SystemCheck;
  railwayBot: SystemCheck;
  creatorBrain: SystemCheck;
  aiProducer: SystemCheck;
  communityManager: SystemCheck;
  pollManager: SystemCheck;
  xpSystem: SystemCheck;
  partnerEngine: SystemCheck;
  learningEngine: SystemCheck;
  contentFactory: SystemCheck;
  streamCoach: SystemCheck;
}

interface HealthData {
  systemChecks?: SystemChecks | null;
  timestamp?: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const SYSTEMS: Array<{ key: keyof SystemChecks; label: string }> = [
  { key: 'workspace',        label: 'Workspace' },
  { key: 'twitchOAuth',      label: 'Twitch OAuth' },
  { key: 'discordOAuth',     label: 'Discord OAuth' },
  { key: 'discordBot',       label: 'Discord Bot' },
  { key: 'railwayBot',       label: 'Railway Chat Bot' },
  { key: 'creatorBrain',     label: 'Creator Brain' },
  { key: 'aiProducer',       label: 'AI Producer' },
  { key: 'communityManager', label: 'Community Manager' },
  { key: 'pollManager',      label: 'Poll Manager' },
  { key: 'xpSystem',         label: 'XP-system' },
  { key: 'partnerEngine',    label: 'Partner Engine' },
  { key: 'learningEngine',   label: 'Learning Engine' },
  { key: 'contentFactory',   label: 'Content Factory' },
  { key: 'streamCoach',      label: 'Stream Coach' },
];

const STATUS_CONFIG: Record<CheckStatus, {
  icon: string;
  badge: string;
  dotClass: string;
  iconClass: string;
  badgeClass: string;
}> = {
  ok: {
    icon: '✓',
    badge: 'OK',
    dotClass: 'bg-g-green',
    iconClass: 'text-g-green',
    badgeClass: 'bg-g-green/10 text-g-green border-g-green/20',
  },
  warning: {
    icon: '⚠',
    badge: 'ADVARSEL',
    dotClass: 'bg-amber-400',
    iconClass: 'text-amber-400',
    badgeClass: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  },
  error: {
    icon: '✗',
    badge: 'FEIL',
    dotClass: 'bg-red-500',
    iconClass: 'text-red-400',
    badgeClass: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  unknown: {
    icon: '?',
    badge: 'UKJENT',
    dotClass: 'bg-g-muted/30',
    iconClass: 'text-g-muted/40',
    badgeClass: 'bg-g-muted/5 text-g-muted/50 border-g-muted/20',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatLastSeen(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return 'Akkurat nå';
  if (mins < 60) return `for ${mins} min siden`;
  const h = Math.floor(mins / 60);
  if (h < 24)    return `for ${h} time${h === 1 ? '' : 'r'} siden`;
  const d = Math.floor(h / 24);
  return `for ${d} dag${d === 1 ? '' : 'er'} siden`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CheckStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${cfg.badgeClass}`}>
      {cfg.badge}
    </span>
  );
}

function CheckCard({ label, check }: { label: string; check: SystemCheck }) {
  const cfg = STATUS_CONFIG[check.status];
  return (
    <div className="bg-g-bg/30 border border-g-border/60 rounded-xl p-3">
      <div className="flex items-start gap-2">
        {/* Status icon */}
        <span
          className={`text-sm font-bold leading-none mt-0.5 flex-shrink-0 w-4 text-center ${cfg.iconClass}`}
          aria-hidden
        >
          {cfg.icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Name + badge row */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-g-text truncate">{label}</span>
            <StatusBadge status={check.status} />
          </div>

          {/* Message */}
          <p className="text-[11px] text-g-muted/70 leading-snug">{check.message}</p>

          {/* Timestamp */}
          {check.lastSeen && (
            <p className="text-[10px] text-g-muted/40 mt-1 font-mono">
              {formatLastSeen(check.lastSeen)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryDots({ checks }: { checks: SystemChecks }) {
  const counts = { ok: 0, warning: 0, error: 0, unknown: 0 };
  for (const { key } of SYSTEMS) {
    counts[checks[key].status]++;
  }

  return (
    <div className="flex items-center gap-3 text-[11px]">
      {counts.error > 0 && (
        <span className="flex items-center gap-1 text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          {counts.error} feil
        </span>
      )}
      {counts.warning > 0 && (
        <span className="flex items-center gap-1 text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
          {counts.warning} advarsel{counts.warning !== 1 ? 'er' : ''}
        </span>
      )}
      {counts.ok > 0 && (
        <span className="flex items-center gap-1 text-g-muted/50">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green inline-block" />
          {counts.ok} OK
        </span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  workspaceId?: string;
}

export function CreatorOSHealthCheck(_props: Props) {
  const [data, setData]       = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/system-health');
      if (res.ok) {
        const json: HealthData = await res.json();
        setData(json);
        setLastFetched(new Date().toISOString());
      }
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 60_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const checks = data?.systemChecks;

  const hasErrors   = checks ? SYSTEMS.some(({ key }) => checks[key].status === 'error')   : false;
  const hasWarnings = checks ? SYSTEMS.some(({ key }) => checks[key].status === 'warning') : false;
  const headerDotClass = hasErrors ? 'bg-red-500' : hasWarnings ? 'bg-amber-400' : 'bg-g-green';

  return (
    <section className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-g-bg/30 transition-all text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${loading ? 'bg-g-muted/30 animate-pulse' : headerDotClass}`} />
          <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted">
            Creator OS Systemstatus
          </h3>
          {!open && checks && (
            <span className="ml-2">
              <SummaryDots checks={checks} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {lastFetched && !open && (
            <span className="text-[10px] text-g-muted/30 font-mono hidden sm:block">
              {formatLastSeen(lastFetched)}
            </span>
          )}
          <span className="text-[11px] text-g-muted/40">{open ? '▲ Skjul' : '▼ Vis'}</span>
        </div>
      </button>

      {/* Collapsed summary: only show if there are errors/warnings */}
      {!open && !loading && checks && (hasErrors || hasWarnings) && (
        <div className="px-4 pb-4 space-y-2">
          {SYSTEMS
            .filter(({ key }) => checks[key].status === 'error' || checks[key].status === 'warning')
            .slice(0, 4)
            .map(({ key, label }) => (
              <div key={key} className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${STATUS_CONFIG[checks[key].status].dotClass}`} />
                <div className="min-w-0">
                  <span className="text-xs text-g-muted font-medium">{label}: </span>
                  <span className="text-xs text-g-muted/60">{checks[key].message}</span>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Expanded full grid */}
      {open && (
        <div className="border-t border-g-border/40 p-4">
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SYSTEMS.map(({ key }) => (
                <div key={key} className="h-16 bg-g-border/30 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && !checks && (
            <p className="text-xs text-g-muted/50 text-center py-4">
              Kunne ikke hente systemstatus — sjekk databasetilkobling og workspace-konfigurasjon.
            </p>
          )}

          {!loading && checks && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SYSTEMS.map(({ key, label }) => (
                  <CheckCard key={key} label={label} check={checks[key]} />
                ))}
              </div>

              {/* Footer */}
              <div className="mt-4 pt-3 border-t border-g-border/30 flex items-center justify-between">
                <SummaryDots checks={checks} />
                <div className="flex items-center gap-2">
                  {lastFetched && (
                    <span className="text-[10px] text-g-muted/30 font-mono">
                      Oppdatert {formatLastSeen(lastFetched)}
                    </span>
                  )}
                  <button
                    onClick={fetchHealth}
                    className="text-[11px] text-g-muted/40 hover:text-g-muted transition-colors"
                  >
                    Oppdater
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
