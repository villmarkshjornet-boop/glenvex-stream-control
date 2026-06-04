'use client';

import { useEffect, useState } from 'react';

interface Goal { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean; }

export default function GoalsOverlay() {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const hent = () => {
      fetch('/api/goals/live').then(r => r.json()).then(d => {
        setGoals(d.goals?.filter((g: Goal) => g.aktiv && g.mal > 0) ?? []);
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
      padding: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: '320px',
    }}>
      {aktive.map(g => {
        const pct = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
        return (
          <div key={g.type} style={{
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            borderRadius: '6px',
            padding: '8px 12px',
            borderLeft: '3px solid #00ff41',
          }}>
            {/* Label + tall */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '5px',
            }}>
              <span style={{
                color: 'rgba(255,255,255,0.75)',
                fontSize: '11px',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 'bold',
              }}>
                {g.label}
              </span>
              <span style={{
                color: '#00ff41',
                fontSize: '13px',
                fontFamily: 'monospace',
                fontWeight: 'bold',
              }}>
                {g.gjeldende.toLocaleString('no-NO')}
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', fontWeight: 'normal' }}>
                  {' '}/ {g.mal.toLocaleString('no-NO')}
                </span>
              </span>
            </div>

            {/* Progress bar */}
            <div style={{
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '3px',
              height: '5px',
              overflow: 'hidden',
            }}>
              <div style={{
                background: 'linear-gradient(90deg, #00ff41 0%, #00cc33 100%)',
                height: '100%',
                width: `${pct}%`,
                borderRadius: '3px',
                boxShadow: '0 0 6px rgba(0,255,65,0.7)',
                transition: 'width 1.5s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
