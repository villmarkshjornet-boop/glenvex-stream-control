'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { tidSiden } from '@/components/dashboard/helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  id: string; username: string; displayName: string;
  xp: number; level: number; messages: number; reactions: number;
  voiceMinutes: number; streamsAttended: number; subs: number; giftSubs: number;
  raids: number; engagementScore: number; communityScore: number;
  badges: string[]; lastSeen: string; joinedAt: string;
}

interface AiProfil {
  viktighetScore: number; trend: 'vekst' | 'stabil' | 'fallende';
  atRisk: boolean; erHero: boolean; erCore: boolean; erSupporter: boolean; erRetention: boolean;
  punkter: string[]; aiBeskrivelse: string | null;
}

interface Historikk {
  aktiv7d: boolean; aktiv30d: boolean; aktiv90d: boolean;
  daysSinceJoined: number; daysSinceLastSeen: number;
  snitMeldingerPerDag: number; snitStreamsPerUke: number;
}

interface Kontekst {
  key: string; summary: string; type: string; agent: string;
  occurrences: number; updatedAt: string;
}

interface MemberDetail {
  member: Member; aiProfil: AiProfil; historikk: Historikk;
  kontekst: Kontekst[]; isFollowUp: boolean;
}

interface TopMember7d {
  userId: string; displayName: string; level: number;
  totalXp: number; xp7d: number; streakDays: number; badges: string[];
}

interface LevelUp {
  userId: string; username: string; newLevel: number;
  rolleNavn: string | null; timestamp: string;
}

interface BotEvent {
  eventType: string; title: string; severity: string;
  timestamp: string; metadata: Record<string, any>;
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  type: 'config' | 'activity' | 'reward' | 'info';
  message: string;
}

interface Diagnostics {
  communityKanalKonfigurert: boolean; adminKanalKonfigurert: boolean;
  communityAktiv: boolean; xpAktiv: boolean; hypeAktiv: boolean; idleAktiv: boolean;
  idleThresholdMinutes: number; rewardRolesCount: number;
}

interface Health {
  activeMembers24h: number; activeMembers7d: number;
  xpGranted7d: number; levelUps7d: number;
  lastBotPostAt: string | null; lastBotPostType: string | null;
  idleStatus: 'active' | 'idle' | 'unknown'; idleMinutes: number | null;
}

interface SummaryData {
  health: Health;
  topMembers7d: TopMember7d[];
  recentLevelUps: LevelUp[];
  botActivity: BotEvent[];
  recommendations: Recommendation[];
  diagnostics: Diagnostics;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LEVEL_ROLLER: { level: number; navn: string; farge: string }[] = [
  { level: 50, navn: 'Community Hero', farge: 'text-yellow-400 border-yellow-400/30' },
  { level: 30, navn: 'Veteran',        farge: 'text-orange-400 border-orange-400/30' },
  { level: 15, navn: 'Regular',        farge: 'text-blue-400 border-blue-400/30' },
  { level: 5,  navn: 'Active Member',  farge: 'text-g-green border-g-green/30' },
];

const TREND_CONFIG = {
  vekst:    { ikon: '↑', farge: 'text-g-green',   label: 'Vekst' },
  stabil:   { ikon: '→', farge: 'text-yellow-400', label: 'Stabil' },
  fallende: { ikon: '↓', farge: 'text-red-400',    label: 'Fallende' },
};

const ACTIVITY_ICONS: Record<string, string> = {
  COMMUNITY_MVP_SELECTED:                    '🏆',
  COMMUNITY_MVP_SKIPPED_NO_ACTIVITY:         '⏸',
  COMMUNITY_HYPE_SENT:                       '⭐',
  COMMUNITY_HYPE_SKIPPED_MISSING_CHANNEL:    '⚠️',
  COMMUNITY_HYPE_SKIPPED_DAILY_LIMIT:        '⏸',
  COMMUNITY_HYPE_SKIPPED_NO_ACTIVITY:        '⏸',
  COMMUNITY_ACTIVITY_PROMPT_SENT:            '💬',
  COMMUNITY_ACTIVITY_SKIPPED_MISSING_CHANNEL:'⚠️',
  COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT:     '⏸',
  COMMUNITY_ACTIVITY_SKIPPED_RECENT_ACTIVITY:'✓',
  COMMUNITY_IDLE_DETECTED:                   '🔇',
  COMMUNITY_REWARD_ROLE_MISSING:             '🔴',
};

const PRIO_STYLES: Record<string, string> = {
  high:   'border-red-500/40 bg-red-500/5 text-red-400',
  medium: 'border-yellow-500/40 bg-yellow-500/5 text-yellow-400',
  low:    'border-g-border bg-g-bg text-g-muted',
};

const PRIO_DOT: Record<string, string> = {
  high: 'text-red-400', medium: 'text-yellow-400', low: 'text-g-muted',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRolle(level: number) { return LEVEL_ROLLER.find(r => level >= r.level) ?? null; }


function getMemberSegments(m: Member): { navn: string; farge: string }[] {
  const now = Date.now();
  const cut7d  = now - 7  * 86400_000;
  const cut14d = now - 14 * 86400_000;
  const ls = m.lastSeen ? new Date(m.lastSeen).getTime() : 0;
  const sup = (m.subs ?? 0) + (m.giftSubs ?? 0) * 2 + (m.raids ?? 0) * 3;
  const segs: { navn: string; farge: string }[] = [];
  if ((m.streamsAttended ?? 0) >= 5 && ls > cut7d && ((m.messages ?? 0) > 10 || (m.engagementScore ?? 0) >= 20))
    segs.push({ navn: 'Core', farge: 'text-emerald-400 border-emerald-400/30' });
  if ((m.level ?? 0) >= 30 || sup >= 5)
    segs.push({ navn: 'Hero', farge: 'text-yellow-400 border-yellow-400/30' });
  else if (sup >= 3)
    segs.push({ navn: 'Supporter', farge: 'text-pink-400 border-pink-400/30' });
  if ((m.streamsAttended ?? 0) >= 8 && ls > cut14d)
    segs.push({ navn: 'Retention', farge: 'text-purple-400 border-purple-400/30' });
  return segs;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function XPBar({ xp, level }: { xp: number; level: number }) {
  const XP_PER_LEVEL = 500;
  const pct = Math.min(100, Math.round(((xp - (level - 1) * XP_PER_LEVEL) / XP_PER_LEVEL) * 100));
  return (
    <div className="w-full">
      <div className="flex justify-between text-[9px] text-g-muted mb-1">
        <span>Lv {level}</span><span>{pct}% til Lv {level + 1}</span>
      </div>
      <div className="w-full bg-g-border rounded-full h-1">
        <div className="bg-g-green h-1 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ScoreBar({ val, max, color = 'bg-g-green' }: { val: number; max: number; color?: string }) {
  const pct = Math.min(100, Math.round((val / Math.max(val, max)) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-g-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono text-g-muted w-8 text-right">{val.toLocaleString()}</span>
    </div>
  );
}

function StatCell({ label, value, color = 'text-g-text' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center p-2 bg-g-bg border border-g-border rounded-lg">
      <p className="text-[8px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className={`text-sm font-black font-mono mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function ActionBtn({
  label, icon, active, disabled, disabledReason, danger, onClick,
}: {
  label: string; icon: string; active?: boolean; disabled?: boolean;
  disabledReason?: string; danger?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={disabled ? disabledReason : undefined}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[10px] font-bold transition-all
        ${disabled
          ? 'opacity-40 cursor-not-allowed border-g-border text-g-muted'
          : active
            ? 'bg-g-green/10 border-g-green/40 text-g-green'
            : danger
              ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
              : 'border-g-border text-g-muted hover:border-g-green/30 hover:text-g-text'
        }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {disabled && <span className="text-[8px] opacity-60">({disabledReason?.split(' ').slice(0, 2).join(' ')})</span>}
    </button>
  );
}

function ActivityBand({ label, aktiv }: { label: string; aktiv: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-g-border/20 last:border-0">
      <span className="text-[10px] text-g-muted">{label}</span>
      <span className={`text-[10px] font-bold ${aktiv ? 'text-g-green' : 'text-red-400'}`}>
        {aktiv ? '● Aktiv' : '○ Inaktiv'}
      </span>
    </div>
  );
}

// ── Member Detail View ────────────────────────────────────────────────────────

function MemberDetailView({
  detail, loading, onBack, onAction,
}: {
  detail: MemberDetail | null; loading: boolean;
  onBack: () => void; onAction: (action: string) => Promise<void>;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    await onAction(action);
    setActionLoading(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-[10px] text-g-muted hover:text-g-text transition-colors">
          ← Tilbake til liste
        </button>
        {detail && (
          <a href={`https://discord.com/users/${detail.member.id}`} target="_blank" rel="noopener noreferrer"
            className="text-[9px] text-g-muted hover:text-[#5865F2] border border-g-border hover:border-[#5865F2]/40 rounded px-2 py-1 transition-colors">
            Discord profil ↗
          </a>
        )}
      </div>

      {loading && (
        <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
          <p className="text-xs text-g-muted animate-pulse">Henter AI-vurdering...</p>
        </div>
      )}

      {!loading && detail && (() => {
        const { member: m, aiProfil, historikk, kontekst } = detail;
        const rolle = getRolle(m.level);
        const segs  = getMemberSegments(m);
        const trend = TREND_CONFIG[aiProfil.trend];

        return (
          <div className="space-y-4">
            <div className="bg-g-card border border-g-border rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl font-black text-g-green">{m.displayName?.[0]?.toUpperCase() ?? '?'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-black text-g-text">{m.displayName}</h2>
                  <p className="text-[10px] text-g-muted">@{m.username}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {rolle && <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${rolle.farge}`}>{rolle.navn}</span>}
                    {segs.map(s => (
                      <span key={s.navn} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${s.farge}`}>{s.navn}</span>
                    ))}
                    {m.badges.map(b => (
                      <span key={b} className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-purple-400/30 text-purple-400">{b}</span>
                    ))}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className={`text-lg font-black font-mono ${trend.farge}`}>{trend.ikon}</p>
                  <p className={`text-[9px] font-bold ${trend.farge}`}>{trend.label}</p>
                  <p className="text-[8px] text-g-muted mt-1">Score: {aiProfil.viktighetScore}</p>
                </div>
              </div>
              <div className="mt-4">
                <XPBar xp={m.xp} level={m.level} />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <StatCell label="XP" value={m.xp.toLocaleString()} color="text-g-green" />
              <StatCell label="Meldinger" value={m.messages} />
              <StatCell label="Streams" value={m.streamsAttended} />
              <StatCell label="Level" value={m.level} color="text-yellow-400" />
            </div>

            {aiProfil.aiBeskrivelse && (
              <div className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">AI-vurdering</p>
                <p className="text-xs text-g-text leading-relaxed">{aiProfil.aiBeskrivelse}</p>
                {aiProfil.punkter.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {aiProfil.punkter.map((p, i) => (
                      <li key={i} className="text-[10px] text-g-muted flex items-start gap-1">
                        <span className="text-g-green mt-0.5">·</span> {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Engasjement</p>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-g-muted">Engasjement</span>
                  <span className="text-g-text font-mono">{m.engagementScore}</span>
                </div>
                <ScoreBar val={m.engagementScore} max={100} />
                <div className="flex justify-between text-[10px] mt-2">
                  <span className="text-g-muted">Community-score</span>
                  <span className="text-g-text font-mono">{m.communityScore}</span>
                </div>
                <ScoreBar val={m.communityScore} max={100} color="bg-blue-500" />
              </div>
            </div>

            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Historikk</p>
              <ActivityBand label="Aktiv siste 7 dager"  aktiv={historikk.aktiv7d} />
              <ActivityBand label="Aktiv siste 30 dager" aktiv={historikk.aktiv30d} />
              <ActivityBand label="Aktiv siste 90 dager" aktiv={historikk.aktiv90d} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <StatCell label="Dager siden join"       value={historikk.daysSinceJoined} />
                <StatCell label="Dager siden sett"       value={historikk.daysSinceLastSeen} />
                <StatCell label="Snitt msg/dag"          value={historikk.snitMeldingerPerDag?.toFixed(1) ?? '0'} />
                <StatCell label="Snitt streams/uke"      value={historikk.snitStreamsPerUke?.toFixed(1) ?? '0'} />
              </div>
              <p className="text-[8px] text-g-muted/60 pt-1">
                Historikk viser akkumulerte totaler. Per-periode data samles fra daglig aktivitet.
              </p>
            </div>

            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Handlinger</p>
              <div className="flex flex-wrap gap-2">
                <ActionBtn label="Gi XP-bonus" icon="⭐" onClick={() => handleAction('xp_bonus')}
                  disabled={!!actionLoading} disabledReason={actionLoading ?? undefined} />
                <ActionBtn label="Send DM" icon="✉️" onClick={() => handleAction('send_dm')}
                  disabled={!!actionLoading} disabledReason={actionLoading ?? undefined} />
                <ActionBtn label="Merk som core" icon="🌟" active={aiProfil.erCore} onClick={() => handleAction('mark_core')}
                  disabled={!!actionLoading} disabledReason={actionLoading ?? undefined} />
                <ActionBtn label="Merk at-risk" icon="⚠️" active={aiProfil.atRisk} danger onClick={() => handleAction('mark_at_risk')}
                  disabled={!!actionLoading} disabledReason={actionLoading ?? undefined} />
              </div>
            </div>

            {kontekst.length > 0 && (
              <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-2">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Minne & Kontekst</p>
                <div className="space-y-2">
                  {kontekst.map((k, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-g-border/20 last:border-0">
                      <div className="text-[8px] px-1.5 py-0.5 rounded border border-g-border text-g-muted font-mono flex-shrink-0 mt-0.5">{k.type}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-g-text leading-relaxed">{k.summary}</p>
                        <p className="text-[8px] text-g-muted/60 mt-0.5">{k.agent} · {k.occurrences}x</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Dashboard widgets ─────────────────────────────────────────────────────────

function HealthWidget({ health, diagnostics }: { health: Health; diagnostics: Diagnostics }) {
  const idleLabel =
    health.idleStatus === 'active' ? '● Aktiv'
    : health.idleStatus === 'idle'
      ? `● Idle${health.idleMinutes != null && health.idleMinutes >= 60 ? ` (${Math.round(health.idleMinutes / 60)}t)` : health.idleMinutes != null ? ` (${health.idleMinutes}m)` : ''}`
    : '● Ukjent';

  const idleColor =
    health.idleStatus === 'active' ? 'text-g-green'
    : health.idleStatus === 'idle' ? 'text-yellow-400'
    : 'text-g-muted';

  const lastPostLabel = health.lastBotPostAt
    ? `${health.lastBotPostType === 'mvp' ? 'MVP' : health.lastBotPostType === 'hype' ? 'Hype' : 'Prompt'} · ${tidSiden(health.lastBotPostAt)}`
    : '—';

  const hasData = health.activeMembers7d > 0 || health.xpGranted7d > 0;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Community Health</p>
        <span className={`text-[10px] font-bold ${idleColor}`}>{idleLabel}</span>
      </div>
      {!hasData && (
        <p className="text-[10px] text-g-muted py-2">
          XP-systemet er aktivt — community-aktivitet vises her etter første melding i Discord-kanalen.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCell label="Aktive 24t"  value={health.activeMembers24h} color={health.activeMembers24h > 0 ? 'text-g-green' : 'text-g-text'} />
        <StatCell label="Aktive 7d"   value={health.activeMembers7d}  color={health.activeMembers7d  > 0 ? 'text-g-text' : 'text-g-muted'} />
        <StatCell label="XP gitt 7d"  value={health.xpGranted7d.toLocaleString()} color="text-g-text" />
        <StatCell label="Level-ups 7d" value={health.levelUps7d} color={health.levelUps7d > 0 ? 'text-yellow-400' : 'text-g-text'} />
      </div>
      {!diagnostics.communityKanalKonfigurert && (
        <div className="mt-3 text-[10px] text-yellow-400 flex items-center gap-1.5">
          <span>⚠️</span>
          <span>Community-kanal ikke konfigurert — bot kan ikke sende automatiske meldinger.</span>
          <Link href="/innstillinger" className="underline hover:text-yellow-300">Sett opp →</Link>
        </div>
      )}
      {health.lastBotPostAt && (
        <p className="text-[9px] text-g-muted mt-3">Siste bot-post: {lastPostLabel}</p>
      )}
    </div>
  );
}

function TopMembersWidget({ members }: { members: TopMember7d[] }) {
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Topp Membres — 7 dager</p>
      {members.length === 0 ? (
        <p className="text-[10px] text-g-muted py-2">
          Ingen XP-aktivitet registrert siste 7 dager. Sjekk at community-kanal er satt og at XP-systemet er aktivt.
        </p>
      ) : (
        <div className="space-y-2">
          {members.map((m, i) => {
            const rolle = getRolle(m.level);
            return (
              <div key={m.userId} className="flex items-center gap-3 py-2 border-b border-g-border/20 last:border-0">
                <span className={`text-[10px] font-black font-mono w-5 text-center flex-shrink-0 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-g-muted'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-g-text truncate">{m.displayName}</span>
                    {rolle && <span className={`text-[8px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${rolle.farge}`}>{rolle.navn}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-g-green font-mono">+{m.xp7d} XP</span>
                    {m.streakDays >= 2 && <span className="text-[9px] text-orange-400">🔥 {m.streakDays}d</span>}
                  </div>
                </div>
                <span className="text-[9px] text-g-muted font-mono flex-shrink-0">Lv {m.level}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentLevelUpsWidget({ levelUps }: { levelUps: LevelUp[] }) {
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Nylige Level-ups</p>
      {levelUps.length === 0 ? (
        <p className="text-[10px] text-g-muted py-2">
          Ingen level-ups ennå. Systemet er aktivt — første level-up skjer ved 500 XP.
        </p>
      ) : (
        <div className="space-y-2">
          {levelUps.map((lu, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-g-border/20 last:border-0">
              <span className="text-base flex-shrink-0">⭐</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-g-text">{lu.username || lu.userId.slice(0, 8)}</p>
                <p className="text-[9px] text-g-muted">
                  Level {lu.newLevel}
                  {lu.rolleNavn && <span className="text-g-green"> · {lu.rolleNavn}</span>}
                  {!lu.rolleNavn && <span className="text-g-muted/60"> · ingen rolle</span>}
                </p>
              </div>
              <span className="text-[9px] text-g-muted flex-shrink-0">{tidSiden(lu.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BotActivityWidget({ activity }: { activity: BotEvent[] }) {
  function severityColor(sev: string) {
    if (sev === 'error' || sev === 'critical') return 'text-red-400';
    if (sev === 'warning') return 'text-yellow-400';
    return 'text-g-muted';
  }

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Bot Aktivitet (7d)</p>
      {activity.length === 0 ? (
        <p className="text-[10px] text-g-muted py-2">
          Bot har ikke kjørt community-handlinger ennå. Sjekk at boten er oppe og community-innstillinger er aktive.
        </p>
      ) : (
        <div className="space-y-1.5">
          {activity.map((e, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-g-border/20 last:border-0">
              <span className="text-sm flex-shrink-0 mt-0.5">{ACTIVITY_ICONS[e.eventType] ?? '·'}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] leading-snug truncate ${severityColor(e.severity)}`}>{e.title}</p>
              </div>
              <span className="text-[9px] text-g-muted/60 flex-shrink-0 mt-0.5">{tidSiden(e.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationsWidget({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Anbefalte Tiltak</p>
      <div className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${PRIO_STYLES[r.priority]}`}>
            <span className={`text-[10px] font-bold flex-shrink-0 mt-0.5 ${PRIO_DOT[r.priority]}`}>●</span>
            <p className="text-[11px] leading-snug text-g-text">{r.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardTab({ summary, loading }: { summary: SummaryData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-28 bg-g-card border border-g-border rounded-xl" />
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
        <p className="text-xs text-g-muted">Kunne ikke laste dashboard-data. Sjekk Supabase-tilkobling.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary.recommendations.length > 0 && (
        <RecommendationsWidget recs={summary.recommendations} />
      )}
      <HealthWidget health={summary.health} diagnostics={summary.diagnostics} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopMembersWidget members={summary.topMembers7d} />
        <div className="space-y-4">
          <RecentLevelUpsWidget levelUps={summary.recentLevelUps} />
          <BotActivityWidget activity={summary.botActivity} />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CommunityManagerPage() {
  const [tab, setTab]                     = useState<'dashboard' | 'membres'>('dashboard');
  const [summary, setSummary]             = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [members, setMembers]             = useState<Member[]>([]);
  const [membresLoading, setMembresLoading] = useState(false);
  const [search, setSearch]               = useState('');
  const [sorter, setSorter]               = useState<'xp' | 'engagement' | 'messages' | 'community'>('xp');
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [detail, setDetail]               = useState<MemberDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetch('/api/community-manager/summary')
      .then(r => r.json())
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, []);

  const loadMembres = useCallback(() => {
    if (members.length > 0) return;
    setMembresLoading(true);
    fetch('/api/members')
      .then(r => r.json())
      .then(d => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setMembresLoading(false));
  }, [members.length]);

  useEffect(() => {
    if (tab === 'membres') loadMembres();
  }, [tab, loadMembres]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/members/${id}`);
      setDetail(await res.json());
    } catch {}
    setLoadingDetail(false);
  }, []);

  const selectMember = (id: string) => { setSelectedId(id); loadDetail(id); };

  const handleAction = async (action: string) => {
    if (!selectedId) return;
    await fetch(`/api/members/${selectedId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    await loadDetail(selectedId);
  };

  const handleBack = () => { setSelectedId(null); setDetail(null); };

  // Detail view takes over full page
  if (selectedId) {
    return (
      <div className="max-w-3xl mx-auto">
        <MemberDetailView detail={detail} loading={loadingDetail} onBack={handleBack} onAction={handleAction} />
      </div>
    );
  }

  const sortertFelt: Record<typeof sorter, keyof Member> = {
    xp: 'xp', engagement: 'engagementScore', messages: 'messages', community: 'communityScore',
  };
  const sortert   = [...members].sort((a, b) => (b[sortertFelt[sorter]] as number) - (a[sortertFelt[sorter]] as number));
  const filtrerte = sortert.filter(m =>
    m.displayName.toLowerCase().includes(search.toLowerCase()) ||
    m.username.toLowerCase().includes(search.toLowerCase())
  );
  const topp3 = sortert.slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Manager</h1>
          <p className="text-[10px] text-g-muted mt-0.5">Aktivitet · Helse · Automatisk styring</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/community-settings"
            className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded px-2 py-1 transition-colors">
            ⚙ Innstillinger
          </Link>
          <Link href="/community-intelligence"
            className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded px-2 py-1 transition-colors">
            Intelligence →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-g-border">
        {(['dashboard', 'membres'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all -mb-px ${
              tab === t
                ? 'border-g-green text-g-green'
                : 'border-transparent text-g-muted hover:text-g-text'
            }`}>
            {t === 'dashboard' ? 'Dashboard' : 'Membres'}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {tab === 'dashboard' && <DashboardTab summary={summary} loading={summaryLoading} />}

      {/* Membres tab */}
      {tab === 'membres' && (
        <div className="space-y-4">
          {membresLoading && (
            <div className="bg-g-card border border-g-border rounded-xl p-6 text-center">
              <p className="text-xs text-g-muted animate-pulse">Laster membres...</p>
            </div>
          )}

          {!membresLoading && (
            <>
              {/* Top 3 */}
              {topp3.length > 0 && (
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">
                    Topp 3 — {sorter === 'xp' ? 'XP' : sorter === 'engagement' ? 'Engasjement' : sorter === 'messages' ? 'Chat' : 'Community-score'}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {topp3.map((m, i) => {
                      const rolle = getRolle(m.level);
                      return (
                        <div key={m.id} onClick={() => selectMember(m.id)}
                          className="p-3 bg-g-bg border border-g-border rounded-lg cursor-pointer hover:border-g-green/30 transition-all text-center">
                          <p className={`text-xl font-black font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : 'text-orange-400'}`}>{i + 1}</p>
                          <p className="text-xs font-bold text-g-text mt-1 truncate">{m.displayName}</p>
                          <p className="text-[10px] text-g-green font-mono">
                            {sorter === 'xp' ? `${m.xp.toLocaleString()} XP` :
                             sorter === 'engagement' ? `${m.engagementScore}` :
                             sorter === 'messages' ? `${m.messages} msg` : `${m.communityScore}`}
                          </p>
                          {rolle && <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border mt-1 inline-block ${rolle.farge}`}>{rolle.navn}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search + sort */}
              <div className="flex items-center gap-3">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Søk på navn..." className="flex-1 bg-g-card border border-g-border rounded-lg px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
                <div className="flex gap-1">
                  {(['xp', 'engagement', 'messages', 'community'] as const).map(s => (
                    <button key={s} onClick={() => setSorter(s)}
                      className={`px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all ${
                        sorter === s ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'
                      }`}>
                      {s === 'xp' ? 'XP' : s === 'engagement' ? 'Engage' : s === 'messages' ? 'Chat' : 'Community'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Member list */}
              <div className="bg-g-card border border-g-border rounded-xl">
                {filtrerte.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-xs text-g-muted">Ingen membres funnet.</p>
                  </div>
                ) : (
                  filtrerte.map((m, i) => {
                    const rolle = getRolle(m.level);
                    return (
                      <div key={m.id} onClick={() => selectMember(m.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-g-bg transition-colors ${i < filtrerte.length - 1 ? 'border-b border-g-border/50' : ''}`}>
                        <span className="text-[9px] font-mono text-g-muted/40 w-5 text-right flex-shrink-0">{i + 1}</span>
                        <div className="w-7 h-7 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-black text-g-green">{m.displayName?.[0]?.toUpperCase() ?? '?'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-g-text truncate">{m.displayName}</span>
                            {rolle && <span className={`text-[8px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${rolle.farge}`}>{rolle.navn}</span>}
                          </div>
                          <p className="text-[9px] text-g-muted">Lv {m.level} · sett {tidSiden(m.lastSeen)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[11px] font-mono text-g-green font-bold">{m.xp.toLocaleString()}</p>
                          <p className="text-[8px] text-g-muted">XP</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
