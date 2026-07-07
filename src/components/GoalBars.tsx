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
  preset: 'classic' | 'neon' | 'cinematic' | 'minimal' | 'ghost';
  glow: boolean;
  scan: boolean;
  pulse: boolean;
  numberAnim: boolean;
  slideIn: boolean;
  milestone: boolean;
  scanInterval: number;
  glowIntensity: 'low' | 'medium' | 'high';
  // new
  transparent: boolean;    // frameless — no bar background/blur
  depth3d: boolean;        // 3D perspective tilt + shadow
  float: boolean;          // subtle floating animation
  showMs: number;          // ms overlay is visible (default 25000)
  hiddenMs: number;        // ms overlay is hidden (default 10000)
  fadeMs: number;          // ms for fade in/out (default 900)
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
  transparent: false,
  depth3d: false,
  float: false,
  showMs: 25_000,
  hiddenMs: 10_000,
  fadeMs: 900,
};

export const PRESETS: Record<OverlayFx['preset'], Partial<OverlayFx>> = {
  classic:  { glow: false, scan: false, pulse: false, numberAnim: false, slideIn: true,  milestone: false, glowIntensity: 'low',    transparent: false, depth3d: false, float: false },
  neon:     { glow: true,  scan: true,  pulse: true,  numberAnim: true,  slideIn: true,  milestone: true,  glowIntensity: 'medium', transparent: false, depth3d: false, float: false },
  cinematic:{ glow: true,  scan: true,  pulse: false, numberAnim: true,  slideIn: true,  milestone: true,  glowIntensity: 'high',   transparent: false, depth3d: true,  float: false },
  minimal:  { glow: false, scan: false, pulse: false, numberAnim: false, slideIn: false, milestone: false, glowIntensity: 'low',    transparent: true,  depth3d: false, float: false },
  // ghost = full neon effects on a transparent background — for OBS overlays
  ghost:    { glow: true,  scan: true,  pulse: true,  numberAnim: true,  slideIn: true,  milestone: true,  glowIntensity: 'medium', transparent: true,  depth3d: false, float: true  },
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

      {fx.scan && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: '40px',
          background: `linear-gradient(90deg, transparent, ${farge}cc, ${farge}, ${farge}cc, transparent)`,
          boxShadow: `0 0 ${12 * mult}px ${farge}`,
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
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
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

  const [visible, setVisible]         = useState(!fx.slideIn);
  const [celebrating, setCelebrating] = useState(false);
  const [pulseOn, setPulseOn]         = useState(false);

  useEffect(() => {
    if (!fx.slideIn) return;
    const t = setTimeout(() => setVisible(true), 80 + slideDelay);
    return () => clearTimeout(t);
  }, [fx.slideIn, slideDelay]);

  const prevPct = useRef(pct);
  useEffect(() => {
    if (fx.milestone && pct >= 100 && prevPct.current < 100) {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1000);
    }
    prevPct.current = pct;
  }, [pct, fx.milestone]);

  useEffect(() => {
    if (!fx.pulse) return;
    const id = setInterval(() => setPulseOn(p => !p), 2200);
    return () => clearInterval(id);
  }, [fx.pulse]);

  const glowBase  = fx.glow ? `0 0 ${20 * mult}px ${farge}30, 0 0 ${40 * mult}px ${farge}18` : 'none';
  const glowPulse = fx.glow && fx.pulse ? `0 0 ${30 * mult}px ${farge}60, 0 0 ${60 * mult}px ${farge}30` : glowBase;

  const bg = fx.transparent
    ? 'transparent'
    : 'rgba(4,7,4,0.72)';

  const shadowParts = [
    fx.transparent ? null : '0 2px 18px rgba(0,0,0,0.55)',
    fx.transparent ? null : 'inset 0 0 32px rgba(0,0,0,0.25)',
    pulseOn ? glowPulse : glowBase,
    fx.depth3d ? `0 8px 24px rgba(0,0,0,0.6), 0 16px 48px rgba(0,0,0,0.3)` : null,
  ].filter(Boolean).join(', ');

  const depth3dTransform = fx.depth3d
    ? `perspective(600px) rotateX(3deg) rotateY(-1deg)`
    : undefined;

  const barEl = (
    <div style={{
      position: 'relative',
      background: bg,
      backdropFilter: fx.transparent ? 'none' : 'blur(16px)',
      borderRadius: fx.transparent ? '0' : '5px',
      borderLeft: fx.transparent ? `2px solid ${farge}` : `3px solid ${farge}`,
      borderBottom: fx.depth3d && !fx.transparent ? `1px solid ${farge}20` : undefined,
      padding: compact ? '7px 10px' : '9px 12px',
      boxShadow: shadowParts || 'none',
      opacity: visible ? 1 : 0,
      transform: [
        visible ? undefined : 'translateX(-18px)',
        depth3dTransform,
      ].filter(Boolean).join(' ') || undefined,
      transition: `opacity 0.45s ease ${slideDelay}ms, transform 0.45s ease ${slideDelay}ms, box-shadow 1.2s ease`,
      overflow: 'hidden',
      transformOrigin: 'center top',
    }}>
      {!fx.transparent && (
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(110deg, ${farge}06 0%, transparent 45%)`, pointerEvents: 'none' }} />
      )}

      {fx.glow && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
          background: `linear-gradient(90deg, transparent 0%, ${farge}80 40%, ${farge} 50%, ${farge}80 60%, transparent 100%)`,
          animation: 'gleamSweep 6s ease-in-out infinite',
          opacity: 0.7,
          pointerEvents: 'none',
        }} />
      )}

      {fx.depth3d && !fx.transparent && (
        <div style={{
          position: 'absolute', bottom: '-6px', left: '4px', right: '4px', height: '6px',
          background: `linear-gradient(180deg, ${farge}15, transparent)`,
          filter: 'blur(4px)',
          pointerEvents: 'none',
        }} />
      )}

      {fx.milestone && <MilestoneBurst farge={farge} show={celebrating} />}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: compact ? '5px' : '7px', position: 'relative' }}>
        <span style={{ fontSize: compact ? '9px' : '10px', color: farge, textShadow: fx.glow ? `0 0 ${6*mult}px ${farge}` : 'none' }}>{icon}</span>
        <span style={{
          fontSize: compact ? '9px' : '10px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: fx.transparent ? `${farge}cc` : 'rgba(200,245,200,0.85)',
          fontFamily: 'monospace', flex: 1,
          textShadow: fx.transparent && fx.glow ? `0 0 8px ${farge}80` : undefined,
        }}>{goal.label}</span>
        <span style={{
          fontSize: compact ? '16px' : '18px', fontWeight: 900, color: farge, fontFamily: 'monospace', lineHeight: 1,
          textShadow: fx.glow ? `0 0 ${10*mult}px ${farge}90` : 'none',
        }}>
          <AnimNumber val={goal.gjeldende} animate={fx.numberAnim} />
        </span>
        <span style={{ fontSize: compact ? '9px' : '10px', color: fx.transparent ? `${farge}60` : 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          / {goal.mal.toLocaleString('no-NO')}
        </span>
        <span style={{
          fontSize: compact ? '10px' : '11px', fontWeight: 900,
          color: pct >= 100 ? farge : fx.transparent ? `${farge}80` : 'rgba(255,255,255,0.4)',
          fontFamily: 'monospace', minWidth: '32px', textAlign: 'right',
        }}>{pct}%</span>
      </div>

      <SegBar pct={pct} farge={farge} fx={fx} segs={compact ? 12 : 16} height={compact ? 7 : 9} />
    </div>
  );

  // Float animation on a wrapper so it doesn't conflict with the inner transform transition
  if (fx.float) {
    return <div style={{ animation: 'floatY 4s ease-in-out infinite' }}>{barEl}</div>;
  }
  return barEl;
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
      @keyframes gleamSweep {
        0%   { transform: translateX(-120%); opacity: 0; }
        10%  { opacity: 1; }
        90%  { opacity: 1; }
        100% { transform: translateX(220%); opacity: 0; }
      }
      @keyframes floatY {
        0%   { transform: translateY(0px); }
        50%  { transform: translateY(-5px); }
        100% { transform: translateY(0px); }
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
