'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoalBarsPreview, GoalBarSingle, FxStyles, type GoalBar, type OverlayFx, DEFAULT_FX } from '@/components/GoalBars';

type Phase = 'visible' | 'fading-out' | 'hidden' | 'fading-in';

const PHASE_NEXT: Record<Phase, Phase> = {
  'visible':    'fading-out',
  'fading-out': 'hidden',
  'hidden':     'fading-in',
  'fading-in':  'visible',
};

export default function GoalsOverlay() {
  const params    = useSearchParams();
  const wsParam   = params.get('ws')   ?? '';
  const goalParam = params.get('goal') ?? '';

  const [goals, setGoals] = useState<GoalBar[]>([]);
  const [fx, setFx]       = useState<OverlayFx>(DEFAULT_FX);
  const [phase, setPhase] = useState<Phase>('visible');

  const hent = useCallback(() => {
    const url = wsParam ? `/api/goals/live?ws=${encodeURIComponent(wsParam)}` : '/api/goals/live';
    fetch(url).then(r => r.json()).then(d => {
      const allGoals = (d.goals ?? []).filter((g: GoalBar) => g.mal > 0);
      // When a specific goal is requested via ?goal=, include it even if inactive
      const filtered = goalParam
        ? allGoals.filter((g: GoalBar) => g.type === goalParam)
        : allGoals.filter((g: GoalBar) => g.aktiv);
      setGoals(filtered);
      if (d.fx) setFx({ ...DEFAULT_FX, ...d.fx });
    }).catch(() => {});
  }, [wsParam, goalParam]);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 20_000);
    return () => clearInterval(id);
  }, [hent]);

  // Fade-syklus med timing fra fx-innstillinger
  const showMs   = fx.showMs   ?? 25_000;
  const hiddenMs = fx.hiddenMs ?? 10_000;
  const fadeMs   = fx.fadeMs   ?? 900;

  const PHASE_DELAY: Record<Phase, number> = {
    'visible':    showMs,
    'fading-out': fadeMs,
    'hidden':     hiddenMs,
    'fading-in':  fadeMs,
  };

  useEffect(() => {
    const id = setTimeout(() => setPhase(PHASE_NEXT[phase]), PHASE_DELAY[phase]);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, showMs, hiddenMs, fadeMs]);

  const isHidden   = phase === 'hidden';
  const isFading   = phase === 'fading-out' || phase === 'fading-in';
  const opacity    = (phase === 'visible' || phase === 'fading-in') ? 1 : 0;
  const transition = isFading ? `opacity ${fadeMs}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none';

  if (goals.length === 0) return <div style={{ background: 'transparent' }} />;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: transparent !important; overflow: hidden; }
      `}</style>
      <FxStyles />
      <div style={{
        width: '370px',
        padding: '3px',
        opacity,
        transition,
        pointerEvents: isHidden ? 'none' : 'auto',
        willChange: isFading ? 'opacity' : 'auto',
      }}>
        {goalParam
          ? <GoalBarSingle goal={goals[0]} fx={fx} />
          : <GoalBarsPreview goals={goals} fx={fx} />
        }
      </div>
    </>
  );
}
