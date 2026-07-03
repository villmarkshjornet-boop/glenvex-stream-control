'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoalBarsPreview, GoalBarSingle, FxStyles, type GoalBar, type OverlayFx, DEFAULT_FX } from '@/components/GoalBars';

export default function GoalsOverlay() {
  const params    = useSearchParams();
  const wsParam   = params.get('ws')   ?? '';
  const goalParam = params.get('goal') ?? ''; // enkelt bar hvis satt

  const [goals, setGoals] = useState<GoalBar[]>([]);
  const [fx, setFx]       = useState<OverlayFx>(DEFAULT_FX);

  const hent = useCallback(() => {
    const url = wsParam ? `/api/goals/live?ws=${encodeURIComponent(wsParam)}` : '/api/goals/live';
    fetch(url).then(r => r.json()).then(d => {
      const aktive = (d.goals ?? []).filter((g: GoalBar) => g.aktiv && g.mal > 0);
      setGoals(aktive);
      if (d.fx) setFx({ ...DEFAULT_FX, ...d.fx });
    }).catch(() => {});
  }, [wsParam]);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 20_000);
    return () => clearInterval(id);
  }, [hent]);

  const visGoals = goalParam
    ? goals.filter(g => g.type === goalParam)
    : goals;

  if (visGoals.length === 0) return <div style={{ background: 'transparent' }} />;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: transparent !important; }
      `}</style>
      <FxStyles />
      <div style={{ width: '370px', padding: '3px' }}>
        {goalParam
          ? <GoalBarSingle goal={visGoals[0]} fx={fx} />
          : <GoalBarsPreview goals={visGoals} fx={fx} />
        }
      </div>
    </>
  );
}
