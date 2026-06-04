'use client';

import { useEffect, useState } from 'react';

interface Goal { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean; }

export default function ViewerGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([
    { type: 'followers', label: 'Følgere på Twitch', mal: 1000, gjeldende: 0, aktiv: true },
    { type: 'subscribers', label: 'Subscribers', mal: 50, gjeldende: 0, aktiv: false },
    { type: 'discord', label: 'Discord-membres', mal: 200, gjeldende: 0, aktiv: false },
  ]);
  const [live, setLive] = useState<{ followers: number; discordMembres: number } | null>(null);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postRes, setPostRes] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');

  useEffect(() => {
    fetch('/api/goals/live').then(r => r.json()).then(d => {
      setLive(d.live ?? null);
      if (d.goals?.length > 0) setGoals(d.goals);
      else if (d.live) {
        setGoals(prev => prev.map(g => {
          if (g.type === 'followers') return { ...g, gjeldende: d.live.followers };
          if (g.type === 'discord') return { ...g, gjeldende: d.live.discordMembres };
          return g;
        }));
      }
    }).catch(() => {});

    if (typeof window !== 'undefined') {
      setOverlayUrl(`${window.location.origin}/overlay/goals`);
    }
  }, []);

  async function lagre() {
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goals),
    });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function postTilDiscord() {
    setPosting(true);
    setPostRes('');
    try {
      const res = await fetch('/api/goals/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals, live }),
      });
      const data = await res.json();
      setPostRes(data.ok ? '✓ Postet til Discord!' : `✗ ${data.error}`);
    } catch (e) {
      setPostRes(`✗ ${(e as Error).message}`);
    }
    setPosting(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Viewer Goals</h1>
        <p className="text-xs text-g-muted mt-0.5">Sett mål og vis progress – automatisk henting av ekte tall</p>
      </div>

      {/* Live tall */}
      {live && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-g-card border border-g-border rounded-lg p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">Følgere nå</p>
            <p className="text-3xl font-black text-g-green font-mono mt-1">{live.followers.toLocaleString()}</p>
          </div>
          <div className="bg-g-card border border-g-border rounded-lg p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">Discord-membres nå</p>
            <p className="text-3xl font-black text-g-green font-mono mt-1">{live.discordMembres.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Goals */}
      <div className="space-y-3">
        {goals.map((g, i) => {
          const gjeldende = g.type === 'followers' ? (live?.followers ?? g.gjeldende) : g.type === 'discord' ? (live?.discordMembres ?? g.gjeldende) : g.gjeldende;
          const pct = g.mal > 0 ? Math.min(100, Math.round((gjeldende / g.mal) * 100)) : 0;

          return (
            <div key={g.type} className="bg-g-card border border-g-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={g.aktiv}
                    onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, aktiv: e.target.checked } : x))}
                    className="accent-green-400" />
                  <span className={`text-sm font-bold ${g.aktiv ? 'text-g-text' : 'text-g-muted'}`}>{g.label}</span>
                </label>
                <span className="text-g-green font-black font-mono">{pct}%</span>
              </div>

              {g.aktiv && (
                <>
                  <div className="w-full bg-g-border rounded-full h-2.5">
                    <div className="bg-g-green h-2.5 rounded-full transition-all"
                      style={{ width: `${pct}%`, boxShadow: '0 0 8px rgba(0,255,65,0.5)' }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-g-muted">
                    <span>{gjeldende.toLocaleString()} av {g.mal.toLocaleString()}</span>
                    <span>{Math.max(0, g.mal - gjeldende).toLocaleString()} igjen</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Gjeldende (auto-hentet)</label>
                      <input type="number" value={gjeldende}
                        onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, gjeldende: +e.target.value } : x))}
                        className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                    </div>
                    <div>
                      <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Mål</label>
                      <input type="number" value={g.mal}
                        onChange={e => setGoals(prev => prev.map((x, idx) => idx === i ? { ...x, mal: +e.target.value } : x))}
                        className="w-full bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* OBS Overlay */}
      {overlayUrl && (
        <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-3">
          <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">◆ OBS Browser Source</p>
          <p className="text-xs text-g-muted">Legg inn denne URL-en i OBS som Browser Source for å vise goals på stream:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-g-green font-mono bg-g-bg border border-g-border rounded px-3 py-2 truncate">{overlayUrl}</code>
            <button onClick={() => navigator.clipboard.writeText(overlayUrl)}
              className="px-3 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all whitespace-nowrap">
              Kopier
            </button>
          </div>
          <p className="text-[9px] text-g-muted">Anbefalt: 300x150px, bakgrunn transparent. Oppdateres automatisk hvert 30. sekund.</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={lagre} className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {lagret ? '✓ Lagret' : '◆ Lagre mål'}
        </button>
        <button onClick={postTilDiscord} disabled={posting} className="flex-1 py-2.5 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {posting ? 'Poster...' : 'Post til Discord'}
        </button>
      </div>
      {postRes && <p className={`text-xs font-mono ${postRes.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{postRes}</p>}
    </div>
  );
}
