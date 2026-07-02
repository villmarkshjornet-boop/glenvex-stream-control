'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, ErrorState } from '@/components/ui';
import { tidSiden } from '@/components/dashboard/helpers';

interface HealthData {
  total: number; aktive24h: number; aktive7d: number; aktive30d: number;
  nyeSiste30d: number; retention: number; churn: number;
  linkedCount: number; subCount: number; totalCards: number;
}
interface Member {
  id: string; username: string;
  xp?: number; totalXp?: number; discordXp?: number; twitchXp?: number;
  level?: number;
  messages?: number; messagesDiscord?: number; messagesTwitch?: number;
  badges?: string[]; engagementScore?: number; communityScore?: number;
  subs?: number; giftSubs?: number; raids?: number; streamsAttended?: number;
  coinsBalance?: number; totalCoinsEarned?: number; totalCoinsSpent?: number;
  totalCards?: number; mythicCards?: number; legendaryCards?: number;
  twitchLinked?: boolean; twitchSubStatus?: boolean; twitchSubTier?: string | null;
  lastSeen?: string; lastActivityAt?: string; joinedAt?: string;
}
interface Anbefaling {
  type: string; member: string; begrunnelse: string; prioritet: 'høy' | 'medium' | 'lav';
}
interface AiMemoryKontekst {
  communitySignaler: { key: string; summary: string; occurrences: number }[];
  runningJokes: { key: string; summary: string }[];
  kjenteMembres: { key: string; summary: string }[];
  crossPlatformCount: number; dataKvalitet: string;
}
interface IntelligenceData {
  health: HealthData;
  leaders: { toppXP: Member[]; toppChattere: Member[]; toppSupportere: Member[]; toppEngasjement: Member[] };
  coreMembers: Member[]; communityHeroes: Member[]; streamerSupportere: Member[];
  retentionLeaders: Member[]; atRisk: Member[]; newMembers: Member[]; hiddenGems: Member[];
  // Nye segmenter
  collectors: Member[]; highRollers: Member[]; crossPlatform: Member[];
  subscribers: Member[]; futureMods: Member[]; cardHunters: Member[]; whales: Member[];
  anbefalinger: Anbefaling[]; aiMemoryKontekst: AiMemoryKontekst;
  aiAnalyse: string | null; generertKl: string;
}

const PRIORITET_FARGE: Record<string, string> = {
  høy:    'text-red-400 border-red-400/30 bg-red-400/5',
  medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  lav:    'text-blue-400 border-blue-400/30 bg-blue-400/5',
};
const ANBEFALING_IKON: Record<string, string> = {
  gi_vip: '★', følg_opp: '!', spotlight: '◆', takk: '◈', link_twitch: '⇄',
};

function StatCard({ label, value, sub, color = 'text-g-green' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-3 text-center">
      <p className={`text-2xl font-black font-mono ${color}`}>{value}</p>
      <p className="text-[11px] text-g-muted uppercase tracking-widest mt-1">{label}</p>
      {sub && <p className="text-[11px] text-g-muted/60 mt-0.5">{sub}</p>}
    </div>
  );
}

function MemberRow({ m, showXP, showMessages, showScore, showSupport, showLastSeen,
  showStreams, showCoins, showCards, showRarity }: {
  m: Member; showXP?: boolean; showMessages?: boolean; showScore?: boolean;
  showSupport?: boolean; showLastSeen?: boolean; showStreams?: boolean;
  showCoins?: boolean; showCards?: boolean; showRarity?: boolean;
}) {
  const displayXp = m.totalXp ?? m.xp ?? 0;
  const lastActivity = m.lastActivityAt ?? m.lastSeen;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-g-border/20 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 shrink-0 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center">
          <span className="text-[11px] font-black text-g-green">{m.username?.[0]?.toUpperCase() ?? '?'}</span>
        </div>
        <p className="text-xs font-bold text-g-text truncate">{m.username}</p>
        {m.twitchLinked && (
          <span className="text-[11px] px-1 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
            {m.twitchSubStatus ? `SUB T${m.twitchSubTier ?? '1'}` : 'TW'}
          </span>
        )}
        {showLastSeen && lastActivity && (
          <p className="text-[11px] text-g-muted shrink-0">{tidSiden(lastActivity)}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-g-muted font-mono shrink-0">
        {showXP     && <span className="text-g-green">{displayXp.toLocaleString()} XP</span>}
        {m.level !== undefined && <span>Lv {m.level}</span>}
        {showMessages && <span>{(m.messages ?? 0).toLocaleString()} msg</span>}
        {showScore    && <span className="text-g-green">{m.engagementScore ?? 0} score</span>}
        {showSupport  && <span>{(m.subs ?? 0)}s {(m.giftSubs ?? 0)}g {(m.raids ?? 0)}r</span>}
        {showStreams   && <span>{m.streamsAttended ?? 0} streams</span>}
        {showCoins    && <span className="text-yellow-400">{(m.coinsBalance ?? 0).toLocaleString()} ◆</span>}
        {showCards    && <span className="text-blue-400">{m.totalCards ?? 0} kort</span>}
        {showRarity   && (m.mythicCards ?? 0) > 0 && <span className="text-red-400">{m.mythicCards}M</span>}
        {showRarity   && (m.legendaryCards ?? 0) > 0 && <span className="text-yellow-400">{m.legendaryCards}L</span>}
      </div>
    </div>
  );
}

function SegmentPanel({ title, desc, color, members, children }: {
  title: string; desc?: string; color: string; members: Member[]; children: React.ReactNode;
}) {
  return (
    <div className={`bg-g-card border rounded-2xl p-6 ${color}`}>
      <p className="text-xs uppercase tracking-widest font-bold mb-1"
        style={{ color: 'inherit' }}>{title} ({members.length})</p>
      {desc && <p className="text-[11px] text-g-muted mb-2">{desc}</p>}
      {members.length === 0
        ? <p className="text-sm text-g-muted">Ingen ennå.</p>
        : children}
    </div>
  );
}

export default function CommunityIntelligencePage() {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/community-intelligence')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-g-border/40 rounded w-3/4" />
        <div className="h-4 bg-g-border/40 rounded w-1/2" />
      </div>
    </div>
  );
  if (error || !data) return (
    <div className="max-w-5xl mx-auto">
      <ErrorState message={error ?? 'Ingen community-data tilgjengelig'} />
    </div>
  );

  const {
    health, leaders, coreMembers, communityHeroes, streamerSupportere,
    retentionLeaders, atRisk, newMembers, hiddenGems,
    collectors, highRollers, crossPlatform, subscribers, futureMods, cardHunters, whales,
    anbefalinger, aiMemoryKontekst, aiAnalyse,
  } = data;
  const churnColor = health.churn > 50 ? 'text-red-400' : health.churn > 30 ? 'text-yellow-400' : 'text-g-green';

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="Community Intelligence" subtitle={`Sist oppdatert kl. ${data.generertKl}`}>
        <Link href="/community-manager" className="text-xs text-g-muted hover:text-g-green transition-colors border border-g-border rounded-lg px-2 py-1">
          Alle membres →
        </Link>
      </PageHeader>

      {/* ── Community Health ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-2">Community Health</p>
        <div className="grid grid-cols-5 gap-2 mb-2">
          <StatCard label="Totalt"     value={health.total} />
          <StatCard label="Aktive 24t" value={health.aktive24h} />
          <StatCard label="Aktive 7d"  value={health.aktive7d} />
          <StatCard label="Aktive 30d" value={health.aktive30d} />
          <StatCard label="Nye 30d"    value={health.nyeSiste30d} color="text-blue-400" />
        </div>
        <div className="grid grid-cols-5 gap-2">
          <StatCard label="Retention"     value={`${health.retention}%`} color={health.retention > 50 ? 'text-g-green' : 'text-yellow-400'} />
          <StatCard label="Churn"         value={`${health.churn}%`} color={churnColor} />
          <StatCard label="TW Koblet"     value={health.linkedCount ?? 0} color="text-purple-400" sub="Discord + Twitch" />
          <StatCard label="Aktive SUBs"   value={health.subCount ?? 0} color="text-pink-400" />
          <StatCard label="Totale Kort"   value={health.totalCards ?? 0} color="text-blue-400" />
        </div>
      </div>

      {/* ── AI Analyse ─────────────────────────────────────────────────────── */}
      {aiAnalyse && (
        <div className="bg-g-card border border-g-green/20 rounded-2xl p-6">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-green mb-2">AI Community Analyse</p>
          <p className="text-sm text-g-text leading-relaxed whitespace-pre-wrap">{aiAnalyse}</p>
        </div>
      )}

      {/* ── Anbefalinger ───────────────────────────────────────────────────── */}
      {anbefalinger.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-2">Handlingsanbefalinger</p>
          <div className="grid grid-cols-2 gap-2">
            {anbefalinger.map((a, i) => (
              <div key={i} className={`rounded-xl border p-3 ${PRIORITET_FARGE[a.prioritet]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{ANBEFALING_IKON[a.type] ?? '•'}</span>
                  <span className="text-sm font-bold text-g-text">{a.member}</span>
                  <span className={`ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded border ${PRIORITET_FARGE[a.prioritet]}`}>{a.prioritet}</span>
                </div>
                <p className="text-[11px] text-g-muted leading-relaxed">{a.begrunnelse}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Eksisterende segmenter ─────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-2">Lojalitet & Aktivitet</p>
        <div className="grid grid-cols-2 gap-4">
          <SegmentPanel title="Core Members" desc="≥5 streams · aktiv 7d · aktiv chatter"
            color="border-emerald-500/20 text-emerald-400" members={coreMembers}>
            {coreMembers.map(m => <MemberRow key={m.id} m={m} showXP showStreams />)}
          </SegmentPanel>
          <SegmentPanel title="Community Heroes" desc="Lv≥30 eller support-score≥5"
            color="border-yellow-500/20 text-yellow-400" members={communityHeroes}>
            {communityHeroes.map(m => <MemberRow key={m.id} m={m} showXP showSupport />)}
          </SegmentPanel>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SegmentPanel title="Streamer Supporters" desc="Support-score≥3"
          color="border-pink-500/20 text-pink-400" members={streamerSupportere}>
          {streamerSupportere.map(m => <MemberRow key={m.id} m={m} showSupport />)}
        </SegmentPanel>
        <SegmentPanel title="Retention Leaders" desc="≥8 streams · aktiv 14d"
          color="border-purple-500/20 text-purple-400" members={retentionLeaders}>
          {retentionLeaders.map(m => <MemberRow key={m.id} m={m} showStreams showLastSeen />)}
        </SegmentPanel>
      </div>

      {/* ── Nye segmenter — Community Core ────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-2">Community Core — Nye Segmenter</p>
        <div className="grid grid-cols-2 gap-4">
          <SegmentPanel title="Collectors" desc="≥5 kort — bygger kortbibliotek"
            color="border-blue-500/20 text-blue-400" members={collectors}>
            {collectors.map(m => <MemberRow key={m.id} m={m} showCards showRarity showXP />)}
          </SegmentPanel>
          <SegmentPanel title="High Rollers" desc="≥300 coins balanse"
            color="border-yellow-500/20 text-yellow-400" members={highRollers}>
            {highRollers.map(m => <MemberRow key={m.id} m={m} showCoins showXP />)}
          </SegmentPanel>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SegmentPanel title="Cross Platform" desc="Discord + Twitch koblet · aktiv 14d"
          color="border-purple-500/20 text-purple-400" members={crossPlatform}>
          {crossPlatform.map(m => <MemberRow key={m.id} m={m} showXP showLastSeen />)}
        </SegmentPanel>
        <SegmentPanel title="Subscribers" desc="Aktive Twitch SUBs med Discord"
          color="border-pink-500/20 text-pink-400" members={subscribers}>
          {subscribers.map(m => <MemberRow key={m.id} m={m} showXP showLastSeen />)}
        </SegmentPanel>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SegmentPanel title="Whales" desc="1+ Mythic eller 2+ Legendary kort"
          color="border-red-500/20 text-red-400" members={whales}>
          {whales.map(m => <MemberRow key={m.id} m={m} showCards showRarity />)}
        </SegmentPanel>
        <SegmentPanel title="Card Hunters" desc="≥3 kort + ≥150 coins brukt (rerolls)"
          color="border-orange-500/20 text-orange-400" members={cardHunters}>
          {cardHunters.map(m => <MemberRow key={m.id} m={m} showCards showCoins />)}
        </SegmentPanel>
      </div>

      {futureMods.length > 0 && (
        <div>
          <SegmentPanel title="Future Mods" desc="Community score≥50 · aktiv 14d · Lv≥10 · engagement≥30"
            color="border-teal-500/20 text-teal-400" members={futureMods}>
            {futureMods.map(m => <MemberRow key={m.id} m={m} showXP showScore showStreams />)}
          </SegmentPanel>
        </div>
      )}

      {/* ── Leaders ────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-2">Ledertabeller</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-g-card border border-g-border rounded-2xl p-6">
            <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Topp XP</p>
            {leaders.toppXP.slice(0, 8).map(m => <MemberRow key={m.id} m={m} showXP />)}
          </div>
          <div className="bg-g-card border border-g-border rounded-2xl p-6">
            <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Topp Chattere</p>
            {leaders.toppChattere.map(m => <MemberRow key={m.id} m={m} showMessages />)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Topp Støttespillere</p>
          {leaders.toppSupportere.map(m => <MemberRow key={m.id} m={m} showSupport />)}
        </div>
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Høyest Engasjement</p>
          {leaders.toppEngasjement.map(m => <MemberRow key={m.id} m={m} showScore />)}
        </div>
      </div>

      {/* ── At Risk + Hidden Gems ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <SegmentPanel title="At Risk" desc="Inaktiv >14d men tidligere aktiv"
          color="border-red-500/20 text-red-400" members={atRisk}>
          {atRisk.map(m => <MemberRow key={m.id} m={m} showXP showLastSeen />)}
        </SegmentPanel>
        <SegmentPanel title="Hidden Gems" desc="Høy community score · lite synlig"
          color="border-blue-500/20 text-blue-400" members={hiddenGems}>
          {hiddenGems.map(m => <MemberRow key={m.id} m={m} showScore showSupport />)}
        </SegmentPanel>
      </div>

      {/* ── New Members ────────────────────────────────────────────────────── */}
      {newMembers.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Nye Membres Siste 30 Dager</p>
          <div className="grid grid-cols-2 gap-x-6">
            {newMembers.map(m => (
              <div key={m.id} className="flex items-center justify-between py-1 border-b border-g-border/20 last:border-0">
                <p className="text-sm text-g-text">{m.username}</p>
                <p className="text-[11px] text-g-muted">{m.joinedAt ? tidSiden(m.joinedAt) : '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Memory Kontekst ─────────────────────────────────────────────── */}
      {(aiMemoryKontekst.communitySignaler.length > 0 ||
        aiMemoryKontekst.runningJokes.length > 0 ||
        aiMemoryKontekst.kjenteMembres.length > 0) && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">AI Minne om Community</p>
            <span className={`text-[11px] px-2 py-0.5 rounded border font-bold ${
              aiMemoryKontekst.dataKvalitet === 'medium' ? 'text-g-green border-g-green/30' :
              aiMemoryKontekst.dataKvalitet === 'lav'    ? 'text-yellow-400 border-yellow-400/30' :
              'text-g-muted border-g-border'
            }`}>{aiMemoryKontekst.dataKvalitet}</span>
          </div>
          {aiMemoryKontekst.communitySignaler.length > 0 && (
            <div>
              <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1.5">Signaler</p>
              <div className="flex flex-wrap gap-1.5">
                {aiMemoryKontekst.communitySignaler.map(s => (
                  <span key={s.key} className="text-[11px] px-2 py-0.5 bg-g-bg border border-g-border rounded text-g-text" title={s.summary}>
                    {s.key} <span className="text-g-muted">×{s.occurrences}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {aiMemoryKontekst.runningJokes.length > 0 && (
            <div>
              <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1.5">Running Jokes</p>
              <div className="flex flex-wrap gap-1.5">
                {aiMemoryKontekst.runningJokes.map(j => (
                  <span key={j.key} className="text-[11px] px-2 py-0.5 bg-g-bg border border-g-border rounded text-g-text">{j.key}</span>
                ))}
              </div>
            </div>
          )}
          {aiMemoryKontekst.kjenteMembres.length > 0 && (
            <div>
              <p className="text-[11px] text-g-muted uppercase tracking-wider mb-1.5">Kjente Membres</p>
              <div className="flex flex-wrap gap-1.5">
                {aiMemoryKontekst.kjenteMembres.map(m => (
                  <span key={m.key} className="text-[11px] px-2 py-0.5 bg-g-bg border border-g-border rounded text-g-text">{m.key}</span>
                ))}
              </div>
            </div>
          )}
          {aiMemoryKontekst.crossPlatformCount > 0 && (
            <p className="text-[11px] text-g-muted">{aiMemoryKontekst.crossPlatformCount} Discord↔Twitch koblet</p>
          )}
        </div>
      )}
    </div>
  );
}
