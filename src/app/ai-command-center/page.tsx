'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Scores {
  communityScore: number;
  growthScore: number;
  sponsorScore: number;
  prioriteter: string[];
  data: {
    followers: number;
    avgViewers: number;
    discordMembers: number;
    activeMembers: number;
    totalMessages: number;
    clipCount: number;
    isLive: boolean;
  };
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="18" fontWeight="bold">{score}</text>
      </svg>
      <p className="text-xs text-g-muted font-semibold tracking-wider uppercase">{label}</p>
    </div>
  );
}

const MODULER = [
  { href: '/community-manager', label: 'Community Manager', icon: '◈', desc: 'Membre, XP, MVP' },
  { href: '/stream-coach', label: 'Stream Coach', icon: '◆', desc: 'AI stream-analyse' },
  { href: '/highlights', label: 'Highlights', icon: '▶', desc: 'Auto highlight-finder' },
  { href: '/sponsor-manager', label: 'Sponsor Manager', icon: '◇', desc: 'Sponsorrapport' },
  { href: '/raid-manager', label: 'Raid Manager', icon: '⟐', desc: 'Raid-anbefalinger' },
  { href: '/xp-system', label: 'XP System', icon: '◎', desc: 'Levels og badges' },
  { href: '/rp-intelligence', label: 'RP Intelligence', icon: '◉', desc: 'Future RP-notater' },
  { href: '/moderation', label: 'AI Moderator', icon: '⊛', desc: 'Community health' },
  { href: '/event-generator', label: 'Event Generator', icon: '⊕', desc: 'Auto community-events' },
  { href: '/pre-live', label: 'Pre-Live Hype', icon: '((•))', desc: 'Automatisk hype' },
];

export default function AICommandCenterPage() {
  const [scores, setScores] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-scores').then(r => r.json()).then(d => { setScores(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Command Center</h1>
        <p className="text-xs text-g-muted mt-0.5">Komplett oversikt – Community · Vekst · Innhold · Sponsorer</p>
      </div>

      {/* Score-kort */}
      <div className="bg-g-card border border-g-border rounded-lg p-6">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-6">AI Scores</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex justify-around flex-wrap gap-6">
            <ScoreRing score={scores?.communityScore ?? 0} label="Community Score" color="#00ff41" />
            <ScoreRing score={scores?.growthScore ?? 0} label="Growth Score" color="#00aaff" />
            <ScoreRing score={scores?.sponsorScore ?? 0} label="Sponsor Score" color="#ffd700" />
          </div>
        )}
      </div>

      {/* Stats-rad */}
      {scores?.data && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: 'Følgere', value: scores.data.followers.toLocaleString() },
            { label: 'Snitt-seere', value: scores.data.avgViewers.toString() },
            { label: 'Discord', value: scores.data.discordMembers.toString() },
            { label: 'Aktive', value: scores.data.activeMembers.toString() },
            { label: 'Meldinger', value: scores.data.totalMessages.toLocaleString() },
            { label: 'Status', value: scores.data.isLive ? '🔴 LIVE' : 'Offline' },
          ].map(s => (
            <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-3 text-center">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <p className="text-sm font-black text-g-green font-mono mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* AI Prioriteter */}
      {(scores?.prioriteter?.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">◆ AI Prioriteter denne uken</h2>
          <div className="grid grid-cols-2 gap-3">
            {scores!.prioriteter.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-g-bg border border-g-border rounded-lg hover:border-g-green/20 transition-all">
                <span className="text-g-green font-black font-mono text-sm mt-0.5">{i + 1}</span>
                <p className="text-xs text-g-text leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modul-grid */}
      <div>
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Moduler</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MODULER.map(m => (
            <Link key={m.href} href={m.href}
              className="bg-g-card border border-g-border rounded-lg p-4 hover:border-g-green/30 hover:bg-g-green/5 transition-all group">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-g-green text-base">{m.icon}</span>
                <p className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors">{m.label}</p>
              </div>
              <p className="text-[10px] text-g-muted pl-6">{m.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
