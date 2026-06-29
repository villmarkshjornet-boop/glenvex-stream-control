'use client';

import { useEffect, useState } from 'react';

export interface GoalBar {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge?: string;
}

const FARGER: Record<string, string> = {
  followers:   '#00ff41',
  subscribers: '#9b77cf',
  donations:   '#ff7b47',
  viewers:     '#00d4ff',
};

const ICONS: Record<string, string> = {
  followers: '◈', subscribers: '★', donations: '♥', viewers: '◉',
};

function SegBar({ pct, farge, segs = 16, height = 8 }: { pct: number; farge: string; segs?: number; height?: number }) {
  const [rendered, setRendered] = useState(0);
  useEffect(() => { const t = setTimeout(() => setRendered(pct), 300); return () => clearTimeout(t); }, [pct]);
  const filled = Math.round((rendered / 100) * segs);

  return (
    <div style={{ display: 'flex', gap: '2px', height: `${height}px` }}>
      {Array.from({ length: segs }, (_, i) => {
        const f = i < filled;
        const tip = i === filled - 1;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: '2px',
            background: f ? (tip ? farge : farge + 'bb') : 'rgba(255,255,255,0.06)',
            border: `1px solid ${f ? farge + '55' : 'rgba(255,255,255,0.05)'}`,
            boxShadow: tip ? `0 0 6px ${farge}, 0 0 12px ${farge}60` : f ? `0 0 3px ${farge}30` : 'none',
            transition: `all 0.06s ease ${i * 0.025}s`,
            position: 'relative', overflow: 'hidden',
          }}>
            {f && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, transparent 100%)' }} />}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  goals: GoalBar[];
  compact?: boolean;
}

export function GoalBarsPreview({ goals, compact = false }: Props) {
  const aktive = goals.filter(g => g.aktiv && g.mal > 0);
  if (aktive.length === 0) return (
    <div style={{ padding: '16px', textAlign: 'center', color: '#3a5a3a', fontSize: '11px', fontFamily: 'monospace' }}>
      Ingen aktive mål — aktiver minst ett mål over
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '6px' }}>
      {aktive.map(g => {
        const pct = g.mal > 0 ? Math.min(100, Math.round((g.gjeldende / g.mal) * 100)) : 0;
        const farge = g.farge ?? FARGER[g.type] ?? '#00ff41';
        const icon  = ICONS[g.type] ?? '◆';

        return (
          <div key={g.type} style={{
            background: 'rgba(6, 10, 6, 0.86)',
            backdropFilter: 'blur(10px)',
            borderRadius: '5px',
            borderLeft: `3px solid ${farge}`,
            padding: compact ? '7px 10px' : '9px 12px',
            boxShadow: `0 2px 14px rgba(0,0,0,0.6), inset 0 0 24px rgba(0,0,0,0.3)`,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(110deg, ${farge}04 0%, transparent 50%)`, pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: compact ? '5px' : '7px' }}>
              <span style={{ fontSize: compact ? '9px' : '10px', color: farge }}>{icon}</span>
              <span style={{
                fontSize: compact ? '9px' : '10px', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'rgba(200,245,200,0.85)', fontFamily: 'monospace', flex: 1,
              }}>{g.label}</span>
              <span style={{ fontSize: compact ? '16px' : '18px', fontWeight: 900, color: farge, fontFamily: 'monospace', lineHeight: 1 }}>
                {g.gjeldende.toLocaleString('no-NO')}
              </span>
              <span style={{ fontSize: compact ? '9px' : '10px', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
                / {g.mal.toLocaleString('no-NO')}
              </span>
              <span style={{ fontSize: compact ? '10px' : '11px', fontWeight: 900, color: pct >= 100 ? farge : 'rgba(255,255,255,0.4)', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
            <SegBar pct={pct} farge={farge} segs={compact ? 12 : 16} height={compact ? 7 : 9} />
          </div>
        );
      })}
    </div>
  );
}
