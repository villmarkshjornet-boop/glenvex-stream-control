'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoalBarsPreview, GoalBarSingle, FxStyles, type GoalBar, type OverlayFx, DEFAULT_FX } from '@/components/GoalBars';

const SHOW_MS   = 25_000; // 25s synlig
const FADE_MS   = 900;    // 0.9s fade ut / inn
const HIDDEN_MS = 10_000; // 10s usynlig

type Phase = 'visible' | 'fading-out' | 'hidden' | 'fading-in';

const PHASE_DELAY: Record<Phase, number> = {
  'visible':    SHOW_MS,
  'fading-out': FADE_MS,
  'hidden':     HIDDEN_MS,
  'fading-in':  FADE_MS,
};
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

  // Fade-syklus: synlig 25s → fade ut 0.9s → skjult 10s → fade inn 0.9s → gjenta
  useEffect(() => {
    const id = setTimeout(() => setPhase(PHASE_NEXT[phase]), PHASE_DELAY[phase]);
    return () => clearTimeout(id);
  }, [phase]);

  const visGoals = goalParam ? goals.filter(g => g.type === goalParam) : goals;

  // Beregn opacity og transition ut fra fase
  const isHidden   = phase === 'hidden';
  const isFading   = phase === 'fading-out' || phase === 'fading-in';
  const opacity    = (phase === 'visible' || phase === 'fading-in') ? 1 : 0;
  const transition = isFading ? `opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none';

  if (visGoals.length === 0) return <div style={{ background: 'transparent' }} />;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: transparent !important; }
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
          ? <GoalBarSingle goal={visGoals[0]} fx={fx} />
          : <GoalBarsPreview goals={visGoals} fx={fx} />
        }
      </div>
    </>
  );
}
