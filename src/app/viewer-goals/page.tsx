'use client';

import { useEffect, useState } from 'react';
import { PageHeader, ProgressBar } from '@/components/ui';

interface Goal { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean; }

export default function ViewerGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([
    { type: 'followers', label: 'Følgere', mal: 1000, gjeldende: 0, aktiv: true },
    { type: 'subscribers', label: 'Subscribers', mal: 50, gjeldende: 0, aktiv: true },
    { type: 'discord', label: 'Discord-membres', mal: 200, gjeldende: 0, aktiv: false },
  ]);
  const [live, setLive] = useState<{ followers: number; subscribers: number; harSubData: boolean } | null>(null);
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
      <PageHeader title="Viewer Goals" subtitle="Sett mål og vis progress — automatisk henting av ekte tall" />

      {/* Live tall */}
      {live && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-g-card border border-g-border rounded-2xl p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Følgere nå</p>
            <p className="text-3xl font-black text-g-green font-mono mt-1">{live.followers.toLocaleString()}</p>
          </div>
          <div className="bg-g-card border border-g-border rounded-2xl p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">Subscribers nå</p>
            {live.harSubData ? (
              <p className="text-3xl font-black text-g-green font-mono mt-1">{live.subscribers.toLocaleString()}</p>
            ) : (
              <p className="text-sm text-g-muted mt-1 leading-tight">Krever Affiliate<br/>+ bruker-token</p>
            )}
          </div>
        </div>
      )}

      {/* Goals */}
      <div className="space-y-3">
        {goals.map((g, i) => {
          const gjeldende = g.type === 'followers' ? (live?.followers ?? g.gjeldende) : g.type === 'subscribers' ? (live?.harSubData ? (live?.subscribers ?? g.gjeldende) : g.gjeldende) : g.gjeldende;
          const pct = g.mal > 0 ? Math.min(100, Math.round((gjeldende / g.mal) * 100)) : 0;

          return (
            <div key={g.type} className="bg-g-card border border-g-border rounded-2xl p-5 space-y-4">
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
                  <ProgressBar value={pct} max={100} color="green" size="md" showGlow />
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
        <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-4">
          <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">OBS Browser Source</p>

          {/* Preview */}
          <div className="space-y-2">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">Forhåndsvisning</p>
            <div className="bg-gray-900 rounded-lg overflow-hidden border border-g-border" style={{ height: '160px', position: 'relative' }}>
              <div style={{
                backgroundImage: 'repeating-conic-gradient(#1a1a2e 0% 25%, transparent 0% 50%) 0 0 / 20px 20px',
                position: 'absolute', inset: 0, opacity: 0.5
              }} />
              <iframe
                src={overlayUrl}
                className="relative z-10"
                style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
                title="Goals overlay preview"
              />
            </div>
            <p className="text-[9px] text-g-muted">Rutemønsteret viser transparent bakgrunn – slik ser det ut i OBS over stream.</p>
          </div>

          {/* URL */}
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Browser Source URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-g-green font-mono bg-g-bg border border-g-border rounded px-3 py-2 truncate">{overlayUrl}</code>
              <button onClick={() => navigator.clipboard.writeText(overlayUrl)}
                className="px-3 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all whitespace-nowrap">
                Kopier
              </button>
            </div>
            <p className="text-[9px] text-g-muted mt-1">OBS: 300×150px, huk av "Transparent bakgrunn". Oppdaterer hvert 30. sek.</p>
          </div>
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
