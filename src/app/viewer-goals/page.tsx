'use client';

import { useEffect, useState, useRef } from 'react';

interface Goal {
  type: string;
  label: string;
  icon: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge: string;
  manuell?: boolean;
}

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',    label: 'Følgere',     icon: '◈', mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', manuell: false },
  { type: 'subscribers',  label: 'Subscribers', icon: '★', mal: 10,   gjeldende: 0, aktiv: false, farge: '#7b5ea7', manuell: false },
  { type: 'donations',    label: 'Donasjoner',  icon: '♥', mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff6b35', manuell: true  },
];

function AnimatedCount({ value, farge }: { value: number; farge: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    const diff = end - start;
    const steps = 30;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplay(Math.round(start + diff * (i / steps)));
      if (i >= steps) { clearInterval(id); prevRef.current = end; }
    }, 30);
    return () => clearInterval(id);
  }, [value]);

  return (
    <span style={{ color: farge, fontFamily: 'JetBrains Mono, monospace', fontWeight: 900 }}>
      {display.toLocaleString('no-NO')}
    </span>
  );
}

function CinematicProgressBar({ pct, farge, label }: { pct: number; farge: string; label: string }) {
  const [rendered, setRendered] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setRendered(pct), 200);
    return () => clearTimeout(t);
  }, [pct]);

  const glowColor = farge + '55';
  const milestone = pct >= 100 ? '100%' : pct >= 75 ? '75%' : pct >= 50 ? '50%' : pct >= 25 ? '25%' : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Track */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '4px',
        height: '10px',
        overflow: 'visible',
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Fill */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: `${rendered}%`,
          borderRadius: '4px',
          background: `linear-gradient(90deg, ${farge}99 0%, ${farge} 60%, ${farge}dd 100%)`,
          boxShadow: `0 0 12px ${glowColor}, 0 0 24px ${glowColor}`,
          transition: 'width 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}>
          {/* Shimmer sweep */}
          <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: '40%',
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)`,
            animation: 'shimmerSweep 2.5s ease-in-out infinite',
          }} />
          {/* Bright tip */}
          {rendered > 0 && (
            <div style={{
              position: 'absolute',
              right: '-1px', top: '-2px', bottom: '-2px',
              width: '4px',
              background: farge,
              borderRadius: '2px',
              boxShadow: `0 0 8px ${farge}, 0 0 16px ${farge}`,
            }} />
          )}
        </div>

        {/* Milestone ticks */}
        {[25, 50, 75].map(tick => (
          <div key={tick} style={{
            position: 'absolute',
            left: `${tick}%`,
            top: '-2px', bottom: '-2px',
            width: '1px',
            background: rendered >= tick ? farge + '80' : 'rgba(255,255,255,0.1)',
            transition: 'background 0.5s',
          }} />
        ))}
      </div>

      {/* Milestone badge */}
      {milestone && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '-22px',
          background: farge,
          color: '#000',
          fontSize: '9px',
          fontWeight: 900,
          fontFamily: 'monospace',
          padding: '1px 5px',
          borderRadius: '3px',
          letterSpacing: '0.05em',
          animation: 'milestoneGlow 2s ease-in-out infinite',
        }}>
          {milestone}
        </div>
      )}

      <style>{`
        @keyframes shimmerSweep {
          0% { transform: translateX(-100%); opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { transform: translateX(200%); opacity: 0.3; }
        }
        @keyframes milestoneGlow {
          0%, 100% { box-shadow: 0 0 4px currentColor; }
          50% { box-shadow: 0 0 12px currentColor; }
        }
      `}</style>
    </div>
  );
}

function GoalCard({ goal, index, onUpdate, liveFollowers, liveSubscribers }: {
  goal: Goal;
  index: number;
  onUpdate: (i: number, updates: Partial<Goal>) => void;
  liveFollowers: number | null;
  liveSubscribers: number | null;
}) {
  const [editingMal, setEditingMal] = useState(false);
  const [malInput, setMalInput] = useState(String(goal.mal));

  const gjeldende = goal.type === 'followers' && liveFollowers !== null
    ? liveFollowers
    : goal.type === 'subscribers' && liveSubscribers !== null
    ? liveSubscribers
    : goal.gjeldende;

  const pct = goal.mal > 0 ? Math.min(100, Math.round((gjeldende / goal.mal) * 100)) : 0;
  const igjen = Math.max(0, goal.mal - gjeldende);

  return (
    <div style={{
      background: goal.aktiv
        ? `linear-gradient(135deg, #0d1117 0%, #0d1117 60%, ${goal.farge}08 100%)`
        : '#0d1117',
      border: `1px solid ${goal.aktiv ? goal.farge + '30' : '#1a2f1a'}`,
      borderRadius: '12px',
      padding: '20px 22px',
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow when active */}
      {goal.aktiv && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at top right, ${goal.farge}06, transparent 60%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: goal.aktiv ? '16px' : '0' }}>
        {/* Toggle */}
        <button
          onClick={() => onUpdate(index, { aktiv: !goal.aktiv })}
          style={{
            width: '20px', height: '20px',
            borderRadius: '4px',
            border: `2px solid ${goal.aktiv ? goal.farge : '#1a2f1a'}`,
            background: goal.aktiv ? goal.farge + '20' : 'transparent',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px',
            color: goal.aktiv ? goal.farge : '#4a6a4a',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
        >
          {goal.aktiv ? '✓' : ''}
        </button>

        {/* Icon + Label */}
        <span style={{ fontSize: '16px', color: goal.aktiv ? goal.farge : '#4a6a4a' }}>{goal.icon}</span>
        <span style={{
          fontSize: '13px', fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: goal.aktiv ? '#c8f5c8' : '#4a6a4a',
          flex: 1,
        }}>{goal.label}</span>

        {/* Current count (large) */}
        {goal.aktiv && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '28px', lineHeight: 1 }}>
              <AnimatedCount value={gjeldende} farge={goal.farge} />
            </div>
            <div style={{ fontSize: '10px', color: '#4a6a4a', fontFamily: 'monospace', marginTop: '2px' }}>
              av {goal.mal.toLocaleString('no-NO')}
            </div>
          </div>
        )}

        {/* Pct badge */}
        {goal.aktiv && (
          <div style={{
            fontFamily: 'monospace', fontWeight: 900, fontSize: '15px',
            color: pct >= 100 ? goal.farge : '#c8f5c8',
            minWidth: '46px', textAlign: 'right',
          }}>
            {pct}%
          </div>
        )}
      </div>

      {/* Progress section */}
      {goal.aktiv && (
        <>
          <CinematicProgressBar pct={pct} farge={goal.farge} label={goal.label} />

          {/* Stats row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', marginBottom: '14px' }}>
            <span style={{ fontSize: '11px', color: '#4a6a4a', fontFamily: 'monospace' }}>
              {igjen.toLocaleString('no-NO')} igjen
            </span>
            {goal.type === 'followers' && liveFollowers !== null && (
              <span style={{ fontSize: '10px', color: '#4a6a4a' }}>● Live</span>
            )}
            {goal.manuell && (
              <span style={{ fontSize: '10px', color: '#4a6a4a' }}>Manuell</span>
            )}
          </div>

          {/* Edit row */}
          <div style={{ display: 'flex', gap: '12px' }}>
            {/* Gjeldende — editable only for manual */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: '#4a6a4a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                {goal.manuell ? 'Gjeldende (rediger)' : 'Gjeldende (auto)'}
              </div>
              <input
                type="number"
                value={gjeldende}
                disabled={!goal.manuell}
                onChange={e => goal.manuell && onUpdate(index, { gjeldende: +e.target.value })}
                style={{
                  width: '100%',
                  background: goal.manuell ? '#050505' : '#080c08',
                  border: `1px solid ${goal.manuell ? goal.farge + '30' : '#1a2f1a'}`,
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '12px',
                  color: goal.manuell ? '#c8f5c8' : '#4a6a4a',
                  fontFamily: 'monospace',
                  outline: 'none',
                  cursor: goal.manuell ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Mål */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: '#4a6a4a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Mål
              </div>
              {editingMal ? (
                <input
                  type="number"
                  value={malInput}
                  autoFocus
                  onChange={e => setMalInput(e.target.value)}
                  onBlur={() => {
                    const v = Math.max(1, parseInt(malInput) || goal.mal);
                    onUpdate(index, { mal: v });
                    setMalInput(String(v));
                    setEditingMal(false);
                  }}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  style={{
                    width: '100%',
                    background: '#050505',
                    border: `1px solid ${goal.farge}60`,
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    color: '#c8f5c8',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
              ) : (
                <button
                  onClick={() => { setMalInput(String(goal.mal)); setEditingMal(true); }}
                  style={{
                    width: '100%',
                    background: '#050505',
                    border: `1px solid #1a2f1a`,
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    color: '#c8f5c8',
                    fontFamily: 'monospace',
                    textAlign: 'left',
                    cursor: 'text',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = goal.farge + '40')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a2f1a')}
                >
                  {goal.mal.toLocaleString('no-NO')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ViewerGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>(DEFAULT_GOALS);
  const [liveFollowers, setLiveFollowers] = useState<number | null>(null);
  const [liveSubscribers, setLiveSubscribers] = useState<number | null>(null);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postRes, setPostRes] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [kopiert, setKopiert] = useState(false);

  function updateGoal(i: number, updates: Partial<Goal>) {
    setGoals(prev => prev.map((g, idx) => idx === i ? { ...g, ...updates } : g));
  }

  useEffect(() => {
    async function hent() {
      try {
        const r = await fetch('/api/goals/live');
        const d = await r.json();
        if (d.live) {
          setLiveFollowers(d.live.followers ?? null);
          if (d.live.harSubData) setLiveSubscribers(d.live.subscribers);
        }
        if (d.goals?.length > 0) {
          setGoals(prev => d.goals.map((g: any) => ({
            ...DEFAULT_GOALS.find(dg => dg.type === g.type) ?? prev.find(pg => pg.type === g.type) ?? g,
            ...g,
          })));
        }
        setLastRefresh(new Date());
      } catch {}
    }
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') setOverlayUrl(`${window.location.origin}/overlay/goals`);
  }, []);

  async function lagre() {
    const toSave = goals.map(g => ({ type: g.type, label: g.label, mal: g.mal, gjeldende: g.gjeldende, aktiv: g.aktiv }));
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSave),
    });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function postTilDiscord() {
    setPosting(true);
    setPostRes('');
    try {
      const res = await fetch('/api/goals/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals, live: { followers: liveFollowers, subscribers: liveSubscribers } }),
      });
      const data = await res.json();
      setPostRes(data.ok ? '✓ Postet til Discord' : `✗ ${data.error}`);
    } catch (e) {
      setPostRes(`✗ ${(e as Error).message}`);
    }
    setPosting(false);
  }

  const aktiveGoals = goals.filter(g => g.aktiv && g.mal > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{
            fontSize: '22px', fontWeight: 900, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#c8f5c8', fontFamily: 'monospace',
          }}>
            <span style={{ color: '#00ff41' }}>◈</span> Viewer Goals
          </h1>
          <p style={{ fontSize: '11px', color: '#4a6a4a', letterSpacing: '0.06em', marginTop: '2px' }}>
            Progressbarer til OBS — automatisk oppdatering
          </p>
        </div>
        {lastRefresh && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00ff41', boxShadow: '0 0 6px #00ff41', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '10px', color: '#4a6a4a', fontFamily: 'monospace' }}>
              Live · {lastRefresh.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* Live stat cards */}
      {(liveFollowers !== null || liveSubscribers !== null) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0d1117, #00ff4108)',
            border: '1px solid #00ff4120',
            borderRadius: '12px',
            padding: '16px 20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', color: '#4a6a4a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace' }}>Følgere nå</div>
            <div style={{ fontSize: '40px', fontWeight: 900, color: '#00ff41', fontFamily: 'monospace', lineHeight: 1.1, marginTop: '4px' }}>
              {(liveFollowers ?? 0).toLocaleString('no-NO')}
            </div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #0d1117, #7b5ea708)',
            border: '1px solid #7b5ea720',
            borderRadius: '12px',
            padding: '16px 20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', color: '#4a6a4a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace' }}>Subscribers nå</div>
            {liveSubscribers !== null ? (
              <div style={{ fontSize: '40px', fontWeight: 900, color: '#7b5ea7', fontFamily: 'monospace', lineHeight: 1.1, marginTop: '4px' }}>
                {liveSubscribers.toLocaleString('no-NO')}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#4a6a4a', marginTop: '8px', lineHeight: 1.4 }}>
                Krever Affiliate<br/>+ broadcaster-token
              </div>
            )}
          </div>
        </div>
      )}

      {/* Goal cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {goals.map((g, i) => (
          <GoalCard
            key={g.type}
            goal={g}
            index={i}
            onUpdate={updateGoal}
            liveFollowers={liveFollowers}
            liveSubscribers={liveSubscribers}
          />
        ))}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={lagre}
          style={{
            flex: 1,
            padding: '12px',
            background: lagret ? '#00ff4115' : '#00ff410a',
            border: `1px solid ${lagret ? '#00ff41' : '#00ff4130'}`,
            borderRadius: '8px',
            color: lagret ? '#00ff41' : '#c8f5c8',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'monospace',
            transition: 'all 0.2s',
          }}
        >
          {lagret ? '✓ Lagret' : '◆ Lagre mål'}
        </button>
        <button
          onClick={postTilDiscord}
          disabled={posting}
          style={{
            flex: 1,
            padding: '12px',
            background: '#0d1117',
            border: '1px solid #1a2f1a',
            borderRadius: '8px',
            color: '#4a6a4a',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: posting ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { if (!posting) { e.currentTarget.style.borderColor = '#00ff4130'; e.currentTarget.style.color = '#00ff41'; }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2f1a'; e.currentTarget.style.color = '#4a6a4a'; }}
        >
          {posting ? 'Poster...' : '↗ Post til Discord'}
        </button>
      </div>

      {postRes && (
        <div style={{
          padding: '8px 12px',
          background: postRes.startsWith('✓') ? '#00ff4110' : '#ff003310',
          border: `1px solid ${postRes.startsWith('✓') ? '#00ff4130' : '#ff003330'}`,
          borderRadius: '6px',
          color: postRes.startsWith('✓') ? '#00ff41' : '#ff6b6b',
          fontSize: '11px',
          fontFamily: 'monospace',
        }}>
          {postRes}
        </div>
      )}

      {/* OBS Section */}
      {overlayUrl && (
        <div style={{
          background: '#0d1117',
          border: '1px solid #1a2f1a',
          borderRadius: '12px',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid #1a2f1a',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '10px', color: '#00ff41', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 }}>
              OBS Browser Source
            </span>
            <span style={{ fontSize: '10px', color: '#4a6a4a' }}>—</span>
            <span style={{ fontSize: '10px', color: '#4a6a4a', fontFamily: 'monospace' }}>
              {aktiveGoals.length} aktive mål · oppdaterer hvert 30. sek
            </span>
          </div>

          {/* Preview */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2f1a' }}>
            <div style={{ fontSize: '9px', color: '#4a6a4a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
              Forhåndsvisning
            </div>
            <div style={{
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #1a2f1a',
              position: 'relative',
              minHeight: '140px',
              backgroundImage: 'repeating-conic-gradient(#101820 0% 25%, #0a1218 0% 50%) 0 0 / 16px 16px',
            }}>
              <iframe
                src={overlayUrl}
                style={{ width: '100%', minHeight: '140px', border: 'none', display: 'block', background: 'transparent' }}
                title="Goals overlay preview"
              />
            </div>
            <p style={{ fontSize: '9px', color: '#4a6a4a', marginTop: '6px' }}>
              Rutemønster = transparent bakgrunn — slik det ser ut i OBS over din stream.
            </p>
          </div>

          {/* URL + settings */}
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#4a6a4a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>
                Browser Source URL
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <code style={{
                  flex: 1, fontSize: '11px', color: '#00ff41', fontFamily: 'monospace',
                  background: '#050505', border: '1px solid #1a2f1a', borderRadius: '6px',
                  padding: '8px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {overlayUrl}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(overlayUrl); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }}
                  style={{
                    padding: '8px 14px',
                    background: kopiert ? '#00ff4115' : '#0d1117',
                    border: `1px solid ${kopiert ? '#00ff41' : '#1a2f1a'}`,
                    borderRadius: '6px',
                    color: kopiert ? '#00ff41' : '#4a6a4a',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                >
                  {kopiert ? '✓ Kopiert' : 'Kopier'}
                </button>
              </div>
            </div>

            <div style={{
              background: '#050505',
              border: '1px solid #1a2f1a',
              borderRadius: '6px',
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
            }}>
              {[
                ['Bredde', '380px'],
                ['Høyde', '200px (autojuster)'],
                ['FPS', '30'],
                ['Innstillinger', 'Huk av «Transparent bakgrunn»'],
              ].map(([k, v]) => (
                <div key={k}>
                  <span style={{ fontSize: '9px', color: '#4a6a4a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}: </span>
                  <span style={{ fontSize: '10px', color: '#c8f5c8', fontFamily: 'monospace' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
