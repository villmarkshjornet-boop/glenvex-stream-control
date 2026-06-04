'use client';

import { useEffect, useState } from 'react';

interface Goal { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean; }

export default function GoalsOverlay() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [live, setLive] = useState<{ followers: number; discordMembres: number } | null>(null);

  useEffect(() => {
    const hent = () => {
      fetch('/api/goals/live').then(r => r.json()).then(d => {
        setGoals(d.goals?.filter((g: Goal) => g.aktiv && g.mal > 0) ?? []);
        setLive(d.live ?? null);
      }).catch(() => {});
    };
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, []);

  const aktive = goals.filter(g => g.aktiv && g.mal > 0);
  if (aktive.length === 0) return null;

  return (
    <div style={{
      background: 'transparent',
      fontFamily: 'monospace',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      minWidth: '280px',
    }}>
      {aktive.map(g => {
        const pct = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
        return (
          <div key={g.type} style={{ background: 'rgba(0,0,0,0.75)', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid #00ff41' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{g.label}</span>
              <span style={{ color: '#00ff41', fontSize: '13px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                {g.gjeldende.toLocaleString()} / {g.mal.toLocaleString()}
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
              <div style={{
                background: 'linear-gradient(90deg, #00ff41, #00aa2a)',
                height: '100%',
                width: `${pct}%`,
                borderRadius: '4px',
                transition: 'width 1s ease',
                boxShadow: '0 0 8px rgba(0,255,65,0.6)',
              }} />
            </div>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', marginTop: '3px', display: 'block' }}>
              {pct}% – {(g.mal - g.gjeldende).toLocaleString()} igjen
            </span>
          </div>
        );
      })}
    </div>
  );
}
