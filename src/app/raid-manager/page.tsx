'use client';

import { useEffect, useState, useCallback } from 'react';

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
  const [refreshing, setRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [game, setGame] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTargets = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const d = await fetch('/api/raid-targets').then(r => r.json());
      setTargets(d.targets ?? []);
      setIsLive(d.currentGame != null);
      setGame(d.currentGame ?? '');
      setLastUpdated(new Date());
    } catch {}
    setLoading(false);
    if (isManual) setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchTargets();
    // Auto-refresh every 60s when live, every 5 min when offline
    const id = setInterval(() => fetchTargets(), isLive ? 60_000 : 5 * 60_000);
    return () => clearInterval(id);
  }, [fetchTargets, isLive]);

  function tidSiden(d: Date): string {
    const sek = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sek < 60) return 'akkurat nå';
    return `${Math.floor(sek / 60)}m siden`;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Raid Manager</h1>
          <p className="text-xs text-g-muted mt-0.5">AI-anbefalte raid-mål basert på kategori, størrelse og match-score</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <p className="text-[9px] text-g-muted/50">Oppdatert {tidSiden(lastUpdated)}</p>
          )}
          <button
            onClick={() => fetchTargets(true)}
            disabled={refreshing || loading}
            className={`px-2.5 py-1.5 border rounded text-[9px] transition-all ${
              refreshing ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
            }`}
          >
            {refreshing ? '↻ Laster...' : '↻ Oppdater'}
          </button>
        </div>
      </div>

      {!isLive && !loading && (
        <div className="bg-g-card border border-g-border rounded-lg p-6 text-center">
          <p className="text-xs text-g-muted">Du er ikke live akkurat nå.</p>
          <p className="text-[9px] text-g-muted/60 mt-1">Oppdaterer automatisk hvert 5. minutt.</p>
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
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <p className="text-xs text-g-muted">Live i: <span className="text-g-green font-semibold">{game}</span></p>
            <span className="text-[9px] text-g-muted/40">· Oppdateres hvert 60s</span>
          </div>
          <div className="space-y-3">
            {targets.map((t, i) => (
              <div key={t.login} className={`bg-g-card border rounded-lg p-4 space-y-2 hover:border-g-green/20 transition-all ${i === 0 ? 'border-g-green/40' : 'border-g-border'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-black font-mono ${i === 0 ? 'text-g-green' : 'text-g-muted'}`}>{i + 1}</span>
                      {i === 0 && <span className="text-[9px] px-1.5 py-0.5 bg-g-green/10 border border-g-green/30 rounded text-g-green font-bold">TOPP ANBEFALING</span>}
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
