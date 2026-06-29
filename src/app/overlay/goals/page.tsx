'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoalBarsPreview, type GoalBar } from '@/components/GoalBars';

export default function GoalsOverlay() {
  const params     = useSearchParams();
  const wsParam    = params.get('ws') ?? '';
  const [goals, setGoals] = useState<GoalBar[]>([]);
  const [visible, setVisible] = useState(false);

  const hent = useCallback(() => {
    const url = wsParam ? `/api/goals/live?ws=${encodeURIComponent(wsParam)}` : '/api/goals/live';
    fetch(url).then(r => r.json()).then(d => {
      const aktive = (d.goals ?? []).filter((g: GoalBar) => g.aktiv && g.mal > 0);
      setGoals(aktive);
      if (aktive.length > 0) setTimeout(() => setVisible(true), 80);
    }).catch(() => {});
  }, [wsParam]);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, [hent]);

  if (goals.length === 0) return null;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: transparent !important; }
      `}</style>
      <div style={{
        width: '370px', padding: '3px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        <GoalBarsPreview goals={goals} />
      </div>
    </>
  );
}
