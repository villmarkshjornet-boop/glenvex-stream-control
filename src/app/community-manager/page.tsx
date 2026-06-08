'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Member {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  messages: number;
  reactions: number;
  voiceMinutes: number;
  streamsAttended: number;
  subs: number;
  giftSubs: number;
  raids: number;
  engagementScore: number;
  communityScore: number;
  badges: string[];
  lastSeen: string;
  joinedAt: string;
}

const LEVEL_ROLLER: { level: number; navn: string; farge: string }[] = [
  { level: 50, navn: 'Community Hero', farge: 'text-yellow-400 border-yellow-400/30' },
  { level: 30, navn: 'Veteran',        farge: 'text-orange-400 border-orange-400/30' },
  { level: 15, navn: 'Regular',        farge: 'text-blue-400 border-blue-400/30' },
  { level: 5,  navn: 'Active Member',  farge: 'text-g-green border-g-green/30' },
];

function getRolle(level: number): { navn: string; farge: string } | null {
  return LEVEL_ROLLER.find(r => level >= r.level) ?? null;
}

function XPBar({ xp, level }: { xp: number; level: number }) {
  const XP_PER_LEVEL = 500;
  const currentLevelXP = (level - 1) * XP_PER_LEVEL;
  const pct = Math.min(100, Math.round(((xp - currentLevelXP) / XP_PER_LEVEL) * 100));
  return (
    <div className="w-full">
      <div className="flex justify-between text-[9px] text-g-muted mb-1">
        <span>Lv {level}</span>
        <span>{pct}% til Lv {level + 1}</span>
      </div>
      <div className="w-full bg-g-border rounded-full h-1">
        <div className="bg-g-green h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ScoreBar({ val, max, color = 'bg-g-green' }: { val: number; max: number; color?: string }) {
  const pct = Math.min(100, Math.round((val / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-g-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono text-g-muted w-6 text-right">{val}</span>
    </div>
  );
}

function tidSiden(iso: string): string {
  if (!iso) return '—';
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60) return 'nå';
  if (sek < 3600) return `${Math.floor(sek / 60)}m`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t`;
  return `${Math.floor(sek / 86400)}d siden`;
}

function MemberDetail({ m, onClose }: { m: Member; onClose: () => void }) {
  const rolle = getRolle(m.level);
  return (
    <div className="bg-g-card border border-g-green/20 rounded-xl p-4 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-g-text">{m.displayName}</h2>
            {rolle && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${rolle.farge}`}>{rolle.navn}</span>
            )}
          </div>
          <p className="text-[10px] text-g-muted">@{m.username} · sist sett {tidSiden(m.lastSeen)}</p>
        </div>
        <button onClick={onClose} className="text-g-muted hover:text-g-text text-xs px-2 py-1 border border-g-border rounded">✕</button>
      </div>

      <XPBar xp={m.xp} level={m.level} />

      {/* Hovedtall */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'XP',      val: m.xp.toLocaleString(),     color: 'text-g-green' },
          { label: 'Level',   val: m.level,                   color: 'text-g-green' },
          { label: 'Engage',  val: m.engagementScore,         color: 'text-blue-400' },
          { label: 'Community', val: m.communityScore,        color: 'text-purple-400' },
        ].map(({ label, val, color }) => (
          <div key={label} className="text-center p-2 bg-g-bg border border-g-border rounded-lg">
            <p className="text-[8px] text-g-muted uppercase tracking-widest">{label}</p>
            <p className={`text-sm font-black font-mono mt-0.5 ${color}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Aktivitetsbars */}
      <div className="space-y-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Aktivitet</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <p className="text-[9px] text-g-muted mb-0.5">Meldinger</p>
            <ScoreBar val={m.messages} max={Math.max(m.messages, 500)} />
          </div>
          <div>
            <p className="text-[9px] text-g-muted mb-0.5">Reactions</p>
            <ScoreBar val={m.reactions} max={Math.max(m.reactions, 200)} color="bg-blue-400" />
          </div>
          <div>
            <p className="text-[9px] text-g-muted mb-0.5">Voice (min)</p>
            <ScoreBar val={m.voiceMinutes} max={Math.max(m.voiceMinutes, 300)} color="bg-purple-400" />
          </div>
          <div>
            <p className="text-[9px] text-g-muted mb-0.5">Streams attended</p>
            <ScoreBar val={m.streamsAttended} max={Math.max(m.streamsAttended, 20)} color="bg-orange-400" />
          </div>
        </div>
      </div>

      {/* Support */}
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Support</p>
        <div className="flex gap-3">
          {[['Subs', m.subs], ['Gift subs', m.giftSubs], ['Raids', m.raids]].map(([l, v]) => (
            <div key={l as string} className="text-center px-3 py-1.5 bg-g-bg border border-g-border rounded-lg">
              <p className="text-[8px] text-g-muted uppercase">{l}</p>
              <p className="text-sm font-black text-g-green font-mono">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      {m.badges.length > 0 && (
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Badges</p>
          <div className="flex gap-1.5 flex-wrap">
            {m.badges.map(b => (
              <span key={b} className="px-2 py-0.5 bg-g-bg border border-g-border rounded text-[10px] text-g-text">{b}</span>
            ))}
          </div>
        </div>
      )}

      {m.joinedAt && (
        <p className="text-[9px] text-g-muted">Registrert: {new Date(m.joinedAt).toLocaleDateString('no-NO')}</p>
      )}
    </div>
  );
}

export default function CommunityManagerPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sorter, setSorter] = useState<'xp' | 'engagement' | 'messages' | 'community'>('xp');
  const [valgt, setValgt] = useState<Member | null>(null);

  useEffect(() => {
    fetch('/api/members')
      .then(r => r.json())
      .then(d => { setMembers(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const sorterteFelter: Record<typeof sorter, keyof Member> = {
    xp: 'xp', engagement: 'engagementScore', messages: 'messages', community: 'communityScore',
  };

  const sortert = [...members].sort((a, b) => (b[sorterteFelter[sorter]] as number) - (a[sorterteFelter[sorter]] as number));
  const filtrerte = sortert.filter(m =>
    m.displayName.toLowerCase().includes(search.toLowerCase()) ||
    m.username.toLowerCase().includes(search.toLowerCase())
  );
  const topp3 = sortert.slice(0, 3);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Community Manager</h1>
          <p className="text-[10px] text-g-muted mt-0.5">{members.length} membres · data fra Supabase</p>
        </div>
        <Link href="/community-intelligence" className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded px-2 py-1 transition-colors">
          Community Intelligence →
        </Link>
      </div>

      {/* MVP */}
      {topp3.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Topp 3 — {sorter === 'xp' ? 'XP' : sorter === 'engagement' ? 'Engasjement' : sorter === 'messages' ? 'Chattere' : 'Community-score'}</p>
          <div className="grid grid-cols-3 gap-3">
            {topp3.map((m, i) => {
              const rolle = getRolle(m.level);
              return (
                <div key={m.id} onClick={() => setValgt(valgt?.id === m.id ? null : m)}
                  className="p-3 bg-g-bg border border-g-border rounded-lg cursor-pointer hover:border-g-green/30 transition-all text-center">
                  <p className={`text-xl font-black font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : 'text-orange-400'}`}>{i + 1}</p>
                  <p className="text-xs font-bold text-g-text mt-1 truncate">{m.displayName}</p>
                  <p className="text-[10px] text-g-green font-mono">
                    {sorter === 'xp' ? `${m.xp.toLocaleString()} XP` :
                     sorter === 'engagement' ? `${m.engagementScore} score` :
                     sorter === 'messages' ? `${m.messages} msg` :
                     `${m.communityScore} score`}
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

      {/* Kontroller */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Søk på navn..."
          className="flex-1 bg-g-card border border-g-border rounded-lg px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
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

      {/* Liste */}
      <div className="bg-g-card border border-g-border rounded-xl">
        {loading ? (
          <div className="p-6 text-center">
            <p className="text-xs text-g-muted animate-pulse">Laster community-data...</p>
          </div>
        ) : filtrerte.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-xs text-g-muted">
              {members.length === 0
                ? 'Ingen membres registrert ennå. Kjør SQL-migrasjonen og la boten samle data.'
                : 'Ingen treff på søket.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-g-border/30 max-h-[500px] overflow-y-auto">
            {filtrerte.map((m, i) => {
              const rolle = getRolle(m.level);
              const erValgt = valgt?.id === m.id;
              return (
                <div key={m.id}>
                  <div
                    onClick={() => setValgt(erValgt ? null : m)}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-g-bg/50 transition-all ${erValgt ? 'bg-g-green/[0.03]' : ''}`}>
                    <span className="text-[9px] text-g-muted font-mono w-5 flex-shrink-0">{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-black text-g-green">{m.displayName?.[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-g-text truncate">{m.displayName}</p>
                        {rolle && (
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border hidden sm:inline ${rolle.farge}`}>{rolle.navn}</span>
                        )}
                      </div>
                      <XPBar xp={m.xp} level={m.level} />
                    </div>
                    <div className="text-right text-[9px] text-g-muted flex-shrink-0 space-y-0.5">
                      <p className="text-g-green font-mono font-bold">{m.xp.toLocaleString()} XP</p>
                      <p>{m.messages} msg · {tidSiden(m.lastSeen)}</p>
                      {(m.engagementScore > 0 || m.communityScore > 0) && (
                        <p className="text-blue-400">{m.engagementScore}e · {m.communityScore}c</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Valgt member detail */}
      {valgt && (
        <MemberDetail m={valgt} onClose={() => setValgt(null)} />
      )}
    </div>
  );
}
