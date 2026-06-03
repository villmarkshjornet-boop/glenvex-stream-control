'use client';

import { useEffect, useState } from 'react';

interface Target {
  username: string;
  login: string;
  viewers: number;
  game: string;
  title: string;
  url: string;
  score: number;
  grunn: string;
}

export default function RaidManagerPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [game, setGame] = useState('');

  useEffect(() => {
    fetch('/api/raid-targets').then(r => r.json()).then(d => {
      setTargets(d.targets ?? []);
      setIsLive(d.currentGame != null);
      setGame(d.currentGame ?? '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Raid Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">AI-anbefalte raid-mål basert på kategori, størrelse og match-score</p>
      </div>

      {!isLive && !loading && (
        <div className="bg-g-card border border-g-border rounded-lg p-6 text-center">
          <p className="text-xs text-g-muted">Du er ikke live akkurat nå. Start en stream for å se raid-anbefalinger.</p>
        </div>
      )}

      {loading && (
        <div className="bg-g-card border border-g-border rounded-lg p-6 text-center">
          <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
          <p className="text-xs text-g-muted mt-2">Henter raid-mål...</p>
        </div>
      )}

      {targets.length > 0 && (
        <>
          <p className="text-xs text-g-muted">Kategori: <span className="text-g-green font-semibold">{game}</span></p>
          <div className="space-y-3">
            {targets.map((t, i) => (
              <div key={t.login} className="bg-g-card border border-g-border rounded-lg p-4 space-y-2 hover:border-g-green/20 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-g-green font-black font-mono text-sm">{i + 1}</span>
                      <p className="text-sm font-bold text-g-text">{t.username}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${t.score >= 80 ? 'text-g-green border-g-green/30 bg-g-green/10' : t.score >= 60 ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' : 'text-g-muted border-g-border bg-g-bg'}`}>
                        {t.score}% match
                      </span>
                    </div>
                    <p className="text-xs text-g-muted mt-0.5 truncate max-w-xs">{t.title}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-g-green font-mono">{t.viewers.toLocaleString()}</p>
                    <p className="text-[10px] text-g-muted">seere</p>
                  </div>
                </div>
                {t.grunn && <p className="text-xs text-g-muted italic">{t.grunn}</p>}
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  className="inline-block text-xs text-g-green hover:underline">
                  twitch.tv/{t.login} ↗
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
