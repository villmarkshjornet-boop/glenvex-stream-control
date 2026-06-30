'use client';

import { useEffect, useState, useRef } from 'react';

export interface GoalBar {
  type: string;
  label: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge?: string;
  icon?: string;
  manuell?: boolean;
}

export interface OverlayFx {
  preset: 'classic' | 'neon' | 'cinematic' | 'minimal';
  glow: boolean;
  scan: boolean;
  pulse: boolean;
  numberAnim: boolean;
  slideIn: boolean;
  milestone: boolean;
  scanInterval: number;   // sekunder mellom scan-linjer
  glowIntensity: 'low' | 'medium' | 'high';
}

export const DEFAULT_FX: OverlayFx = {
  preset: 'neon',
  glow: true,
  scan: true,
  pulse: true,
  numberAnim: true,
  slideIn: true,
  milestone: true,
  scanInterval: 7,
  glowIntensity: 'medium',
};

export const PRESETS: Record<OverlayFx['preset'], Partial<OverlayFx>> = {
  classic:  { glow: false, scan: false, pulse: false, numberAnim: false, slideIn: true,  milestone: false, glowIntensity: 'low'    },
  neon:     { glow: true,  scan: true,  pulse: true,  numberAnim: true,  slideIn: true,  milestone: true,  glowIntensity: 'medium' },
  cinematic:{ glow: true,  scan: true,  pulse: false, numberAnim: true,  slideIn: true,  milestone: true,  glowIntensity: 'high'   },
  minimal:  { glow: false, scan: false, pulse: false, numberAnim: false, slideIn: false, milestone: false, glowIntensity: 'low'    },
};

const FARGER: Record<string, string> = {
  followers:   '#00ff41',
  subscribers: '#9b77cf',
  donations:   '#ff7b47',
  viewers:     '#00d4ff',
};

const ICONS: Record<string, string> = {
  followers: '◈', subscribers: '★', donations: '♥', viewers: '◉',
};

const GLOW_MULT = { low: 0.5, medium: 1, high: 2 };

// ─── Animated number count-up ───────────────────────────────────────────────
function AnimNumber({ val, animate }: { val: number; animate: boolean }) {
  const [disp, setDisp] = useState(val);
  const prev = useRef(val);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animate || val === prev.current) { setDisp(val); prev.current = val; return; }
    const from = prev.current;
    const to   = val;
    const dur  = Math.min(1200, Math.abs(to - from) * 12);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisp(Math.round(from + (to - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else { prev.current = to; }
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [val, animate]);

  return <>{disp.toLocaleString('no-NO')}</>;
}

// ─── Segmented progress bar ──────────────────────────────────────────────────
function SegBar({ pct, farge, fx, segs = 16, height = 9 }: {
  pct: number; farge: string; fx: OverlayFx; segs?: number; height?: number;
}) {
  const [rendered, setRendered] = useState(0);
  const [scanning, setScanning] = useState(false);
  const mult = GLOW_MULT[fx.glowIntensity];

  useEffect(() => {
    const t = setTimeout(() => setRendered(pct), 300);
    return () => clearTimeout(t);
  }, [pct]);

  // Scan line trigger
  useEffect(() => {
    if (!fx.scan) return;
    const fire = () => { setScanning(true); setTimeout(() => setScanning(false), 900); };
    fire();
    const id = setInterval(fire, fx.scanInterval * 1000);
    return () => clearInterval(id);
  }, [fx.scan, fx.scanInterval]);

  const filled = Math.round((rendered / 100) * segs);

  return (
    <div style={{ position: 'relative', display: 'flex', gap: '2px', height: `${height}px`, overflow: 'hidden' }}>
      {Array.from({ length: segs }, (_, i) => {
        const f   = i < filled;
        const tip = i === filled - 1;
        const glow = tip
          ? `0 0 ${6 * mult}px ${farge}, 0 0 ${14 * mult}px ${farge}90`
          : f ? `0 0 ${3 * mult}px ${farge}50` : 'none';
        return (
          <div key={i} style={{
            flex: 1, borderRadius: '2px',
            background: f ? (tip ? farge : farge + 'cc') : 'rgba(255,255,255,0.055)',
            border: `1px solid ${f ? farge + '60' : 'rgba(255,255,255,0.05)'}`,
            boxShadow: glow,
            transition: `all 0.06s ease ${i * 0.025}s`,
            position: 'relative', overflow: 'hidden',
          }}>
            {f && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)' }} />}
          </div>
        );
      })}

      {/* Scan line */}
      {fx.scan && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: '40px',
          background: `linear-gradient(90deg, transparent, ${farge}cc, ${farge}, ${farge}cc, transparent)`,
          boxShadow: `0 0 ${12 * mult}px ${farge}`,
          transition: 'none',
          animation: scanning ? `scanMove 0.9s cubic-bezier(.4,0,.2,1) forwards` : 'none',
          left: '-40px',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ─── Milestone burst (100%) ───────────────────────────────────────────────────
function MilestoneBurst({ farge, show }: { farge: string; show: boolean }) {
  if (!show) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
    }}>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} style={{
          position: 'absolute', left: '50%', top: '50%',
          width: '4px', height: '4px', borderRadius: '50%', background: farge,
          boxShadow: `0 0 6px ${farge}`,
          animation: `burst${i % 3} 0.7s ease-out forwards`,
          transform: `rotate(${i * 30}deg) translateY(-40px)`,
        }} />
      ))}
    </div>
  );
}

// ─── Single goal bar (overlay + preview) ─────────────────────────────────────
export function GoalBarSingle({ goal, fx = DEFAULT_FX, compact = false, slideDelay = 0 }: {
  goal: GoalBar; fx?: OverlayFx; compact?: boolean; slideDelay?: number;
}) {
  const pct   = goal.mal > 0 ? Math.min(100, Math.round((goal.gjeldende / goal.mal) * 100)) : 0;
  const farge = goal.farge ?? FARGER[goal.type] ?? '#00ff41';
  const icon  = goal.icon ?? ICONS[goal.type] ?? '◆';
  const mult  = GLOW_MULT[fx.glowIntensity];

  const [visible, setVisible]     = useState(!fx.slideIn);
  const [celebrating, setCelebrating] = useState(false);
  const [pulseOn, setPulseOn]     = useState(false);

  // Slide-in on mount
  useEffect(() => {
    if (!fx.slideIn) return;
    const t = setTimeout(() => setVisible(true), 80 + slideDelay);
    return () => clearTimeout(t);
  }, [fx.slideIn, slideDelay]);

  // Milestone celebrate at 100%
  const prevPct = useRef(pct);
  useEffect(() => {
    if (fx.milestone && pct >= 100 && prevPct.current < 100) {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1000);
    }
    prevPct.current = pct;
  }, [pct, fx.milestone]);

  // Pulse animation clock
  useEffect(() => {
    if (!fx.pulse) return;
    const id = setInterval(() => setPulseOn(p => !p), 2200);
    return () => clearInterval(id);
  }, [fx.pulse]);

  const glowBase = fx.glow ? `0 0 ${20 * mult}px ${farge}30, 0 0 ${40 * mult}px ${farge}18` : 'none';
  const glowPulse = fx.glow && fx.pulse ? `0 0 ${30 * mult}px ${farge}60, 0 0 ${60 * mult}px ${farge}30` : glowBase;

  return (
    <div style={{
      position: 'relative',
      background: 'rgba(6,10,6,0.86)',
      backdropFilter: 'blur(10px)',
      borderRadius: '5px',
      borderLeft: `3px solid ${farge}`,
      padding: compact ? '7px 10px' : '9px 12px',
      boxShadow: `0 2px 14px rgba(0,0,0,0.6), inset 0 0 24px rgba(0,0,0,0.3), ${pulseOn ? glowPulse : glowBase}`,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(-18px)',
      transition: `opacity 0.45s ease ${slideDelay}ms, transform 0.45s ease ${slideDelay}ms, box-shadow 1.2s ease`,
      overflow: 'hidden',
    }}>
      {/* Background gradient shimmer */}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(110deg, ${farge}04 0%, transparent 50%)`, pointerEvents: 'none' }} />

      {/* Milestone burst */}
      {fx.milestone && <MilestoneBurst farge={farge} show={celebrating} />}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: compact ? '5px' : '7px', position: 'relative' }}>
        <span style={{ fontSize: compact ? '9px' : '10px', color: farge, textShadow: fx.glow ? `0 0 ${6*mult}px ${farge}` : 'none' }}>{icon}</span>
        <span style={{
          fontSize: compact ? '9px' : '10px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'rgba(200,245,200,0.85)', fontFamily: 'monospace', flex: 1,
        }}>{goal.label}</span>
        <span style={{
          fontSize: compact ? '16px' : '18px', fontWeight: 900, color: farge, fontFamily: 'monospace', lineHeight: 1,
          textShadow: fx.glow ? `0 0 ${10*mult}px ${farge}90` : 'none',
        }}>
          <AnimNumber val={goal.gjeldende} animate={fx.numberAnim} />
        </span>
        <span style={{ fontSize: compact ? '9px' : '10px', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          / {goal.mal.toLocaleString('no-NO')}
        </span>
        <span style={{
          fontSize: compact ? '10px' : '11px', fontWeight: 900,
          color: pct >= 100 ? farge : 'rgba(255,255,255,0.4)', fontFamily: 'monospace',
          minWidth: '32px', textAlign: 'right',
        }}>{pct}%</span>
      </div>

      <SegBar pct={pct} farge={farge} fx={fx} segs={compact ? 12 : 16} height={compact ? 7 : 9} />
    </div>
  );
}

// ─── Combined preview (multiple goals) ───────────────────────────────────────
interface Props {
  goals: GoalBar[];
  compact?: boolean;
  fx?: OverlayFx;
}

export function GoalBarsPreview({ goals, compact = false, fx = DEFAULT_FX }: Props) {
  const aktive = goals.filter(g => g.aktiv && g.mal > 0);
  if (aktive.length === 0) return (
    <div style={{ padding: '16px', textAlign: 'center', color: '#3a5a3a', fontSize: '11px', fontFamily: 'monospace' }}>
      Ingen aktive mål — aktiver minst ett mål over
    </div>
  );

  return (
    <>
      <FxStyles />
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '6px' }}>
        {aktive.map((g, i) => (
          <GoalBarSingle key={g.type} goal={g} fx={fx} compact={compact} slideDelay={i * 80} />
        ))}
      </div>
    </>
  );
}

// ─── CSS animation keyframes ─────────────────────────────────────────────────
export function FxStyles() {
  return (
    <style>{`
      @keyframes scanMove {
        from { left: -40px; opacity: 0; }
        15%  { opacity: 1; }
        85%  { opacity: 1; }
        to   { left: 110%; opacity: 0; }
      }
      @keyframes burst0 {
        0%   { transform: rotate(0deg) translateY(0) scale(1); opacity: 1; }
        100% { transform: rotate(0deg) translateY(-55px) scale(0); opacity: 0; }
      }
      @keyframes burst1 {
        0%   { transform: rotate(0deg) translateY(0) scale(1); opacity: 1; }
        100% { transform: rotate(0deg) translateY(-45px) translateX(20px) scale(0); opacity: 0; }
      }
      @keyframes burst2 {
        0%   { transform: rotate(0deg) translateY(0) scale(1); opacity: 1; }
        100% { transform: rotate(0deg) translateY(-35px) translateX(-20px) scale(0); opacity: 0; }
      }
    `}</style>
  );
}
