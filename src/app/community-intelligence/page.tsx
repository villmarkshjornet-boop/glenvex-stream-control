'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface HealthData {
  total: number; aktive24h: number; aktive7d: number; aktive30d: number;
  nyeSiste30d: number; retention: number; churn: number;
}
interface Member { id: string; username: string; xp?: number; level?: number; messages?: number; badges?: string[]; engagementScore?: number; communityScore?: number; subs?: number; giftSubs?: number; raids?: number; lastSeen?: string; joinedAt?: string; }
interface IntelligenceData {
  health: HealthData;
  leaders: { toppXP: Member[]; toppChattere: Member[]; toppSupportere: Member[]; toppEngasjement: Member[] };
  atRisk: Member[];
  newMembers: Member[];
  hiddenGems: Member[];
  aiAnalyse: string | null;
  generertKl: string;
}

function tidSiden(iso: string): string {
  if (!iso) return '—';
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60) return 'akkurat nå';
  if (sek < 3600) return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return `${Math.floor(sek / 86400)}d siden`;
}

function StatCard({ label, value, sub, color = 'text-g-green' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-g-card border border-g-border rounded-lg p-3 text-center">
      <p className={`text-2xl font-black font-mono ${color}`}>{value}</p>
      <p className="text-[9px] text-g-muted uppercase tracking-widest mt-1">{label}</p>
      {sub && <p className="text-[9px] text-g-muted/60 mt-0.5">{sub}</p>}
    </div>
  );
}

function MemberRow({ m, showXP, showMessages, showScore, showSupport, showLastSeen }: {
  m: Member; showXP?: boolean; showMessages?: boolean; showScore?: boolean; showSupport?: boolean; showLastSeen?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-g-border/20 last:border-0">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center">
          <span className="text-[9px] font-black text-g-green">{m.username?.[0]?.toUpperCase() ?? '?'}</span>
        </div>
        <p className="text-xs font-bold text-g-text">{m.username}</p>
        {showLastSeen && m.lastSeen && (
          <p className="text-[9px] text-g-muted">{tidSiden(m.lastSeen)}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-[9px] text-g-muted font-mono">
        {showXP && <span className="text-g-green">{(m.xp ?? 0).toLocaleString()} XP</span>}
        {m.level !== undefined && <span>Lv {m.level}</span>}
        {showMessages && <span>{(m.messages ?? 0).toLocaleString()} msg</span>}
        {showScore && <span className="text-g-green">{m.engagementScore ?? 0} score</span>}
        {showSupport && <span>{(m.subs ?? 0)}s {(m.giftSubs ?? 0)}g {(m.raids ?? 0)}r</span>}
      </div>
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
    <div className="max-w-5xl mx-auto">
      <p className="text-g-muted text-sm animate-pulse">Laster community-data...</p>
    </div>
  );

  if (error || !data) return (
    <div className="max-w-5xl mx-auto">
      <p className="text-red-400 text-sm">Feil: {error ?? 'Ingen data'}</p>
    </div>
  );

  const { health, leaders, atRisk, newMembers, hiddenGems, aiAnalyse } = data;
  const churnColor = health.churn > 50 ? 'text-red-400' : health.churn > 30 ? 'text-yellow-400' : 'text-g-green';

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Intelligence</h1>
          <p className="text-xs text-g-muted mt-0.5">Sist oppdatert kl. {data.generertKl}</p>
        </div>
        <Link href="/community-manager" className="text-[9px] text-g-muted hover:text-g-green transition-colors border border-g-border rounded px-2 py-1">
          Alle membres →
        </Link>
      </div>

      {/* ── Community Health ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Community Health</p>
        <div className="grid grid-cols-7 gap-2">
          <StatCard label="Totalt" value={health.total} />
          <StatCard label="Aktive 24t" value={health.aktive24h} />
          <StatCard label="Aktive 7d" value={health.aktive7d} />
          <StatCard label="Aktive 30d" value={health.aktive30d} />
          <StatCard label="Nye 30d" value={health.nyeSiste30d} color="text-blue-400" />
          <StatCard label="Retention" value={`${health.retention}%`} color={health.retention > 50 ? 'text-g-green' : 'text-yellow-400'} />
          <StatCard label="Churn" value={`${health.churn}%`} color={churnColor} />
        </div>
      </div>

      {/* ── AI Analyse ───────────────────────────────────────────────────────── */}
      {aiAnalyse && (
        <div className="bg-g-card border border-g-green/20 rounded-xl p-4">
          <p className="text-[9px] text-g-green uppercase tracking-widest font-bold mb-2">◈ AI Community Analyse</p>
          <p className="text-xs text-g-text leading-relaxed whitespace-pre-wrap">{aiAnalyse}</p>
        </div>
      )}

      {/* ── Leaders ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">👑 Topp XP</p>
          {leaders.toppXP.slice(0, 8).map(m => <MemberRow key={m.id} m={m} showXP />)}
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">💬 Topp Chattere</p>
          {leaders.toppChattere.map(m => <MemberRow key={m.id} m={m} showMessages />)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">⭐ Topp Støttespillere</p>
          {leaders.toppSupportere.map(m => <MemberRow key={m.id} m={m} showSupport />)}
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">🔥 Høyest Engasjement</p>
          {leaders.toppEngasjement.map(m => <MemberRow key={m.id} m={m} showScore />)}
        </div>
      </div>

      {/* ── At Risk + Hidden Gems ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-g-card border border-red-500/20 rounded-xl p-4">
          <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold mb-3">⚠ At Risk ({atRisk.length})</p>
          {atRisk.length === 0
            ? <p className="text-xs text-g-muted">Ingen at-risk membres.</p>
            : atRisk.map(m => <MemberRow key={m.id} m={m} showXP showLastSeen />)
          }
        </div>
        <div className="bg-g-card border border-blue-500/20 rounded-xl p-4">
          <p className="text-[9px] text-blue-400 uppercase tracking-widest font-bold mb-3">💎 Hidden Gems ({hiddenGems.length})</p>
          {hiddenGems.length === 0
            ? <p className="text-xs text-g-muted">Ingen hidden gems ennå.</p>
            : hiddenGems.map(m => <MemberRow key={m.id} m={m} showScore showSupport />)
          }
        </div>
      </div>

      {/* ── New Members ──────────────────────────────────────────────────────── */}
      {newMembers.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">🆕 Nye Membres Siste 30 Dager</p>
          <div className="grid grid-cols-2 gap-x-6">
            {newMembers.map(m => (
              <div key={m.id} className="flex items-center justify-between py-1 border-b border-g-border/20 last:border-0">
                <p className="text-xs text-g-text">{m.username}</p>
                <p className="text-[9px] text-g-muted">{m.joinedAt ? tidSiden(m.joinedAt) : '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
