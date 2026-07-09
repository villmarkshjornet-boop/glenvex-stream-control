'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { tidSiden } from '@/components/dashboard/helpers';
import { PageHeader } from '@/components/ui';
import { XP_PER_LEVEL, levelFromXP, xpIntoCurrentLevel, levelProgress } from '@/lib/xp';
import { RARITY_ORDER, RARITY_BADGE_CLASSES, RARITY_GLOW_CLASSES, RARITY_RANK } from '@/lib/rarity';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  id: string; username: string; displayName: string;
  xp: number; level: number; messages: number; reactions: number;
  voiceMinutes: number; streamsAttended: number; subs: number; giftSubs: number;
  raids: number; engagementScore: number; communityScore: number;
  badges: string[]; lastSeen: string; joinedAt: string;
  // Extended (from /api/members/[id])
  discordXp?: number; twitchXp?: number; totalXp?: number;
  coinsBalance?: number; totalCards?: number;
  commonCards?: number; rareCards?: number; epicCards?: number;
  legendaryCards?: number; mythicCards?: number;
  twitchLinked?: boolean; twitchSubStatus?: boolean;
}

interface CardEntry {
  id: string; user_id: string; display_name: string;
  card_type: string; rarity: string; title: string;
  class: string | null; archetype: string | null;
  card_image_url: string | null; card_number: number | null;
  source: string; is_active: boolean; is_tradeable: boolean;
  created_at: string;
}

interface MemberOverview {
  discord_id:               string;
  workspace_id:             string;
  display_name:             string;
  username:                 string;
  nickname:                 string | null;
  top_role:                 string;
  // Unified model
  member_type:              'discord' | 'twitch' | 'linked';
  twitch_id:                string | null;
  twitch_username:          string | null;
  twitch_display_name:      string | null;
  twitch_linked:            boolean;
  discord_xp:               number;
  twitch_xp:                number;
  total_xp:                 number;
  messages_discord:         number;
  messages_twitch:          number;
  last_discord_activity_at: string | null;
  last_twitch_activity_at:  string | null;
  last_seen_stream_at:      string | null;
  // Core
  xp:                    number;
  level:                 number;
  messages:              number;
  voice_minutes:         number;
  streams_attended:      number;
  streak_days:           number;
  coins_balance:         number;
  total_coins_earned:    number;
  total_coins_spent:     number;
  twitch_sub_status:     boolean;
  twitch_sub_tier:       string | null;
  twitch_sub_since:      string | null;
  badges:                string[];
  joined_at:             string | null;
  last_seen:             string | null;
  last_coin_earned_at:   string | null;
  last_activity_at:      string | null;
  total_cards:           number;
  common_cards:          number;
  rare_cards:            number;
  epic_cards:            number;
  legendary_cards:       number;
  mythic_cards:          number;
  active_card_image_url: string | null;
  active_card_title:     string | null;
  active_card_rarity:    string | null;
  active_card_class:     string | null;
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

// ── Constants (XP_PER_LEVEL, RARITY_* imported from @/lib/xp and @/lib/rarity) ─

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

// XP_PER_LEVEL + levelFromXP imported from @/lib/xp — single source of truth.
// NEVER trust the stored level column — always recompute from XP.
const xpToLevel = levelFromXP;

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

function XPBar({ xp }: { xp: number }) {
  const level = levelFromXP(xp);
  const pct   = levelProgress(xp);
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
        <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
          <p className="text-xs text-g-muted animate-pulse">Henter AI-vurdering...</p>
        </div>
      )}

      {!loading && detail && (() => {
        const { member: m, aiProfil, historikk, kontekst } = detail;
        // Recompute level from total XP — never trust stored level.
        const displayXp    = m.totalXp ?? m.xp ?? 0;
        const displayLevel = xpToLevel(displayXp);
        const rolle = getRolle(displayLevel);
        const segs  = getMemberSegments({ ...m, level: displayLevel });
        const trend = TREND_CONFIG[aiProfil.trend];

        return (
          <div className="space-y-4">
            <div className="bg-g-card border border-g-border rounded-2xl p-5">
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
                <XPBar xp={displayXp} />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <StatCell label="Total XP" value={displayXp.toLocaleString()} color="text-g-green" />
              <StatCell label="Meldinger" value={m.messages} />
              <StatCell label="Streams" value={m.streamsAttended} />
              <StatCell label="Level" value={displayLevel} color="text-yellow-400" />
            </div>

            {/* XP-breakdown + kort */}
            {(m.twitchLinked || (m.totalCards ?? 0) > 0) && (
              <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-3">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">XP & Samling</p>
                <div className="grid grid-cols-2 gap-2">
                  <StatCell label="Discord XP" value={(m.discordXp ?? m.xp ?? 0).toLocaleString()} />
                  <StatCell label="Twitch XP" value={(m.twitchXp ?? 0).toLocaleString()} color="text-purple-400" />
                </div>
                {(m.totalCards ?? 0) > 0 && (
                  <div className="grid grid-cols-5 gap-1.5">
                    <StatCell label="⚡ Myt" value={m.mythicCards ?? 0} color="text-red-400" />
                    <StatCell label="✨ Leg" value={m.legendaryCards ?? 0} color="text-yellow-400" />
                    <StatCell label="🔮 Epic" value={m.epicCards ?? 0} color="text-purple-400" />
                    <StatCell label="💎 Rare" value={m.rareCards ?? 0} color="text-blue-400" />
                    <StatCell label="🎴 Com" value={m.commonCards ?? 0} />
                  </div>
                )}
              </div>
            )}

            {aiProfil.aiBeskrivelse && (
              <div className="bg-g-card border border-g-border rounded-2xl p-5">
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

            <div className="bg-g-card border border-g-border rounded-2xl p-5">
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

            <div className="bg-g-card border border-g-border rounded-2xl p-5">
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

            <div className="bg-g-card border border-g-border rounded-2xl p-5">
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
              <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-2">
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
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
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
          <span className="font-black">!</span>
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
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Topp Membres — 7 dager</p>
      {members.length === 0 ? (
        <p className="text-[10px] text-g-muted py-2">
          Ingen XP-aktivitet registrert siste 7 dager. Sjekk at community-kanal er satt og at XP-systemet er aktivt.
        </p>
      ) : (
        <div className="space-y-2">
          {members.map((m, i) => {
            const mLevel = xpToLevel(m.totalXp ?? 0);
            const rolle = getRolle(mLevel);
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
                    {m.streakDays >= 2 && <span className="text-[9px] text-orange-400">▲ {m.streakDays}d</span>}
                  </div>
                </div>
                <span className="text-[9px] text-g-muted font-mono flex-shrink-0">Lv {mLevel}</span>
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
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Nylige Level-ups</p>
      {levelUps.length === 0 ? (
        <p className="text-[10px] text-g-muted py-2">
          Ingen level-ups ennå. Systemet er aktivt — første level-up skjer ved 500 XP.
        </p>
      ) : (
        <div className="space-y-2">
          {levelUps.map((lu, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-g-border/20 last:border-0">
              <span className="text-base flex-shrink-0 text-yellow-400">★</span>
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
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
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
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
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

function KpiCard({ label, value, accent, muted }: { label: string; value: string | number; accent?: boolean; muted?: boolean }) {
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-3 text-center">
      <p className="text-[8px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className={`text-lg font-black font-mono mt-0.5 ${accent ? 'text-g-green' : muted ? 'text-g-muted/50' : 'text-g-text'}`}>{value}</p>
    </div>
  );
}

function ActionCard({ priority, message, actionLabel, onAction }: {
  priority: 'high' | 'medium' | 'low'; type?: string; message: string;
  action?: string; actionLabel?: string; onAction?: () => void;
}) {
  const styles = { high: 'border-red-500/30 bg-red-500/5', medium: 'border-yellow-500/30 bg-yellow-500/5', low: 'border-g-border bg-g-card' };
  const dot = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-g-muted' };
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${styles[priority]}`}>
      <span className={`text-sm flex-shrink-0 ${dot[priority]}`}>●</span>
      <div className="flex-1">
        <p className="text-[11px] text-g-text leading-snug">{message}</p>
      </div>
      {onAction && actionLabel && (
        <button onClick={onAction} className="flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg border border-g-green/30 text-g-green hover:bg-g-green/10 transition-all">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function DashboardTab({ summary, loading, cardStats, setTab }: {
  summary: SummaryData | null; loading: boolean;
  cardStats: { total: number; linkedSubs?: number };
  setTab: (t: 'dashboard' | 'membres' | 'kort' | 'samlekort') => void;
}) {
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
      <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
        <p className="text-xs text-g-muted">Kunne ikke laste dashboard-data. Sjekk Supabase-tilkobling.</p>
      </div>
    );
  }

  const { health, recentLevelUps, botActivity, recommendations } = summary;

  const feedItems = [
    ...recentLevelUps.map(lu => ({
      icon: '⭐', text: `${lu.username || lu.userId.slice(0, 8)} nådde Level ${lu.newLevel}`,
      time: lu.timestamp, color: 'text-yellow-400',
    })),
    ...botActivity.slice(0, 10).map(e => ({
      icon: ACTIVITY_ICONS[e.eventType] ?? '·', text: e.title,
      time: e.timestamp, color: e.severity === 'error' ? 'text-red-400' : 'text-g-muted',
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 15);

  return (
    <div className="space-y-4">
      {/* Hero header */}
      <div className="bg-gradient-to-r from-g-card to-g-bg border border-g-border rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-g-text">Community Manager</h1>
            <p className="text-xs text-g-muted mt-0.5">Workspace · Discord · Bot · Samlekort</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] text-g-green font-bold px-2.5 py-1 rounded-full border border-g-green/30 bg-g-green/5">
              <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
              Bot Online
            </span>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <KpiCard label="Aktive 24t" value={health.activeMembers24h} accent />
        <KpiCard label="Aktive 7d" value={health.activeMembers7d} />
        <KpiCard label="XP 7d" value={health.xpGranted7d.toLocaleString()} />
        <KpiCard label="Level-ups" value={health.levelUps7d} />
        <KpiCard label="Kort totalt" value={cardStats.total} />
        <KpiCard label="Trades" value={0} muted />
        <KpiCard label="Subs koblet" value={cardStats.linkedSubs ?? 0} />
        <KpiCard label="Bot status" value={health.idleStatus === 'active' ? 'Online' : 'Idle'} accent={health.idleStatus === 'active'} />
      </div>

      {/* Action cards */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map((r, i) => (
            <ActionCard key={i} priority={r.priority} type={r.type} message={r.message} />
          ))}
        </div>
      )}

      <HealthWidget health={summary.health} diagnostics={summary.diagnostics} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <TopMembersWidget members={summary.topMembers7d} />
          {/* Activity feed */}
          <div className="bg-g-card border border-g-border rounded-2xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Hva skjer nå</p>
            {feedItems.length === 0 ? (
              <p className="text-[10px] text-g-muted py-2">Ingen aktivitet registrert ennå.</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {feedItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-g-border/20 last:border-0">
                    <span className="text-sm flex-shrink-0 mt-0.5">{item.icon}</span>
                    <p className={`text-[10px] flex-1 leading-snug ${item.color}`}>{item.text}</p>
                    <span className="text-[9px] text-g-muted/50 flex-shrink-0">{tidSiden(item.time)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <RecentLevelUpsWidget levelUps={summary.recentLevelUps} />
          <BotActivityWidget activity={summary.botActivity} />
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/community-settings" className="px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted hover:border-g-green/30 hover:text-g-green rounded-lg transition-all">⚙️ Innstillinger</Link>
          <Link href="/community-intelligence" className="px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted hover:border-g-green/30 hover:text-g-green rounded-lg transition-all">🧠 Intelligence</Link>
          <button onClick={() => setTab('membres')} className="px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted hover:border-g-green/30 hover:text-g-green rounded-lg transition-all">👥 Membres</button>
          <button onClick={() => setTab('kort')} className="px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted hover:border-g-green/30 hover:text-g-green rounded-lg transition-all">🎴 Samlekort</button>
        </div>
      </div>
    </div>
  );
}

// ── Kort Tab (kortsamling) ────────────────────────────────────────────────────

// RARITY_GLOW_CLASSES, RARITY_BADGE_CLASSES, RARITY_ORDER imported from @/lib/rarity

function KortTab() {
  const [cards, setCards]                 = useState<CardEntry[]>([]);
  const [cardsLoading, setCardsLoading]   = useState(true);
  const [cardsError, setCardsError]       = useState<string | null>(null);
  const [cardFilter, setCardFilter]       = useState<'all' | 'active' | 'Mythic' | 'Legendary' | 'Epic' | 'Rare' | 'Common'>('all');
  const [cardSearch, setCardSearch]       = useState('');
  const [cardSort, setCardSort]           = useState<'created_at' | 'rarity' | 'title'>('created_at');
  const [selectedCard, setSelectedCard]   = useState<CardEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CardEntry | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadCards = useCallback(() => {
    setCardsLoading(true);
    setCardsError(null);
    const params = new URLSearchParams({ sort: cardSort });
    if (cardSearch) params.set('search', cardSearch);
    if (cardFilter !== 'all' && cardFilter !== 'active') params.set('rarity', cardFilter);
    if (cardFilter === 'active') params.set('active', 'true');
    fetch(`/api/community-manager/cards?${params}`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(d => { setCards(d.cards ?? []); })
      .catch(e => setCardsError(e.message ?? 'Feil ved lasting'))
      .finally(() => setCardsLoading(false));
  }, [cardSort, cardSearch, cardFilter]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const doCardAction = async (card: CardEntry, action: string) => {
    setActionLoading(card.id);
    try {
      const res = await fetch(`/api/community-manager/cards/${card.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (d.ok) {
        setSelectedCard(null);
        setConfirmDelete(null);
        loadCards();
      } else {
        alert(d.error ?? 'Handling feilet');
      }
    } catch {
      alert('Nettverksfeil');
    }
    setActionLoading(null);
  };

  const sorted = [...cards].sort((a, b) => {
    if (cardSort === 'rarity') return (RARITY_RANK[a.rarity as keyof typeof RARITY_RANK] ?? 99) - (RARITY_RANK[b.rarity as keyof typeof RARITY_RANK] ?? 99);
    if (cardSort === 'title') return a.title.localeCompare(b.title);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'active', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Common'] as const).map(f => (
          <button key={f} onClick={() => setCardFilter(f)}
            className={`px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all ${
              cardFilter === f ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'
            }`}>
            {f === 'all' ? 'Alle' : f === 'active' ? '★ Aktive' : f}
          </button>
        ))}
        <div className="flex-1" />
        <input value={cardSearch} onChange={e => setCardSearch(e.target.value)}
          placeholder="Søk kort eller bruker..."
          className="bg-g-card border border-g-border rounded-lg px-2.5 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50 w-48" />
        <select value={cardSort} onChange={e => setCardSort(e.target.value as 'created_at' | 'rarity' | 'title')}
          className="bg-g-card border border-g-border rounded-lg px-2 py-1.5 text-[10px] text-g-muted outline-none">
          <option value="created_at">Nyeste</option>
          <option value="rarity">Rarity</option>
          <option value="title">Tittel</option>
        </select>
      </div>

      {/* Rarity stats bar */}
      {!cardsLoading && cards.length > 0 && (
        <div className="flex items-center gap-3 text-[10px]">
          {['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'].map(r => {
            const count = cards.filter(c => c.rarity === r).length;
            if (!count) return null;
            return (
              <span key={r} className="text-g-muted">
                {r === 'Mythic' ? '⚡' : r === 'Legendary' ? '✨' : r === 'Epic' ? '🔮' : r === 'Rare' ? '💎' : '🎴'}{' '}
                <span className="font-mono text-g-text">{count}</span>
              </span>
            );
          })}
          <span className="text-g-muted ml-auto">{cards.length} kort totalt</span>
        </div>
      )}

      {/* Loading skeleton */}
      {cardsLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 animate-pulse">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="bg-g-card border border-g-border rounded-xl aspect-[3/4]" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!cardsLoading && cardsError && (
        <div className="bg-g-card border border-red-500/30 rounded-2xl p-8 text-center">
          <p className="text-sm text-red-400 mb-3">⚠️ {cardsError}</p>
          <button onClick={loadCards} className="px-4 py-2 text-xs border border-g-border text-g-muted hover:text-g-text rounded-lg transition-all">
            Prøv igjen
          </button>
        </div>
      )}

      {/* Empty state */}
      {!cardsLoading && !cardsError && sorted.length === 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-12 text-center">
          <p className="text-4xl mb-3">🎴</p>
          <p className="text-sm font-bold text-g-text">Ingen kort ennå</p>
          <p className="text-xs text-g-muted mt-1">Kort genereres når membres bruker /persona kommandoen i Discord.</p>
        </div>
      )}

      {/* Card grid */}
      {!cardsLoading && !cardsError && sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sorted.map(card => (
            <div key={card.id}
              onClick={() => setSelectedCard(card)}
              className={`relative bg-g-card border rounded-xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-all shadow-lg group ${RARITY_GLOW_CLASSES[card.rarity as keyof typeof RARITY_GLOW_CLASSES] ?? 'border-g-border'}`}>
              {/* Card image */}
              <div className="aspect-[3/4] relative">
                {card.card_image_url ? (
                  <img src={card.card_image_url} alt={card.title}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-g-bg flex items-center justify-center">
                    <span className="text-4xl opacity-20">🎴</span>
                  </div>
                )}
                {/* Active badge */}
                {card.is_active && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-g-green rounded-full flex items-center justify-center shadow-lg shadow-g-green/30">
                    <span className="text-[8px] text-black font-black">★</span>
                  </div>
                )}
                {/* Lock badge */}
                {!card.is_tradeable && (
                  <div className="absolute top-1.5 left-1.5 w-4 h-4 bg-gray-800/80 rounded-full flex items-center justify-center">
                    <span className="text-[8px]">🔒</span>
                  </div>
                )}
              </div>
              {/* Card footer */}
              <div className="p-2">
                <p className="text-[10px] font-bold text-g-text truncate leading-tight">{card.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${RARITY_BADGE_CLASSES[card.rarity as keyof typeof RARITY_BADGE_CLASSES] ?? 'text-g-muted border-g-border'}`}>
                    {card.rarity}
                  </span>
                  <span className="text-[8px] text-g-muted truncate ml-1">{card.display_name}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Card detail drawer/modal */}
      {selectedCard && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedCard(null); }}>
          <div className="bg-g-card border border-g-border rounded-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-g-border">
              <h3 className="font-black text-g-text">{selectedCard.title}</h3>
              <button onClick={() => setSelectedCard(null)} className="text-g-muted hover:text-g-text text-lg">×</button>
            </div>
            <div className="p-4 space-y-4">
              {/* Image */}
              {selectedCard.card_image_url && (
                <img src={selectedCard.card_image_url} alt={selectedCard.title}
                  className="w-full max-h-64 object-contain rounded-xl border border-g-border" />
              )}
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-g-bg border border-g-border rounded-lg p-2">
                  <p className="text-g-muted">Eier</p>
                  <p className="text-g-text font-bold">{selectedCard.display_name}</p>
                </div>
                <div className="bg-g-bg border border-g-border rounded-lg p-2">
                  <p className="text-g-muted">Rarity</p>
                  <p className="text-g-text font-bold">{selectedCard.rarity}</p>
                </div>
                <div className="bg-g-bg border border-g-border rounded-lg p-2">
                  <p className="text-g-muted">Kilde</p>
                  <p className="text-g-text font-bold">{selectedCard.source}</p>
                </div>
                <div className="bg-g-bg border border-g-border rounded-lg p-2">
                  <p className="text-g-muted">Generert</p>
                  <p className="text-g-text font-bold">{tidSiden(selectedCard.created_at)}</p>
                </div>
                {selectedCard.class && (
                  <div className="bg-g-bg border border-g-border rounded-lg p-2">
                    <p className="text-g-muted">Class</p>
                    <p className="text-g-text font-bold">{selectedCard.class}</p>
                  </div>
                )}
                {selectedCard.card_number && (
                  <div className="bg-g-bg border border-g-border rounded-lg p-2">
                    <p className="text-g-muted">Kortnr</p>
                    <p className="text-g-text font-bold">#{String(selectedCard.card_number).padStart(3, '0')}</p>
                  </div>
                )}
              </div>
              {/* Status badges */}
              <div className="flex gap-2">
                {selectedCard.is_active && <span className="text-[9px] px-2 py-0.5 rounded-full border border-g-green/30 text-g-green bg-g-green/5 font-bold">★ Aktivt</span>}
                {!selectedCard.is_tradeable && <span className="text-[9px] px-2 py-0.5 rounded-full border border-gray-500/30 text-gray-400 bg-gray-500/5 font-bold">🔒 Låst</span>}
              </div>
              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                {!selectedCard.is_active && (
                  <button onClick={() => doCardAction(selectedCard, 'set_active')}
                    disabled={actionLoading === selectedCard.id}
                    className="px-3 py-2 text-[10px] font-bold border border-g-green/30 text-g-green rounded-lg hover:bg-g-green/10 transition-all disabled:opacity-50">
                    {actionLoading === selectedCard.id ? '...' : '★ Sett aktiv'}
                  </button>
                )}
                {selectedCard.is_tradeable ? (
                  <button onClick={() => doCardAction(selectedCard, 'lock')}
                    disabled={actionLoading === selectedCard.id}
                    className="px-3 py-2 text-[10px] font-bold border border-gray-500/30 text-gray-400 rounded-lg hover:bg-gray-500/10 transition-all disabled:opacity-50">
                    🔒 Lås
                  </button>
                ) : (
                  <button onClick={() => doCardAction(selectedCard, 'unlock')}
                    disabled={actionLoading === selectedCard.id}
                    className="px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted rounded-lg hover:bg-g-green/10 hover:text-g-green transition-all disabled:opacity-50">
                    🔓 Lås opp
                  </button>
                )}
                <button onClick={() => setConfirmDelete(selectedCard)}
                  className="col-span-2 px-3 py-2 text-[10px] font-bold border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 transition-all">
                  🗑 Slett kort
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-g-card border border-red-500/30 rounded-2xl p-6 max-w-sm w-full">
            <p className="text-sm font-black text-g-text mb-2">Slett kort</p>
            <p className="text-xs text-g-muted mb-4">
              Er du sikker på at du vil slette <strong className="text-g-text">{confirmDelete.title}</strong>?
              {confirmDelete.is_active && <span className="text-red-400"> Dette er aktivt kort!</span>}
              {' '}Handlingen kan ikke angres.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 px-3 py-2 text-[10px] font-bold border border-g-border text-g-muted rounded-lg hover:text-g-text transition-all">
                Avbryt
              </button>
              <button onClick={() => doCardAction(confirmDelete, 'delete')}
                disabled={actionLoading === confirmDelete.id}
                className="flex-1 px-3 py-2 text-[10px] font-bold bg-red-500/10 border border-red-500/40 text-red-400 rounded-lg hover:bg-red-500/20 transition-all disabled:opacity-50">
                {actionLoading === confirmDelete.id ? 'Sletter...' : 'Slett'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Samlekort Tab ─────────────────────────────────────────────────────────────

interface PersonaEntry {
  discordId:       string;
  displayName:     string;
  username:        string;
  xp:              number;
  level:           number;
  lastSeen:        string | null;
  hasCard:         boolean;
  rarity:          string | null;
  archetype:       string | null;
  personaTitle:    string | null;
  imageUrl:        string | null;
  rerollCount:     number;
  generatedAt:     string | null;
  lastGeneratedAt: string | null;
}

interface PersonaAdminSettings {
  showcaseAktiv:     boolean;
  twitchVarselAktiv: boolean;
  showcaseKanalId:   string;
  cooldownMinutter:  number;
}

interface CardDropSettings {
  discordCardDropChannelEnabled:      boolean;
  discordCardDropChannelId:           string | null;
  discordCardDropDmEnabled:           boolean;
  twitchCardDropNotificationsEnabled: boolean;
}

// RARITY_BADGE replaced by RARITY_BADGE_CLASSES from @/lib/rarity

// ── Deck types ────────────────────────────────────────────────────────────────

interface DeckCard {
  id: string;
  title: string;
  rarity: string;
  card_type: string;
  card_image_url: string | null;
  card_number: number | null;
  source: string;
  is_active: boolean;
  is_tradeable: boolean;
  created_at: string;
}

interface DeckStats {
  totalCards: number;
  uniqueCards: number;
  duplicates: number;
  highestRarity: string;
  activeCard: { id: string; title: string; rarity: string } | null;
  subCardCount: number;
  lastCardAt: string | null;
}

interface DeckEntry {
  user: {
    id: string;
    displayName: string;
    username: string;
    level: number;
    avatarUrl: string | null;
  };
  stats: DeckStats;
  cards: DeckCard[];
}

// ── DeckUserRow ───────────────────────────────────────────────────────────────

const USER_COLORS = [
  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
];

function userColorClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

function DeckUserRow({ deck, onOpen }: { deck: DeckEntry; onOpen: (d: DeckEntry) => void }) {
  const colorCls = userColorClass(deck.user.id);
  const rarityBadge = RARITY_BADGE_CLASSES[deck.stats.highestRarity as keyof typeof RARITY_BADGE_CLASSES] ?? 'text-g-muted border-g-border';

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-g-bg transition-colors cursor-pointer" onClick={() => onOpen(deck)}>
      <div className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 ${colorCls}`}>
        {deck.user.avatarUrl ? (
          <img src={deck.user.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
        ) : (
          <span className="text-[11px] font-black">{deck.user.displayName[0]?.toUpperCase() ?? '?'}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-g-text truncate">{deck.user.displayName}</span>
          <span className="text-[9px] font-mono text-g-muted/60">Lv {deck.user.level}</span>
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${rarityBadge}`}>
            {deck.stats.highestRarity}
          </span>
          {deck.stats.subCardCount > 0 && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-purple-500/30 text-purple-400 bg-purple-500/5 flex-shrink-0">SUB</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[9px]">
          <span className="text-g-green font-mono">{deck.stats.totalCards} kort</span>
          <span className="text-g-muted">{deck.stats.uniqueCards} unike</span>
          {deck.stats.duplicates > 0 && <span className="text-yellow-400/70">{deck.stats.duplicates} duplikater</span>}
          {deck.stats.activeCard && (
            <span className="text-g-muted/60 truncate max-w-[120px] italic">{deck.stats.activeCard.title}</span>
          )}
          {deck.stats.lastCardAt && (
            <span className="text-g-muted/40 flex-shrink-0">{tidSiden(deck.stats.lastCardAt)}</span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onOpen(deck); }}
        className="flex-shrink-0 px-3 py-1.5 text-[10px] font-bold border border-g-border text-g-muted rounded-lg hover:border-g-green/40 hover:text-g-green transition-all"
      >
        Åpne deck →
      </button>
    </div>
  );
}

// ── DeckDrawer ────────────────────────────────────────────────────────────────

type DrawerFilter = 'alle' | 'aktive' | 'duplikater' | 'låste' | 'sub';

function DeckDrawer({
  deck,
  onClose,
  onRefresh,
}: {
  deck: DeckEntry;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<DrawerFilter>('alle');
  const [rarityFilter, setRarityFilter] = useState('');
  const [drawerSearch, setDrawerSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rerollMsg, setRerollMsg] = useState<Record<string, string>>({});

  const doAction = async (cardId: string, action: string) => {
    setActionLoading(cardId);
    try {
      const res = await fetch(`/api/community-manager/cards/${cardId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (action === 'reroll') {
          setRerollMsg(prev => ({ ...prev, [cardId]: (d.error as string | undefined) ?? 'Reroll er kun tilgjengelig fra Discord-bot' }));
        }
      } else {
        if (confirmDeleteId === cardId) setConfirmDeleteId(null);
        onRefresh();
      }
    } catch {
      if (action === 'reroll') {
        setRerollMsg(prev => ({ ...prev, [cardId]: 'Reroll er kun tilgjengelig fra Discord-bot' }));
      }
    }
    setActionLoading(null);
  };

  const titleCounts = deck.cards.reduce<Record<string, number>>((acc, c) => {
    const key = c.title.toUpperCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const seenTitles = new Set<string>();
  const cardsWithCount = deck.cards.map(c => {
    const key = c.title.toUpperCase();
    const count = titleCounts[key];
    const isFirstOfTitle = !seenTitles.has(key);
    if (isFirstOfTitle) seenTitles.add(key);
    return { ...c, dupCount: count, isFirstOfTitle };
  });

  const visible = cardsWithCount.filter(c => {
    if (filter === 'aktive' && !c.is_active) return false;
    if (filter === 'duplikater' && (titleCounts[c.title.toUpperCase()] ?? 1) <= 1) return false;
    if (filter === 'låste' && c.is_tradeable) return false;
    if (filter === 'sub' && c.card_type !== 'sub') return false;
    if (rarityFilter && c.rarity !== rarityFilter) return false;
    if (drawerSearch) {
      const lc = drawerSearch.toLowerCase();
      if (!c.title.toLowerCase().includes(lc) && !c.source.toLowerCase().includes(lc)) return false;
    }
    return true;
  });

  const rarityBadge = RARITY_BADGE_CLASSES[deck.stats.highestRarity as keyof typeof RARITY_BADGE_CLASSES] ?? 'text-g-muted border-g-border';
  const colorCls = userColorClass(deck.user.id);

  const FILTER_TABS: { key: DrawerFilter; label: string }[] = [
    { key: 'alle',       label: 'Alle' },
    { key: 'aktive',     label: 'Aktive' },
    { key: 'duplikater', label: 'Duplikater' },
    { key: 'låste',      label: 'Låste' },
    { key: 'sub',        label: 'SUB' },
  ];

  const RARITIES = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-2xl bg-g-bg border-l border-g-border flex flex-col h-full overflow-hidden">
        {/* Drawer header */}
        <div className="flex items-start justify-between p-5 border-b border-g-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-full border flex items-center justify-center flex-shrink-0 ${colorCls}`}>
              {deck.user.avatarUrl ? (
                <img src={deck.user.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span className="text-sm font-black">{deck.user.displayName[0]?.toUpperCase() ?? '?'}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-g-text">{deck.user.displayName}</span>
                <span className="text-[9px] font-mono text-g-muted">Lv {deck.user.level}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${rarityBadge}`}>
                  {deck.stats.highestRarity}
                </span>
              </div>
              <p className="text-[9px] text-g-muted mt-0.5">
                {deck.stats.totalCards} kort · {deck.stats.uniqueCards} unike · {deck.stats.duplicates} duplikater
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-g-muted hover:text-g-text text-xl font-bold flex-shrink-0 ml-4">×</button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-g-border flex-shrink-0 flex-wrap">
          {FILTER_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                filter === t.key
                  ? 'border-g-green/40 text-g-green bg-g-green/10'
                  : 'border-g-border text-g-muted hover:text-g-text'
              }`}
            >
              {t.label}
            </button>
          ))}
          <select
            value={rarityFilter}
            onChange={e => setRarityFilter(e.target.value)}
            className="text-[10px] bg-g-card border border-g-border rounded-lg px-2 py-1 text-g-muted outline-none focus:border-g-green/50"
          >
            <option value="">Alle sjeldenheter</option>
            {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            value={drawerSearch}
            onChange={e => setDrawerSearch(e.target.value)}
            placeholder="Søk kort..."
            className="flex-1 min-w-[100px] bg-g-card border border-g-border rounded-lg px-2.5 py-1 text-[10px] text-g-text outline-none focus:border-g-green/50"
          />
        </div>

        {/* Card grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-xs text-g-muted">Ingen kort i denne samlingen ennå.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {visible.map(card => {
                const glowCls = RARITY_GLOW_CLASSES[card.rarity as keyof typeof RARITY_GLOW_CLASSES] ?? 'border-g-border';
                const badgeCls = RARITY_BADGE_CLASSES[card.rarity as keyof typeof RARITY_BADGE_CLASSES] ?? 'text-g-muted border-g-border';
                const isConfirmingDelete = confirmDeleteId === card.id;
                const isLoading = actionLoading === card.id;
                const msg = rerollMsg[card.id];

                return (
                  <div
                    key={card.id}
                    className={`group relative bg-g-card border rounded-xl overflow-hidden flex flex-col shadow-sm ${glowCls}`}
                  >
                    {/* Image area */}
                    <div className="relative aspect-[3/4] bg-g-bg flex-shrink-0">
                      {card.card_image_url ? (
                        <img
                          src={card.card_image_url}
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${colorCls}`}>
                          <span className="text-2xl font-black opacity-60">{card.title[0]?.toUpperCase() ?? '?'}</span>
                        </div>
                      )}

                      {/* Overlay badges */}
                      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                        {card.is_active && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-g-green text-black">AKTIV</span>
                        )}
                        {!card.is_tradeable && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/80 text-black">LÅST</span>
                        )}
                        {card.card_type === 'sub' && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/80 text-white">SUB</span>
                        )}
                      </div>

                      {card.isFirstOfTitle && card.dupCount > 1 && (
                        <div className="absolute top-1.5 right-1.5">
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-black/70 text-g-text border border-g-border">
                            x{card.dupCount}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Card info */}
                    <div className="p-2 flex flex-col gap-1.5 flex-1">
                      <p className="text-[10px] font-bold text-g-text leading-tight truncate" title={card.title}>
                        {card.title}
                      </p>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${badgeCls}`}>{card.rarity}</span>
                        <span className="text-[8px] text-g-muted/50 capitalize">{card.source}</span>
                      </div>
                      <p className="text-[8px] text-g-muted/40 font-mono truncate" title={card.id}>{card.id.slice(0, 12)}…</p>
                      <p className="text-[8px] text-g-muted/40">{tidSiden(card.created_at)}</p>

                      {msg && (
                        <p className="text-[8px] text-yellow-400 leading-tight">{msg}</p>
                      )}

                      {/* Actions */}
                      {isConfirmingDelete ? (
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="flex-1 text-[8px] py-1 rounded border border-g-border text-g-muted hover:text-g-text transition-all"
                          >
                            Avbryt
                          </button>
                          <button
                            onClick={() => doAction(card.id, 'delete')}
                            disabled={isLoading}
                            className="flex-1 text-[8px] py-1 rounded border border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-50"
                          >
                            {isLoading ? '...' : 'Slett'}
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-1 mt-1">
                          <button
                            onClick={() => doAction(card.id, 'set_active')}
                            disabled={isLoading || card.is_active || card.card_type !== 'persona'}
                            title="Sett aktiv"
                            className="text-[9px] py-1 rounded border border-g-green/30 text-g-green hover:bg-g-green/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ★
                          </button>
                          <button
                            onClick={() => doAction(card.id, card.is_tradeable ? 'lock' : 'unlock')}
                            disabled={isLoading}
                            title={card.is_tradeable ? 'Lås' : 'Lås opp'}
                            className="text-[9px] py-1 rounded border border-g-border text-g-muted hover:text-g-text transition-all disabled:opacity-30"
                          >
                            {card.is_tradeable ? '🔒' : '🔓'}
                          </button>
                          <button
                            onClick={() => {
                              setRerollMsg(prev => { const n = { ...prev }; delete n[card.id]; return n; });
                              doAction(card.id, 'reroll');
                            }}
                            disabled={isLoading}
                            title="Reroll"
                            className="text-[9px] py-1 rounded border border-g-border text-g-muted hover:text-g-text transition-all disabled:opacity-30"
                          >
                            🔁
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(card.id)}
                            disabled={isLoading}
                            title="Slett"
                            className="text-[9px] py-1 rounded border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all disabled:opacity-30"
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SettingsTab ───────────────────────────────────────────────────────────────

function SettingsTab() {
  const [settings, setSettings]     = useState<PersonaAdminSettings>({
    showcaseAktiv: false, twitchVarselAktiv: false, showcaseKanalId: '', cooldownMinutter: 60,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [cardDropSettings, setCardDropSettings] = useState<CardDropSettings>({
    discordCardDropChannelEnabled: false, discordCardDropChannelId: null,
    discordCardDropDmEnabled: true, twitchCardDropNotificationsEnabled: false,
  });
  const [cardDropSaving, setCardDropSaving] = useState(false);

  useEffect(() => {
    fetch('/api/community-manager/personas/settings')
      .then(r => r.json())
      .then(d => { if (d.settings) setSettings(d.settings as PersonaAdminSettings); })
      .catch(() => {});
    fetch('/api/community-manager/card-settings')
      .then(r => r.json())
      .then(d => { if (d.settings) setCardDropSettings(d.settings as CardDropSettings); })
      .catch(() => {});
  }, []);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await fetch('/api/community-manager/personas/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch {}
    setSettingsSaving(false);
  };

  const saveCardDropSettings = async () => {
    setCardDropSaving(true);
    try {
      await fetch('/api/community-manager/card-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardDropSettings),
      });
    } catch {}
    setCardDropSaving(false);
  };

  return (
    <div className="px-5 pb-5 space-y-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold pt-4">Samlekort-innstillinger</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-g-text">Discord Showcase</p>
            <button
              onClick={() => setSettings(s => ({ ...s, showcaseAktiv: !s.showcaseAktiv }))}
              className={`w-9 h-5 rounded-full border transition-all relative ${
                settings.showcaseAktiv ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'
              }`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                settings.showcaseAktiv ? 'left-4 bg-g-green' : 'left-0.5 bg-g-muted/40'
              }`} />
            </button>
          </div>
          <p className="text-[9px] text-g-muted">Post kortet til Discord-kanal etter generering</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-g-text">Twitch-varsel</p>
            <button
              onClick={() => setSettings(s => ({ ...s, twitchVarselAktiv: !s.twitchVarselAktiv }))}
              className={`w-9 h-5 rounded-full border transition-all relative ${
                settings.twitchVarselAktiv ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'
              }`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                settings.twitchVarselAktiv ? 'left-4 bg-g-green' : 'left-0.5 bg-g-muted/40'
              }`} />
            </button>
          </div>
          <p className="text-[9px] text-g-muted">Send Twitch-chat-melding (kommer snart)</p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-bold text-g-text">Showcase-kanal ID</p>
          <input
            value={settings.showcaseKanalId}
            onChange={e => setSettings(s => ({ ...s, showcaseKanalId: e.target.value }))}
            placeholder="Discord kanal-ID (f.eks. 1234567890)"
            className="w-full bg-g-bg border border-g-border rounded-lg px-2.5 py-1.5 text-[11px] text-g-text outline-none focus:border-g-green/50 font-mono"
          />
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-bold text-g-text">Cooldown (minutter)</p>
          <input
            type="number"
            min={0}
            max={10080}
            value={settings.cooldownMinutter}
            onChange={e => setSettings(s => ({ ...s, cooldownMinutter: Number(e.target.value) }))}
            className="w-full bg-g-bg border border-g-border rounded-lg px-2.5 py-1.5 text-[11px] text-g-text outline-none focus:border-g-green/50 font-mono"
          />
          <p className="text-[9px] text-g-muted">Minimum tid mellom genereringer per member</p>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={settingsSaving}
        className="px-4 py-2 text-[10px] font-bold bg-g-green/10 border border-g-green/30 text-g-green rounded-lg hover:bg-g-green/20 transition-all disabled:opacity-50"
      >
        {settingsSaving ? 'Lagrer...' : 'Lagre innstillinger'}
      </button>

      <div className="border-t border-g-border/50 pt-4 space-y-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Kortkanal — Card Drops</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-g-text">Post nye kort i Discord-kanal</p>
              <button
                onClick={() => setCardDropSettings(s => ({ ...s, discordCardDropChannelEnabled: !s.discordCardDropChannelEnabled }))}
                className={`w-9 h-5 rounded-full border transition-all relative ${
                  cardDropSettings.discordCardDropChannelEnabled ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                  cardDropSettings.discordCardDropChannelEnabled ? 'left-4 bg-g-green' : 'left-0.5 bg-g-muted/40'
                }`} />
              </button>
            </div>
            <p className="text-[9px] text-g-muted">Poster kortbildet i valgt kanal etter generering</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-g-text">Send kort på DM til brukeren</p>
              <button
                onClick={() => setCardDropSettings(s => ({ ...s, discordCardDropDmEnabled: !s.discordCardDropDmEnabled }))}
                className={`w-9 h-5 rounded-full border transition-all relative ${
                  cardDropSettings.discordCardDropDmEnabled ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                  cardDropSettings.discordCardDropDmEnabled ? 'left-4 bg-g-green' : 'left-0.5 bg-g-muted/40'
                }`} />
              </button>
            </div>
            <p className="text-[9px] text-g-muted">
              {cardDropSettings.discordCardDropDmEnabled
                ? 'Brukere mottar kortet privat'
                : 'Brukere får ikke kortet tilsendt privat'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-bold text-g-text">Discord kortkanal-ID</p>
            <input
              value={cardDropSettings.discordCardDropChannelId ?? ''}
              onChange={e => setCardDropSettings(s => ({ ...s, discordCardDropChannelId: e.target.value || null }))}
              placeholder="Kanal-ID (f.eks. 1234567890)"
              className="w-full bg-g-bg border border-g-border rounded-lg px-2.5 py-1.5 text-[11px] text-g-text outline-none focus:border-g-green/50 font-mono"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-g-text">Varsle Twitch-chat ved korttrekk</p>
              <button
                onClick={() => setCardDropSettings(s => ({ ...s, twitchCardDropNotificationsEnabled: !s.twitchCardDropNotificationsEnabled }))}
                className={`w-9 h-5 rounded-full border transition-all relative ${
                  cardDropSettings.twitchCardDropNotificationsEnabled ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                  cardDropSettings.twitchCardDropNotificationsEnabled ? 'left-4 bg-g-green' : 'left-0.5 bg-g-muted/40'
                }`} />
              </button>
            </div>
            <p className="text-[9px] text-g-muted">Sender melding i Twitch-chat når noen får nytt kort</p>
          </div>
        </div>

        {cardDropSettings.discordCardDropChannelEnabled && !cardDropSettings.discordCardDropChannelId && (
          <p className="text-[9px] text-yellow-400">Ingen kortkanal valgt — nye kort blir ikke postet offentlig.</p>
        )}

        <button
          onClick={saveCardDropSettings}
          disabled={cardDropSaving}
          className="px-4 py-2 text-[10px] font-bold bg-g-green/10 border border-g-green/30 text-g-green rounded-lg hover:bg-g-green/20 transition-all disabled:opacity-50"
        >
          {cardDropSaving ? 'Lagrer...' : 'Lagre kortkanal'}
        </button>
      </div>

      <SubCardImageBackfill />
    </div>
  );
}

function SubCardImageBackfill() {
  const [status, setStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = React.useState<string | null>(null);

  async function run() {
    setStatus('running');
    setResult(null);
    try {
      const res  = await fetch('/api/cards/sub-images/backfill', { method: 'POST' });
      const data = await res.json() as { ok?: boolean; updated?: number; failed?: number; total?: number; message?: string; error?: string };
      if (data.ok) {
        setResult(data.message ?? `✅ ${data.updated} kort oppdatert${data.failed ? `, ${data.failed} feilet` : ''} (av ${data.total} totalt)`);
        setStatus('done');
      } else {
        setResult(`❌ ${data.error ?? 'Ukjent feil'}`);
        setStatus('error');
      }
    } catch (e: any) {
      setResult(`❌ ${(e as Error)?.message ?? 'Nettverksfeil'}`);
      setStatus('error');
    }
  }

  return (
    <div className="mt-4 p-3 bg-g-bg border border-g-border rounded-lg space-y-2">
      <p className="text-[11px] font-bold text-g-text">Sub-kort bilder</p>
      <p className="text-[10px] text-g-muted">Generer manglende kortbilder for alle Twitch Sub-kort.</p>
      <button
        onClick={run}
        disabled={status === 'running'}
        className="px-4 py-2 text-[10px] font-bold bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/20 transition-all disabled:opacity-50"
      >
        {status === 'running' ? 'Genererer...' : 'Generer sub-kort bilder'}
      </button>
      {result && <p className="text-[10px] text-g-muted">{result}</p>}
    </div>
  );
}

// ── SamlekortTab ──────────────────────────────────────────────────────────────

function SamlekortTab() {
  const [decks, setDecks]               = useState<DeckEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [selectedDeck, setSelectedDeck] = useState<DeckEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadDecks = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/community-manager/decks')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error as string);
        setDecks((d.decks ?? []) as DeckEntry[]);
      })
      .catch(() => setError('Nettverksfeil'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  const handleDeckRefresh = () => {
    loadDecks();
    if (selectedDeck) {
      fetch('/api/community-manager/decks')
        .then(r => r.json())
        .then(d => {
          const updated = ((d.decks ?? []) as DeckEntry[]).find(dk => dk.user.id === selectedDeck.user.id);
          if (updated) setSelectedDeck(updated);
        })
        .catch(() => {});
    }
  };

  const totalCards = decks.reduce((s, d) => s + d.stats.totalCards, 0);
  const filtered   = decks.filter(d =>
    !search ||
    d.user.displayName.toLowerCase().includes(search.toLowerCase()) ||
    d.user.username.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Innstillinger (collapsible — renders SettingsTab when open) */}
      <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Innstillinger</span>
          <span className={`text-[10px] text-g-muted transition-transform ${settingsOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {settingsOpen && <div className="border-t border-g-border/50"><SettingsTab /></div>}
      </div>

      {/* Deck list header */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9px] text-g-muted">
          <span className="text-g-green font-mono font-bold">{decks.length}</span> brukere ·{' '}
          <span className="text-g-green font-mono font-bold">{totalCards}</span> kort totalt
        </p>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Søk bruker..."
            className="bg-g-card border border-g-border rounded-lg px-2.5 py-1 text-xs text-g-text outline-none focus:border-g-green/50 w-36"
          />
          <button
            onClick={loadDecks}
            className="text-[10px] px-2.5 py-1 rounded-lg border border-g-border text-g-muted hover:text-g-text transition-all"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Deck list */}
      {loading ? (
        <div className="bg-g-card border border-g-border rounded-xl overflow-hidden space-y-0">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-14 bg-g-card border-b border-g-border/40 animate-pulse last:border-b-0" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
          <p className="text-xs text-g-muted">Ingen samlekort funnet.</p>
        </div>
      ) : (
        <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
          {filtered.map((deck, i) => (
            <div key={deck.user.id} className={i < filtered.length - 1 ? 'border-b border-g-border/50' : ''}>
              <DeckUserRow deck={deck} onOpen={setSelectedDeck} />
            </div>
          ))}
        </div>
      )}

      {selectedDeck && (
        <DeckDrawer
          deck={selectedDeck}
          onClose={() => setSelectedDeck(null)}
          onRefresh={handleDeckRefresh}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CommunityManagerPage() {
  const [tab, setTab]                     = useState<'dashboard' | 'membres' | 'kort' | 'samlekort'>('dashboard');
  const [summary, setSummary]             = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [cardStats, setCardStats]         = useState<{ total: number; linkedSubs?: number }>({ total: 0 });
  const [members, setMembers]             = useState<MemberOverview[]>([]);
  const [membresLoading, setMembresLoading] = useState(false);
  const [search, setSearch]               = useState('');
  const [sorter, setSorter]               = useState<'xp' | 'coins' | 'activity' | 'level' | 'cards'>('xp');
  const [filterSub, setFilterSub]         = useState(false);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [detail, setDetail]               = useState<MemberDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetch('/api/community-manager/summary')
      .then(r => r.json())
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
    // Card KPIs for dashboard strip
    fetch('/api/community-manager/cards')
      .then(r => r.ok ? r.json() : { cards: [], total: 0 })
      .then(d => {
        const cards = (d.cards ?? []) as CardEntry[];
        const linkedSubs = cards.filter(c => c.card_type === 'sub' || c.source === 'twitch_sub').length;
        setCardStats({ total: d.total ?? cards.length, linkedSubs });
      })
      .catch(() => {});
  }, []);

  const loadMembres = useCallback(() => {
    setMembresLoading(true);
    const params = new URLSearchParams({ sort: sorter });
    if (filterSub) params.set('sub', 'true');
    fetch(`/api/community-manager/members?${params}`)
      .then(r => r.json())
      .then(d => setMembers(d.members ?? []))
      .catch(() => {})
      .finally(() => setMembresLoading(false));
  }, [sorter, filterSub]);

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

  const filtrerte = members.filter(m =>
    !search ||
    (m.display_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (m.username     ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (m.nickname     ?? '').toLowerCase().includes(search.toLowerCase()),
  );
  const topp3 = members.slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="Community Manager" subtitle="Aktivitet · Helse · Automatisk styring">
        <div className="flex items-center gap-2">
          <Link href="/community-settings"
            className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded-lg px-2 py-1 transition-colors">
            Innstillinger
          </Link>
          <Link href="/community-intelligence"
            className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded-lg px-2 py-1 transition-colors">
            Intelligence →
          </Link>
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-g-border">
        {(['dashboard', 'membres', 'kort', 'samlekort'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all -mb-px ${
              tab === t
                ? 'border-g-green text-g-green'
                : 'border-transparent text-g-muted hover:text-g-text'
            }`}>
            {t === 'dashboard' ? 'Dashboard' : t === 'membres' ? 'Membres' : t === 'kort' ? 'Kort' : 'Samlekort'}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {tab === 'dashboard' && <DashboardTab summary={summary} loading={summaryLoading} cardStats={cardStats} setTab={setTab} />}

      {/* Kort tab */}
      {tab === 'kort' && <KortTab />}

      {/* Samlekort tab */}
      {tab === 'samlekort' && <SamlekortTab />}

      {/* Membres tab */}
      {tab === 'membres' && (
        <div className="space-y-4">
          {membresLoading && (
            <div className="bg-g-card border border-g-border rounded-2xl p-6 text-center">
              <p className="text-xs text-g-muted animate-pulse">Laster membres...</p>
            </div>
          )}

          {!membresLoading && (
            <>
              {/* Top 3 */}
              {topp3.length > 0 && (
                <div className="bg-g-card border border-g-border rounded-2xl p-5">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">
                    Topp 3 — {sorter === 'xp' ? 'XP' : sorter === 'coins' ? 'Coins' : sorter === 'activity' ? 'Aktivitet' : sorter === 'cards' ? 'Kort' : 'Level'}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {topp3.map((m, i) => {
                      const mLevel   = xpToLevel(m.discord_xp ?? m.xp ?? 0);
                      const rolle    = getRolle(mLevel);
                      const valLabel =
                        sorter === 'xp'       ? `${m.xp.toLocaleString()} XP` :
                        sorter === 'coins'    ? `${m.coins_balance} coins` :
                        sorter === 'activity' ? tidSiden(m.last_activity_at ?? m.last_seen ?? '') :
                        sorter === 'cards'    ? `${m.total_cards} kort` :
                                                `Lv ${mLevel}`;
                      return (
                        <div key={m.discord_id} onClick={() => selectMember(m.discord_id)}
                          className="p-3 bg-g-bg border border-g-border rounded-lg cursor-pointer hover:border-g-green/30 transition-all text-center">
                          <p className={`text-xl font-black font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : 'text-orange-400'}`}>{i + 1}</p>
                          <p className="text-xs font-bold text-g-text mt-1 truncate">{m.display_name}</p>
                          <p className="text-[10px] text-g-green font-mono">{valLabel}</p>
                          {rolle && <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border mt-1 inline-block ${rolle.farge}`}>{rolle.navn}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search + filter + sort */}
              <div className="flex items-center gap-2 flex-wrap">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Søk på navn..." className="flex-1 min-w-[160px] bg-g-card border border-g-border rounded-lg px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
                <button
                  onClick={() => setFilterSub(f => !f)}
                  className={`px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all flex-shrink-0 ${
                    filterSub
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                      : 'border-g-border text-g-muted hover:text-g-text'
                  }`}
                >
                  {filterSub ? '● Kun SUB' : '○ SUB'}
                </button>
                <div className="flex gap-1 flex-shrink-0">
                  {(['xp', 'coins', 'activity', 'level', 'cards'] as const).map(s => (
                    <button key={s} onClick={() => setSorter(s)}
                      className={`px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all ${
                        sorter === s ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'
                      }`}>
                      {s === 'xp' ? 'XP' : s === 'coins' ? 'Coins' : s === 'activity' ? 'Aktivitet' : s === 'level' ? 'Level' : 'Kort'}
                    </button>
                  ))}
                </div>
                <button onClick={loadMembres}
                  className="px-2.5 py-1.5 rounded text-[10px] border border-g-border text-g-muted hover:text-g-text transition-all flex-shrink-0"
                  title="Oppdater">
                  ↻
                </button>
              </div>

              {/* Member list */}
              <div className="bg-g-card border border-g-border rounded-xl">
                {filtrerte.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-xs text-g-muted">Ingen membres funnet.</p>
                  </div>
                ) : (
                  filtrerte.map((m, i) => {
                    const mLevel = xpToLevel(m.discord_xp ?? m.xp ?? 0);
                    const rolle = getRolle(mLevel);
                    const topRarityEmoji =
                      m.mythic_cards    > 0 ? '⚡' :
                      m.legendary_cards > 0 ? '✨' :
                      m.epic_cards      > 0 ? '🔮' :
                      m.rare_cards      > 0 ? '💎' :
                      m.total_cards     > 0 ? '🎴' : null;
                    const platformBadge =
                      m.member_type === 'linked'  ? { label: '🔗 Koblet',  cls: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' } :
                      m.member_type === 'twitch'  ? { label: '📺 Twitch',  cls: 'border-purple-500/30 text-purple-400 bg-purple-500/5' } :
                      m.twitch_linked             ? { label: '🔗 Koblet',  cls: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' } :
                      null;
                    return (
                      <div key={m.discord_id} onClick={() => selectMember(m.discord_id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-g-bg transition-colors ${i < filtrerte.length - 1 ? 'border-b border-g-border/50' : ''}`}>
                        <span className="text-[9px] font-mono text-g-muted/40 w-5 text-right flex-shrink-0">{i + 1}</span>
                        <div className="w-7 h-7 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-black text-g-green">{m.display_name?.[0]?.toUpperCase() ?? '?'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-g-text truncate">{m.display_name}</span>
                            {m.twitch_sub_status && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-purple-500/40 text-purple-400 bg-purple-500/5 flex-shrink-0">SUB</span>
                            )}
                            {platformBadge && (
                              <span className={`text-[8px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${platformBadge.cls}`}>{platformBadge.label}</span>
                            )}
                            {m.top_role !== 'MEMBER' && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-g-border text-g-muted flex-shrink-0">{m.top_role}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[9px]">
                            {rolle && <span className={`font-bold flex-shrink-0 ${rolle.farge.split(' ')[0]}`}>{rolle.navn}</span>}
                            <span className="text-g-muted font-mono">Lv {mLevel}</span>
                            {m.member_type === 'linked' ? (
                              <span className="text-g-green font-mono" title={`Discord: ${m.discord_xp} · Twitch: ${m.twitch_xp}`}>
                                {m.total_xp.toLocaleString()} XP
                              </span>
                            ) : (
                              <span className="text-g-green font-mono">{m.xp.toLocaleString()} XP</span>
                            )}
                            <span className="text-yellow-400/80 font-mono">💰{m.coins_balance}</span>
                            {topRarityEmoji && <span className="text-g-muted">{topRarityEmoji} {m.total_cards}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[9px] text-g-muted">{tidSiden(m.last_activity_at ?? m.last_seen ?? '')}</p>
                          {m.active_card_title && (
                            <p className="text-[8px] text-g-muted/50 truncate max-w-[80px]">{m.active_card_title}</p>
                          )}
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
