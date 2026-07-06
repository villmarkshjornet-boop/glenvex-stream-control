'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface GoalRow {
  type: string;
  label: string;
  icon: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge?: string;
}

export function GoalsWidget() {
  const [goals, setGoals]     = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me/workspace')
      .then(r => r.json())
      .then((d: { id?: string }) => {
        const ws = d.id ?? '';
        return fetch(`/api/goals/live${ws ? `?ws=${encodeURIComponent(ws)}` : ''}`);
      })
      .then(r => r.json())
      .then(d => {
        const aktive = (d.goals ?? []).filter((g: GoalRow) => g.aktiv && g.mal > 0);
        setGoals(aktive);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (goals.length === 0) return null;

  return (
    <div style={{
      background: '#0a0e0a',
      border: '1px solid #1a2f1a',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #141f14', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 }}>
          ◈ Mål
        </span>
        <Link href="/viewer-goals" style={{ fontSize: '10px', color: '#2a4a2a', fontFamily: 'monospace', textDecoration: 'none' }}>
          Rediger →
        </Link>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {goals.map(g => {
          const farge = g.farge ?? '#00ff41';
          const pct   = Math.min(100, Math.round((g.gjeldende / g.mal) * 100));
          const igjen = Math.max(0, g.mal - g.gjeldende);
          return (
            <div key={g.type}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', color: farge }}>{g.icon ?? '◆'}</span>
                <span style={{ fontSize: '10px', color: '#7a9a7a', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>{g.label}</span>
                <span style={{ fontSize: '13px', fontWeight: 900, color: farge, fontFamily: 'monospace' }}>{g.gjeldende.toLocaleString('no-NO')}</span>
                <span style={{ fontSize: '9px', color: '#3a5a3a', fontFamily: 'monospace' }}>/ {g.mal.toLocaleString('no-NO')}</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: pct >= 100 ? farge : 'rgba(200,245,200,0.35)', fontFamily: 'monospace', minWidth: '30px', textAlign: 'right' }}>{pct}%</span>
              </div>
              {/* Progress track */}
              <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${pct}%`,
                  background: farge,
                  borderRadius: '2px',
                  boxShadow: pct > 0 ? `0 0 6px ${farge}80` : 'none',
                  transition: 'width 0.8s ease',
                }} />
              </div>
              {igjen > 0 && (
                <div style={{ fontSize: '9px', color: '#2a4a2a', fontFamily: 'monospace', marginTop: '2px' }}>
                  {igjen.toLocaleString('no-NO')} igjen
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
