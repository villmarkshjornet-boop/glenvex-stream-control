'use client';

import { useEffect, useState } from 'react';

interface Member {
  id: string;
  displayName: string;
  username: string;
  xp: number;
  level: number;
  messages: number;
  subs: number;
  giftSubs: number;
  raids: number;
  badges: string[];
  joinedAt: string;
}

const BADGE_IKON: Record<string, string> = {
  'Første melding': '💬', '100 Meldinger': '🔥', '500 Meldinger': '⚡',
  'Første Sub': '⭐', 'Community Veteran': '👑',
};

const XP_PER_LEVEL = 500;

function LevelBadge({ level }: { level: number }) {
  const color = level >= 50 ? '#ffd700' : level >= 20 ? '#00aaff' : level >= 10 ? '#00ff41' : '#888';
  return (
    <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-xs" style={{ borderColor: color, color }}>
      {level}
    </div>
  );
}

export default function XPSystemPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/members').then(r => r.json()).then(d => { setMembers(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const totalXP = members.reduce((s, m) => s + m.xp, 0);
  const highestLevel = members[0]?.level ?? 0;
  const totalBadges = members.reduce((s, m) => s + m.badges.length, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">XP System</h1>
        <p className="text-xs text-g-muted mt-0.5">Community levels, badges og rangering</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Aktive membres', value: members.length },
          { label: 'Total XP', value: totalXP.toLocaleString() },
          { label: 'Høyeste level', value: highestLevel },
          { label: 'Badges tildelt', value: totalBadges },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
            <p className="text-xl font-black text-g-green font-mono mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Badge-guide */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Badge-guide</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(BADGE_IKON).map(([badge, icon]) => (
            <div key={badge} className="flex items-center gap-2 p-2 bg-g-bg border border-g-border rounded">
              <span className="text-lg">{icon}</span>
              <p className="text-xs text-g-text">{badge}</p>
            </div>
          ))}
          <div className="flex items-center gap-2 p-2 bg-g-bg border border-g-border rounded">
            <span className="text-lg">🎁</span>
            <p className="text-xs text-g-text">Gift sub-giver</p>
          </div>
          <div className="flex items-center gap-2 p-2 bg-g-bg border border-g-border rounded">
            <span className="text-lg">🚨</span>
            <p className="text-xs text-g-text">Raider</p>
          </div>
        </div>
      </div>

      {/* Rangering */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Rangering</h2>
        {loading ? <p className="text-xs text-g-muted">Laster...</p> : members.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen XP registrert ennå. XP gis automatisk for meldinger i Discord.</p>
        ) : (
          <div className="space-y-2">
            {members.slice(0, 20).map((m, i) => {
              const currentLevelXP = (m.level - 1) * XP_PER_LEVEL;
              const pct = Math.min(100, Math.round(((m.xp - currentLevelXP) / XP_PER_LEVEL) * 100));
              return (
                <div key={m.id} className="flex items-center gap-3 p-3 hover:bg-g-bg rounded-lg transition-all">
                  <span className={`text-sm font-black font-mono w-6 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-g-muted'}`}>
                    {i + 1}
                  </span>
                  <LevelBadge level={m.level} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-bold text-g-text">{m.displayName}</p>
                      {m.badges.slice(0, 4).map(b => <span key={b} className="text-xs" title={b}>{BADGE_IKON[b] ?? '🏅'}</span>)}
                    </div>
                    <div className="w-full bg-g-border rounded-full h-1">
                      <div className="bg-g-green h-1 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-g-green font-mono">{m.xp.toLocaleString()} XP</p>
                    <p className="text-[10px] text-g-muted">{m.messages} msg</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
