'use client';

import { useEffect, useState } from 'react';

interface Goal { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean; }

const COLORS: Record<string, { main: string; dim: string }> = {
  followers:   { main: '#00ff41', dim: '#00cc33' },
  subscribers: { main: '#9b77cf', dim: '#7055aa' },
  donations:   { main: '#ff7b47', dim: '#cc5522' },
  viewers:     { main: '#00d4ff', dim: '#0099cc' },
};
const ICONS: Record<string, string> = {
  followers: '◈', subscribers: '★', donations: '♥', viewers: '◉',
};

function SegBar({ pct, main, dim, segs = 16 }: { pct: number; main: string; dim: string; segs?: number }) {
  const [rendered, setRendered] = useState(0);
  useEffect(() => { const t = setTimeout(() => setRendered(pct), 400); return () => clearTimeout(t); }, [pct]);
  const filled = Math.round((rendered / 100) * segs);

  return (
    <div style={{ display: 'flex', gap: '2px', height: '10px' }}>
      {Array.from({ length: segs }, (_, i) => {
        const f = i < filled;
        const tip = i === filled - 1;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: '1.5px',
            background: f ? (tip ? main : dim) : 'rgba(255,255,255,0.06)',
            border: `1px solid ${f ? main + '50' : 'rgba(255,255,255,0.05)'}`,
            boxShadow: tip ? `0 0 6px ${main}, 0 0 12px ${main}60` : f ? `0 0 3px ${dim}40` : 'none',
            transition: `all 0.06s ease ${i * 0.03}s`,
            position: 'relative', overflow: 'hidden',
          }}>
            {f && <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)',
            }} />}
          </div>
        );
      })}
    </div>
  );
}

function GoalRow({ g, visible, delay }: { g: Goal; visible: boolean; delay: number }) {
  const pct = g.mal > 0 ? Math.min(100, Math.round((g.gjeldende / g.mal) * 100)) : 0;
  const col = COLORS[g.type] ?? COLORS.followers;
  const icon = ICONS[g.type] ?? '◈';

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(-10px)',
      transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
    }}>
      <div style={{
        background: 'rgba(6, 10, 6, 0.85)',
        backdropFilter: 'blur(10px)',
        borderRadius: '5px',
        borderLeft: `3px solid ${col.main}`,
        padding: '9px 12px',
        boxShadow: `0 2px 14px rgba(0,0,0,0.6), inset 0 0 24px rgba(0,0,0,0.3)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle bg tint */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(110deg, ${col.main}04 0%, transparent 50%)`,
          pointerEvents: 'none',
        }} />

        {/* Row: icon + label + count */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginBottom: '7px' }}>
          <span style={{ fontSize: '10px', color: col.main, flexShrink: 0 }}>{icon}</span>
          <span style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em',
            color: 'rgba(200,245,200,0.8)', fontFamily: '"JetBrains Mono", monospace', flex: 1,
          }}>{g.label}</span>
          <span style={{ fontSize: '20px', fontWeight: 900, color: col.main, fontFamily: 'monospace', lineHeight: 1 }}>
            {g.gjeldende.toLocaleString('no-NO')}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
            / {g.mal.toLocaleString('no-NO')}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 900, color: pct >= 100 ? col.main : 'rgba(255,255,255,0.4)', fontFamily: 'monospace', minWidth: '34px', textAlign: 'right' }}>
            {pct}%
          </span>
        </div>

        {/* Segmented bar */}
        <SegBar pct={pct} main={col.main} dim={col.dim} />

        {/* 100% flash overlay */}
        {pct >= 100 && (
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(90deg, transparent, ${col.main}10, transparent)`,
            animation: 'sweep 3s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        )}
      </div>
    </div>
  );
}

export default function GoalsOverlay() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hent = () => fetch('/api/goals/live').then(r => r.json()).then(d => {
      const aktive = (d.goals ?? []).filter((g: Goal) => g.aktiv && g.mal > 0);
      setGoals(aktive);
      if (aktive.length > 0) setTimeout(() => setVisible(true), 80);
    }).catch(() => {});
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, []);

  if (goals.length === 0) return null;

  return (
    <>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:transparent!important}
        @keyframes sweep{0%,100%{opacity:0;transform:translateX(-100%)}50%{opacity:1;transform:translateX(100%)}}
      `}</style>
      <div style={{ width: '370px', display: 'flex', flexDirection: 'column', gap: '5px', padding: '3px' }}>
        {goals.map((g, i) => <GoalRow key={g.type} g={g} visible={visible} delay={i * 0.1} />)}
      </div>
    </>
  );
}
