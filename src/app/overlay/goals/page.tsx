'use client';

import { useEffect, useState, useRef } from 'react';

interface Goal {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
}

const ICONS: Record<string, string> = {
  followers:   '◈',
  subscribers: '★',
  donations:   '♥',
  viewers:     '◉',
};

const FARGER: Record<string, { fill: string; glow: string }> = {
  followers:   { fill: '#00ff41', glow: 'rgba(0,255,65,0.6)' },
  subscribers: { fill: '#9b77cf', glow: 'rgba(155,119,207,0.6)' },
  donations:   { fill: '#ff7b47', glow: 'rgba(255,123,71,0.6)' },
  viewers:     { fill: '#00d4ff', glow: 'rgba(0,212,255,0.6)' },
};

function GoalBar({ goal, visible }: { goal: Goal; visible: boolean }) {
  const pct = goal.mal > 0 ? Math.min(100, (goal.gjeldende / goal.mal) * 100) : 0;
  const [renderedPct, setRenderedPct] = useState(0);
  const [counting, setCounting] = useState(false);
  const prevGjeldende = useRef(goal.gjeldende);
  const { fill, glow } = FARGER[goal.type] ?? { fill: '#00ff41', glow: 'rgba(0,255,65,0.6)' };
  const icon = ICONS[goal.type] ?? '◈';

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setRenderedPct(pct);
    }, 300);
    return () => clearTimeout(t);
  }, [pct, visible]);

  // Animate count on change
  useEffect(() => {
    if (prevGjeldende.current === goal.gjeldende) return;
    setCounting(true);
    const t = setTimeout(() => setCounting(false), 1200);
    prevGjeldende.current = goal.gjeldende;
    return () => clearTimeout(t);
  }, [goal.gjeldende]);

  const milestones = [25, 50, 75];
  const reached100 = pct >= 100;

  return (
    <div style={{
      position: 'relative',
      padding: '10px 14px',
      background: 'rgba(8, 10, 8, 0.82)',
      backdropFilter: 'blur(8px)',
      borderRadius: '6px',
      borderLeft: `3px solid ${fill}`,
      boxShadow: `inset 0 0 20px rgba(0,0,0,0.4), 0 2px 12px rgba(0,0,0,0.5)`,
      overflow: 'hidden',
    }}>
      {/* Subtle background gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(135deg, ${fill}05 0%, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      {/* Top row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '7px',
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: fill, fontFamily: 'monospace', fontWeight: 700 }}>{icon}</span>
          <span style={{
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            fontWeight: 700,
            color: 'rgba(200, 245, 200, 0.85)',
            textTransform: 'uppercase',
            letterSpacing: '0.09em',
          }}>
            {goal.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span style={{
            fontSize: '18px',
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 900,
            color: fill,
            textShadow: counting ? `0 0 12px ${fill}` : 'none',
            transition: 'text-shadow 0.3s',
          }}>
            {goal.gjeldende.toLocaleString('no-NO')}
          </span>
          <span style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: 'monospace',
            fontWeight: 400,
          }}>
            / {goal.mal.toLocaleString('no-NO')}
          </span>
          <span style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            fontWeight: 900,
            color: reached100 ? fill : 'rgba(255,255,255,0.5)',
            marginLeft: '6px',
          }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      {/* Progress track */}
      <div style={{
        position: 'relative',
        height: '8px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '4px',
        overflow: 'visible',
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
        {/* Fill bar */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: `${renderedPct}%`,
          minWidth: renderedPct > 0 ? '6px' : '0',
          borderRadius: '4px',
          background: `linear-gradient(90deg, ${fill}80 0%, ${fill} 70%, #ffffff40 100%)`,
          boxShadow: `0 0 10px ${glow}, 0 0 20px ${glow}50`,
          transition: 'width 1.6s cubic-bezier(0.22, 1, 0.36, 1)',
        }}>
          {/* Shimmer */}
          <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: '50%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
            animation: 'sweep 3s ease-in-out infinite',
          }} />

          {/* Tip glow */}
          {renderedPct > 2 && (
            <div style={{
              position: 'absolute',
              right: '-2px', top: '-3px', bottom: '-3px',
              width: '5px',
              background: fill,
              borderRadius: '3px',
              boxShadow: `0 0 8px ${fill}, 0 0 16px ${fill}`,
              animation: 'tipPulse 1.5s ease-in-out infinite',
            }} />
          )}
        </div>

        {/* Milestone ticks */}
        {milestones.map(m => (
          <div key={m} style={{
            position: 'absolute',
            left: `${m}%`,
            top: '-3px', bottom: '-3px',
            width: '1px',
            background: renderedPct >= m ? fill + '60' : 'rgba(255,255,255,0.08)',
            transition: 'background 0.5s 0.8s',
          }} />
        ))}
      </div>

      {/* 100% celebration overlay */}
      {reached100 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(90deg, transparent, ${fill}08, transparent)`,
          animation: 'celebrate 2s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      <style>{`
        @keyframes sweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @keyframes tipPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px ${fill}, 0 0 16px ${fill}; }
          50% { opacity: 0.7; box-shadow: 0 0 4px ${fill}, 0 0 8px ${fill}; }
        }
        @keyframes celebrate {
          0%, 100% { opacity: 0; transform: translateX(-100%); }
          50% { opacity: 1; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

export default function GoalsOverlay() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hent = () => {
      fetch('/api/goals/live').then(r => r.json()).then(d => {
        const aktive = (d.goals ?? []).filter((g: Goal) => g.aktiv && g.mal > 0);
        setGoals(aktive);
        if (aktive.length > 0) setTimeout(() => setVisible(true), 100);
      }).catch(() => {});
    };
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, []);

  if (goals.length === 0) return null;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: transparent !important; }
      `}</style>
      <div style={{
        width: '370px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '4px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
      }}>
        {goals.map((g, i) => (
          <div
            key={g.type}
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateX(0)' : 'translateX(-12px)',
              transition: `opacity 0.5s ease ${i * 0.12}s, transform 0.5s ease ${i * 0.12}s`,
            }}
          >
            <GoalBar goal={g} visible={visible} />
          </div>
        ))}
      </div>
    </>
  );
}
