'use client';

import { useEffect, useState } from 'react';

interface Member {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  messages: number;
  subs: number;
  giftSubs: number;
  raids: number;
  badges: string[];
  lastSeen: string;
  joinedAt: string;
}

const BADGE_ICONS: Record<string, string> = {
  'Første melding': '💬',
  '100 Meldinger': '🔥',
  '500 Meldinger': '⚡',
  'Første Sub': '⭐',
  'Community Veteran': '👑',
};

function XPBar({ xp, level }: { xp: number; level: number }) {
  const XP_PER_LEVEL = 500;
  const currentLevelXP = (level - 1) * XP_PER_LEVEL;
  const pct = Math.min(100, Math.round(((xp - currentLevelXP) / XP_PER_LEVEL) * 100));
  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] text-g-muted mb-1">
        <span>Lv {level}</span>
        <span>{pct}% til Lv {level + 1}</span>
      </div>
      <div className="w-full bg-g-border rounded-full h-1.5">
        <div className="bg-g-green h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function CommunityManagerPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [valgt, setValgt] = useState<Member | null>(null);

  useEffect(() => {
    fetch('/api/members').then(r => r.json()).then(d => { setMembers(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtrerte = members.filter(m => m.displayName.toLowerCase().includes(search.toLowerCase()) || m.username.toLowerCase().includes(search.toLowerCase()));
  const topp3 = members.slice(0, 3);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Memberprofile, XP og rankings</p>
      </div>

      {/* MVP */}
      {topp3.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">👑 Community MVP</h2>
          <div className="flex gap-4">
            {topp3.map((m, i) => (
              <div key={m.id} onClick={() => setValgt(m)}
                className="flex-1 p-4 bg-g-bg border border-g-border rounded-lg cursor-pointer hover:border-g-green/30 transition-all text-center">
                <p className={`text-2xl font-black font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-orange-400'}`}>{i + 1}</p>
                <p className="text-sm font-bold text-g-text mt-1">{m.displayName}</p>
                <p className="text-xs text-g-green font-mono">Lv {m.level} • {m.xp.toLocaleString()} XP</p>
                <div className="flex justify-center gap-1 mt-2 flex-wrap">
                  {m.badges.slice(0, 3).map(b => <span key={b} title={b} className="text-sm">{BADGE_ICONS[b] ?? '🏅'}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Søk og liste */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Alle membres ({members.length})</h2>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Søk..."
            className="bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50 w-48" />
        </div>

        {loading ? <p className="text-xs text-g-muted">Laster...</p> : filtrerte.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen membres registrert ennå. Aktivitet i Discord-kanaler gir XP automatisk.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filtrerte.map((m, i) => (
              <div key={m.id} onClick={() => setValgt(valgt?.id === m.id ? null : m)}
                className="flex items-center gap-3 p-3 hover:bg-g-bg rounded-lg cursor-pointer transition-all border border-transparent hover:border-g-border">
                <span className="text-g-muted text-xs font-mono w-6">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-g-text truncate">{m.displayName}</p>
                    <span className="text-[10px] text-g-green font-mono">Lv {m.level}</span>
                    {m.badges.map(b => <span key={b} title={b} className="text-xs">{BADGE_ICONS[b] ?? '🏅'}</span>)}
                  </div>
                  <XPBar xp={m.xp} level={m.level} />
                </div>
                <div className="text-right text-[10px] text-g-muted">
                  <p>{m.messages} meldinger</p>
                  <p>{m.xp.toLocaleString()} XP</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Valgt member */}
      {valgt && (
        <div className="bg-g-card border border-g-green/20 rounded-lg p-5 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-sm font-black text-g-text">{valgt.displayName}</h2>
              <p className="text-xs text-g-muted">@{valgt.username}</p>
            </div>
            <button onClick={() => setValgt(null)} className="text-g-muted hover:text-g-text text-xs">✕ Lukk</button>
          </div>
          <XPBar xp={valgt.xp} level={valgt.level} />
          <div className="grid grid-cols-4 gap-3">
            {[['Meldinger', valgt.messages], ['Subs', valgt.subs], ['Gift subs', valgt.giftSubs], ['Raids', valgt.raids]].map(([l, v]) => (
              <div key={l as string} className="text-center p-2 bg-g-bg rounded border border-g-border">
                <p className="text-[9px] text-g-muted uppercase tracking-widest">{l}</p>
                <p className="text-sm font-black text-g-green font-mono mt-0.5">{v}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10px] text-g-muted uppercase tracking-widest mb-2">Badges</p>
            <div className="flex gap-2 flex-wrap">
              {valgt.badges.length === 0 ? <p className="text-xs text-g-muted">Ingen badges ennå</p> :
                valgt.badges.map(b => (
                  <span key={b} className="px-2 py-1 bg-g-bg border border-g-border rounded text-xs text-g-text flex items-center gap-1">
                    {BADGE_ICONS[b] ?? '🏅'} {b}
                  </span>
                ))}
            </div>
          </div>
          <p className="text-[10px] text-g-muted">Sist sett: {new Date(valgt.lastSeen).toLocaleString('no-NO')}</p>
        </div>
      )}
    </div>
  );
}
