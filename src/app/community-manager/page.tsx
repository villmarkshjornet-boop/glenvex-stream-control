'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRolle(level: number) { return LEVEL_ROLLER.find(r => level >= r.level) ?? null; }

function tidSiden(iso: string): string {
  if (!iso) return '—';
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60) return 'nå';
  if (sek < 3600) return `${Math.floor(sek / 60)}m`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t`;
  return `${Math.floor(sek / 86400)}d siden`;
}

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

// ── Sub-components ────────────────────────────────────────────────────────────

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
  const btn = (
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
  return btn;
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

// ── Main Detail View ──────────────────────────────────────────────────────────

function MemberDetailView({
  detail,
  loading,
  onBack,
  onAction,
}: {
  detail: MemberDetail | null;
  loading: boolean;
  onBack: () => void;
  onAction: (action: string) => Promise<void>;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    await onAction(action);
    setActionLoading(null);
  };

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-[10px] text-g-muted hover:text-g-text transition-colors">
          ← Tilbake til liste
        </button>
        {detail && (
          <a
            href={`https://discord.com/users/${detail.member.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-g-muted hover:text-[#5865F2] border border-g-border hover:border-[#5865F2]/40 rounded px-2 py-1 transition-colors"
          >
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
        const { member: m, aiProfil, historikk, kontekst, isFollowUp } = detail;
        const rolle = getRolle(m.level);
        const segs = getMemberSegments(m);
        const trend = TREND_CONFIG[aiProfil.trend];
        const harHeroBadge = m.badges.includes('Community Hero');

        return (
          <div className="space-y-4">
            {/* ── Header ────────────────────────────────────────────────── */}
            <div className="bg-g-card border border-g-border rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl font-black text-g-green">
                    {m.displayName?.[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-black text-g-text">{m.displayName}</h2>
                  <p className="text-[10px] text-g-muted">@{m.username}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {rolle && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${rolle.farge}`}>{rolle.navn}</span>
                    )}
                    {segs.map(s => (
                      <span key={s.navn} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${s.farge}`}>{s.navn}</span>
                    ))}
                    {isFollowUp && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full border text-orange-400 border-orange-400/30">Oppfølging</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-[9px] text-g-muted flex-shrink-0">
                  <p>Sist sett: <span className="text-g-text">{tidSiden(m.lastSeen)}</span></p>
                  {m.joinedAt && <p>Joined: <span className="text-g-text">{new Date(m.joinedAt).toLocaleDateString('no-NO')}</span></p>}
                </div>
              </div>
              <div className="mt-3">
                <XPBar xp={m.xp} level={m.level} />
              </div>
            </div>

            {/* ── AI Profil ─────────────────────────────────────────────── */}
            <div className="bg-g-card border border-g-green/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">◈ AI Profil</p>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold ${trend.farge}`}>{trend.ikon} {trend.label}</span>
                  {aiProfil.atRisk && <span className="text-[9px] font-bold text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">⚠ At Risk</span>}
                  {aiProfil.erHero && <span className="text-[9px] font-bold text-yellow-400 border border-yellow-400/30 px-1.5 py-0.5 rounded">★ Hero</span>}
                </div>
              </div>

              {/* Viktighetsmåler */}
              <div>
                <div className="flex justify-between text-[9px] mb-1">
                  <span className="text-g-muted">Viktighet for communityet</span>
                  <span className="font-mono text-g-green font-bold">{aiProfil.viktighetScore}/100</span>
                </div>
                <div className="w-full h-2 bg-g-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${aiProfil.viktighetScore >= 70 ? 'bg-g-green' : aiProfil.viktighetScore >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`}
                    style={{ width: `${aiProfil.viktighetScore}%` }}
                  />
                </div>
              </div>

              {aiProfil.punkter.length > 0 && (
                <ul className="space-y-1">
                  {aiProfil.punkter.map((p, i) => (
                    <li key={i} className="text-[10px] text-g-muted flex gap-2">
                      <span className="text-g-green flex-shrink-0">·</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}

              {aiProfil.aiBeskrivelse && (
                <p className="text-xs text-g-text leading-relaxed border-t border-g-border/40 pt-3">
                  {aiProfil.aiBeskrivelse}
                </p>
              )}
            </div>

            {/* ── Statistikk ────────────────────────────────────────────── */}
            <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Statistikk</p>
              <div className="grid grid-cols-4 gap-2">
                <StatCell label="XP"       value={m.xp.toLocaleString()}      color="text-g-green" />
                <StatCell label="Level"    value={m.level}                     color="text-g-green" />
                <StatCell label="Engage"   value={m.engagementScore}           color="text-blue-400" />
                <StatCell label="Community" value={m.communityScore}           color="text-purple-400" />
              </div>
              <div className="space-y-1.5">
                {[
                  { label: 'Meldinger',       val: m.messages,       max: 500,  color: 'bg-g-green' },
                  { label: 'Reactions',        val: m.reactions,      max: 200,  color: 'bg-blue-400' },
                  { label: 'Voice (minutter)', val: m.voiceMinutes,   max: 300,  color: 'bg-purple-400' },
                  { label: 'Streams attended', val: m.streamsAttended, max: 20,  color: 'bg-orange-400' },
                ].map(({ label, val, max, color }) => (
                  <div key={label} className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <p className="text-[9px] text-g-muted">{label}</p>
                    <ScoreBar val={val} max={max} color={color} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                {[['Subs', m.subs], ['Gift subs', m.giftSubs], ['Raids', m.raids]].map(([l, v]) => (
                  <div key={l as string} className="flex-1 text-center px-3 py-2 bg-g-bg border border-g-border rounded-lg">
                    <p className="text-[8px] text-g-muted uppercase">{l}</p>
                    <p className="text-sm font-black text-g-green font-mono">{v}</p>
                  </div>
                ))}
              </div>
              {m.badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {m.badges.map(b => (
                    <span key={b} className="px-2 py-0.5 bg-g-bg border border-g-border rounded text-[9px] text-g-text">{b}</span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Handlinger ────────────────────────────────────────────── */}
            <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Handlinger</p>
              <div className="flex flex-wrap gap-2">
                <ActionBtn
                  icon="📋"
                  label={isFollowUp ? 'På oppfølgingsliste' : 'Legg til oppfølging'}
                  active={isFollowUp}
                  onClick={() => handleAction(isFollowUp ? 'follow_up_remove' : 'follow_up_add')}
                />
                <ActionBtn
                  icon="★"
                  label={harHeroBadge ? 'Fjern Hero-badge' : 'Marker Community Hero'}
                  active={harHeroBadge}
                  danger={harHeroBadge}
                  onClick={() => handleAction(harHeroBadge ? 'hero_badge_remove' : 'hero_badge_add')}
                />
                <ActionBtn
                  icon="💜"
                  label="Gi Discord VIP"
                  disabled
                  disabledReason="Krever Discord bot-integrasjon"
                />
                <ActionBtn
                  icon="🚫"
                  label="Fjern Discord VIP"
                  disabled
                  disabledReason="Krever Discord bot-integrasjon"
                />
                <ActionBtn
                  icon="🏷"
                  label="Vis Discord-roller"
                  disabled
                  disabledReason="Krever Discord bot-integrasjon"
                />
              </div>
              {actionLoading && (
                <p className="text-[9px] text-g-muted animate-pulse">Lagrer...</p>
              )}
            </div>

            {/* ── Historikk ─────────────────────────────────────────────── */}
            <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Aktivitetshistorikk</p>
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <ActivityBand label="Siste 7 dager"  aktiv={historikk.aktiv7d} />
                  <ActivityBand label="Siste 30 dager" aktiv={historikk.aktiv30d} />
                  <ActivityBand label="Siste 90 dager" aktiv={historikk.aktiv90d} />
                </div>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-g-muted">Snitt meldinger/dag</span>
                    <span className="font-mono text-g-text">{historikk.snitMeldingerPerDag}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Snitt streams/uke</span>
                    <span className="font-mono text-g-text">{historikk.snitStreamsPerUke}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Inaktiv dager</span>
                    <span className={`font-mono font-bold ${historikk.daysSinceLastSeen > 14 ? 'text-red-400' : 'text-g-text'}`}>
                      {historikk.daysSinceLastSeen}d
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Membre i</span>
                    <span className="font-mono text-g-text">{historikk.daysSinceJoined}d</span>
                  </div>
                </div>
              </div>
              <p className="text-[8px] text-g-muted/60 pt-1">
                Historikk viser akkumulerte totaler. Per-periode data samles fra daglig aktivitet.
              </p>
            </div>

            {/* ── Kontekst ──────────────────────────────────────────────── */}
            {kontekst.length > 0 && (
              <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-2">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Minne & Kontekst</p>
                <div className="space-y-2">
                  {kontekst.map((k, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-g-border/20 last:border-0">
                      <div className="text-[8px] px-1.5 py-0.5 rounded border border-g-border text-g-muted font-mono flex-shrink-0 mt-0.5">
                        {k.type}
                      </div>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CommunityManagerPage() {
  const [members, setMembers]       = useState<Member[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch]         = useState('');
  const [sorter, setSorter]         = useState<'xp' | 'engagement' | 'messages' | 'community'>('xp');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<MemberDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load list
  useEffect(() => {
    fetch('/api/members')
      .then(r => r.json())
      .then(d => { setMembers(Array.isArray(d) ? d : []); setLoadingList(false); })
      .catch(() => setLoadingList(false));
  }, []);

  // Load detail
  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/members/${id}`);
      const data = await res.json();
      setDetail(data);
    } catch {}
    setLoadingDetail(false);
  }, []);

  const selectMember = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const handleAction = async (action: string) => {
    if (!selectedId) return;
    await fetch(`/api/members/${selectedId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    // Reload detail to reflect changes
    await loadDetail(selectedId);
  };

  const handleBack = () => {
    setSelectedId(null);
    setDetail(null);
  };

  // Sort + filter
  const sortertFelt: Record<typeof sorter, keyof Member> = {
    xp: 'xp', engagement: 'engagementScore', messages: 'messages', community: 'communityScore',
  };
  const sortert = [...members].sort((a, b) => (b[sortertFelt[sorter]] as number) - (a[sortertFelt[sorter]] as number));
  const filtrerte = sortert.filter(m =>
    m.displayName.toLowerCase().includes(search.toLowerCase()) ||
    m.username.toLowerCase().includes(search.toLowerCase())
  );
  const topp3 = sortert.slice(0, 3);

  // ── Render detail mode ────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div className="max-w-3xl mx-auto">
        <MemberDetailView
          detail={detail}
          loading={loadingDetail}
          onBack={handleBack}
          onAction={handleAction}
        />
      </div>
    );
  }

  // ── Render list mode ──────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Manager</h1>
          <p className="text-[10px] text-g-muted mt-0.5">{members.length} membres · klikk for å åpne profil</p>
        </div>
        <Link href="/community-intelligence" className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded px-2 py-1 transition-colors">
          Community Intelligence →
        </Link>
      </div>

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
                <div
                  key={m.id}
                  onClick={() => selectMember(m.id)}
                  className="p-3 bg-g-bg border border-g-border rounded-lg cursor-pointer hover:border-g-green/30 transition-all text-center"
                >
                  <p className={`text-xl font-black font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : 'text-orange-400'}`}>{i + 1}</p>
                  <p className="text-xs font-bold text-g-text mt-1 truncate">{m.displayName}</p>
                  <p className="text-[10px] text-g-green font-mono">
                    {sorter === 'xp' ? `${m.xp.toLocaleString()} XP` :
                     sorter === 'engagement' ? `${m.engagementScore}` :
                     sorter === 'messages' ? `${m.messages} msg` :
                     `${m.communityScore}`}
                  </p>
                  {rolle && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border mt-1 inline-block ${rolle.farge}`}>{rolle.navn}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Søk + sort */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søk på navn..."
          className="flex-1 bg-g-card border border-g-border rounded-lg px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50"
        />
        <div className="flex gap-1">
          {(['xp', 'engagement', 'messages', 'community'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSorter(s)}
              className={`px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all ${
                sorter === s
                  ? 'bg-g-green/10 border-g-green/30 text-g-green'
                  : 'border-g-border text-g-muted hover:text-g-text'
              }`}
            >
              {s === 'xp' ? 'XP' : s === 'engagement' ? 'Engage' : s === 'messages' ? 'Chat' : 'Community'}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      <div className="bg-g-card border border-g-border rounded-xl">
        {loadingList ? (
          <div className="p-6 text-center">
            <p className="text-xs text-g-muted animate-pulse">Laster community-data...</p>
          </div>
        ) : filtrerte.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-xs text-g-muted">
              {members.length === 0
                ? 'Ingen membres registrert ennå.'
                : 'Ingen treff.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-g-border/30 max-h-[600px] overflow-y-auto">
            {filtrerte.map((m, i) => {
              const rolle = getRolle(m.level);
              const segs = getMemberSegments(m);
              return (
                <div
                  key={m.id}
                  onClick={() => selectMember(m.id)}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-g-bg/60 transition-all group"
                >
                  <span className="text-[9px] text-g-muted font-mono w-5 flex-shrink-0">{i + 1}</span>
                  <div className="w-7 h-7 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-black text-g-green">{m.displayName?.[0]?.toUpperCase() ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-bold text-g-text truncate">{m.displayName}</p>
                      {rolle && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border hidden sm:inline ${rolle.farge}`}>{rolle.navn}</span>
                      )}
                      {segs.map(s => (
                        <span key={s.navn} className={`text-[7px] font-bold px-1 py-0.5 rounded border hidden md:inline ${s.farge}`}>{s.navn}</span>
                      ))}
                    </div>
                    <XPBar xp={m.xp} level={m.level} />
                  </div>
                  <div className="text-right text-[9px] text-g-muted flex-shrink-0 space-y-0.5">
                    <p className="text-g-green font-mono font-bold">{m.xp.toLocaleString()} XP</p>
                    <p>{m.messages} msg · {tidSiden(m.lastSeen)}</p>
                  </div>
                  <span className="text-g-muted/30 group-hover:text-g-muted text-xs ml-1">›</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
