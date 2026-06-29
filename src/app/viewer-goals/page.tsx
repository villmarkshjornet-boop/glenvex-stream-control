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

const FARGE_OPTIONS = ['#00ff41', '#9b77cf', '#ff7b47', '#00d4ff', '#ffd700', '#ff4466', '#44ffcc'];

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     icon: '◈', mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', manuell: false },
  { type: 'subscribers', label: 'Subscribers', icon: '★', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf', manuell: false },
  { type: 'donations',   label: 'Donasjoner',  icon: '♥', mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47', manuell: true  },
];

/* ─── Segmented cinematic progress bar ─────────────────────────────────── */

function SegmentBar({ pct, farge }: { pct: number; farge: string }) {
  const [filled, setFilled] = useState(0);
  const SEGS = 20;

  useEffect(() => {
    const t = setTimeout(() => setFilled(pct), 250);
    return () => clearTimeout(t);
  }, [pct]);

  const filledSegs = Math.round((filled / 100) * SEGS);

  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'stretch', height: '14px' }}>
      {Array.from({ length: SEGS }, (_, i) => {
        const segPct = ((i + 1) / SEGS) * 100;
        const isFilled = i < filledSegs;
        const isActive = i === filledSegs - 1;
        return (
          <div key={i} style={{
            flex: 1,
            borderRadius: '2px',
            background: isFilled
              ? isActive
                ? farge
                : farge + 'cc'
              : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isFilled ? farge + '60' : 'rgba(255,255,255,0.07)'}`,
            boxShadow: isActive
              ? `0 0 8px ${farge}, 0 0 16px ${farge}60`
              : isFilled
              ? `0 0 4px ${farge}40`
              : 'none',
            transition: `all 0.08s ease ${i * 0.04}s`,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Shimmer on filled */}
            {isFilled && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Goal card ─────────────────────────────────────────────────────────── */

function GoalCard({ goal, index, onUpdate, liveFollowers, liveSubscribers }: {
  goal: Goal;
  index: number;
  onUpdate: (i: number, u: Partial<Goal>) => void;
  liveFollowers: number | null;
  liveSubscribers: number | null;
}) {
  const gjeldende =
    goal.type === 'followers' && liveFollowers !== null ? liveFollowers :
    goal.type === 'subscribers' && liveSubscribers !== null ? liveSubscribers :
    goal.gjeldende;

  const pct  = goal.mal > 0 ? Math.min(100, Math.round((gjeldende / goal.mal) * 100)) : 0;
  const igjen = Math.max(0, goal.mal - gjeldende);

  return (
    <div style={{
      background: goal.aktiv
        ? `linear-gradient(135deg, #0d1117 0%, ${goal.farge}06 100%)`
        : '#0a0e0a',
      border: `1px solid ${goal.aktiv ? goal.farge + '28' : '#141f14'}`,
      borderRadius: '10px',
      overflow: 'hidden',
      transition: 'all 0.25s ease',
    }}>
      {/* Left accent bar */}
      <div style={{ display: 'flex' }}>
        <div style={{
          width: '3px',
          background: goal.aktiv
            ? `linear-gradient(180deg, ${goal.farge}, ${goal.farge}40)`
            : '#1a2f1a',
          flexShrink: 0,
          transition: 'background 0.3s',
        }} />

        <div style={{ flex: 1, padding: '16px 18px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: goal.aktiv ? '14px' : '0' }}>
            <button
              onClick={() => onUpdate(index, { aktiv: !goal.aktiv })}
              style={{
                width: '18px', height: '18px', borderRadius: '3px', flexShrink: 0,
                border: `1.5px solid ${goal.aktiv ? goal.farge : '#2a3d2a'}`,
                background: goal.aktiv ? goal.farge + '18' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '10px', color: goal.aktiv ? goal.farge : '#2a3d2a',
                transition: 'all 0.2s',
              }}
            >{goal.aktiv ? '✓' : ''}</button>

            <span style={{ color: goal.aktiv ? goal.farge : '#2a3d2a', fontSize: '13px', transition: 'color 0.2s' }}>
              {goal.icon}
            </span>

            <span style={{
              fontSize: '12px', fontWeight: 800, letterSpacing: '0.1em',
              textTransform: 'uppercase', fontFamily: 'monospace',
              color: goal.aktiv ? '#c8f5c8' : '#2a3d2a',
              transition: 'color 0.2s', flex: 1,
            }}>{goal.label}</span>

            {goal.aktiv && (
              <>
                <span style={{
                  fontFamily: 'monospace', fontWeight: 900, fontSize: '26px',
                  color: goal.farge, lineHeight: 1,
                }}>
                  {gjeldende.toLocaleString('no-NO')}
                </span>
                <span style={{
                  fontFamily: 'monospace', fontSize: '13px',
                  color: '#4a6a4a', alignSelf: 'flex-end', paddingBottom: '2px',
                }}>/ {goal.mal.toLocaleString('no-NO')}</span>
                <span style={{
                  fontFamily: 'monospace', fontWeight: 900, fontSize: '16px',
                  color: pct >= 100 ? goal.farge : 'rgba(200,245,200,0.6)',
                  minWidth: '42px', textAlign: 'right',
                }}>{pct}%</span>
              </>
            )}
          </div>

          {goal.aktiv && (
            <>
              <SegmentBar pct={pct} farge={goal.farge} />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>
                  {igjen.toLocaleString('no-NO')} igjen til mål
                </span>
                <span style={{ fontSize: '10px', color: goal.manuell ? '#4a6a4a' : '#00ff4140', fontFamily: 'monospace' }}>
                  {goal.manuell ? 'Manuell' : '● Live'}
                </span>
              </div>

              {/* Edit row */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'monospace' }}>
                    Tekst / Navn
                  </div>
                  <input
                    type="text" value={goal.label}
                    onChange={e => onUpdate(index, { label: e.target.value })}
                    style={{
                      width: '100%', background: '#050505',
                      border: `1px solid #1a2f1a`,
                      borderRadius: '5px', padding: '6px 10px',
                      fontSize: '12px', color: '#c8f5c8',
                      fontFamily: 'monospace', outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = goal.farge + '50'}
                    onBlur={e => e.target.style.borderColor = '#1a2f1a'}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'monospace' }}>
                    Mål
                  </div>
                  <input
                    type="number" value={goal.mal}
                    onChange={e => onUpdate(index, { mal: Math.max(1, +e.target.value || 1) })}
                    style={{
                      width: '100%', background: '#050505',
                      border: `1px solid #1a2f1a`,
                      borderRadius: '5px', padding: '6px 10px',
                      fontSize: '13px', color: '#c8f5c8',
                      fontFamily: 'monospace', outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = goal.farge + '50'}
                    onBlur={e => e.target.style.borderColor = '#1a2f1a'}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'monospace' }}>
                    {goal.manuell ? 'Gjeldende' : 'Gjeldende (auto-hentet)'}
                  </div>
                  <input
                    type="number" value={gjeldende} disabled={!goal.manuell}
                    onChange={e => goal.manuell && onUpdate(index, { gjeldende: +e.target.value })}
                    style={{
                      width: '100%', background: '#050505',
                      border: `1px solid ${goal.manuell ? goal.farge + '30' : '#141f14'}`,
                      borderRadius: '5px', padding: '6px 10px',
                      fontSize: '13px', color: goal.manuell ? '#c8f5c8' : '#3a5a3a',
                      fontFamily: 'monospace', outline: 'none',
                      cursor: goal.manuell ? 'text' : 'default',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'monospace' }}>
                    Farge
                  </div>
                  <div style={{ display: 'flex', gap: '5px', paddingTop: '4px' }}>
                    {FARGE_OPTIONS.map(f => (
                      <button key={f} onClick={() => onUpdate(index, { farge: f })}
                        title={f}
                        style={{
                          width: '22px', height: '22px', borderRadius: '4px',
                          background: f, border: `2px solid ${goal.farge === f ? '#fff' : 'transparent'}`,
                          cursor: 'pointer', flexShrink: 0,
                          boxShadow: goal.farge === f ? `0 0 6px ${f}` : 'none',
                          transition: 'all 0.15s',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function ViewerGoalsPage() {
  const [goals, setGoals] = useState<Goal[]>(DEFAULT_GOALS);
  const [liveFollowers, setLiveFollowers] = useState<number | null>(null);
  const [liveSubscribers, setLiveSubscribers] = useState<number | null>(null);
  const [lagret, setLagret] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postRes, setPostRes] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [kopiert, setKopiert] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  function updateGoal(i: number, u: Partial<Goal>) {
    setGoals(prev => prev.map((g, idx) => idx === i ? { ...g, ...u } : g));
  }

  useEffect(() => {
    const hent = async () => {
      try {
        const r = await fetch('/api/goals/live');
        const d = await r.json();
        if (d.live) {
          if (typeof d.live.followers === 'number') setLiveFollowers(d.live.followers);
          if (d.live.harSubData && typeof d.live.subscribers === 'number') setLiveSubscribers(d.live.subscribers);
        }
        if (d.goals?.length > 0) {
          setGoals(d.goals.map((g: any) => ({
            ...DEFAULT_GOALS.find(dg => dg.type === g.type) ?? {},
            ...g,
          })));
        }
        setLastRefresh(new Date());
      } catch {}
    };
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') setOverlayUrl(`${window.location.origin}/overlay/goals`);
  }, []);

  async function lagre() {
    const toSave = goals.map(({ type, label, mal, gjeldende, aktiv }) => ({ type, label, mal, gjeldende, aktiv }));
    await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toSave) });
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
    } catch (e) { setPostRes(`✗ ${(e as Error).message}`); }
    setPosting(false);
  }

  const followerGoal = goals.find(g => g.type === 'followers' && g.aktiv);
  const followerPct  = followerGoal && followerGoal.mal > 0
    ? Math.min(100, Math.round(((liveFollowers ?? followerGoal.gjeldende) / followerGoal.mal) * 100))
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c8f5c8', fontFamily: 'monospace' }}>
            <span style={{ color: '#00ff41' }}>◈</span> Viewer Goals
          </h1>
          <p style={{ fontSize: '10px', color: '#3a5a3a', letterSpacing: '0.06em', marginTop: '2px', fontFamily: 'monospace' }}>
            Progressbarer til OBS — automatisk oppdatering hvert 30s
          </p>
        </div>
        {lastRefresh && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00ff41', boxShadow: '0 0 6px #00ff41', animation: 'livePulse 2s infinite' }} />
            <span style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>
              {lastRefresh.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* Live summary */}
      {(liveFollowers !== null || liveSubscribers !== null) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0d1117, #00ff4108)',
            border: '1px solid #00ff4120', borderRadius: '10px', padding: '14px 18px',
          }}>
            <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '6px' }}>Følgere nå</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontSize: '36px', fontWeight: 900, color: '#00ff41', fontFamily: 'monospace', lineHeight: 1 }}>
                {(liveFollowers ?? 0).toLocaleString('no-NO')}
              </span>
              {followerPct !== null && (
                <span style={{ fontSize: '13px', color: '#00ff4180', fontFamily: 'monospace', fontWeight: 700 }}>{followerPct}%</span>
              )}
            </div>
            {followerGoal && (
              <div style={{ marginTop: '8px' }}>
                <SegmentBar pct={followerPct ?? 0} farge="#00ff41" />
                <div style={{ fontSize: '9px', color: '#3a5a3a', fontFamily: 'monospace', marginTop: '4px' }}>
                  Mål: {followerGoal.mal.toLocaleString('no-NO')} følgere
                </div>
              </div>
            )}
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #0d1117, #9b77cf08)',
            border: '1px solid #9b77cf20', borderRadius: '10px', padding: '14px 18px',
          }}>
            <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '6px' }}>Subscribers nå</div>
            {liveSubscribers !== null ? (
              <span style={{ fontSize: '36px', fontWeight: 900, color: '#9b77cf', fontFamily: 'monospace', lineHeight: 1 }}>
                {liveSubscribers.toLocaleString('no-NO')}
              </span>
            ) : (
              <div style={{ fontSize: '11px', color: '#3a5a3a', lineHeight: 1.5, marginTop: '4px' }}>
                Krever Affiliate<br/>+ broadcaster-token
              </div>
            )}
          </div>
        </div>
      )}

      {/* Goal cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {goals.map((g, i) => (
          <GoalCard key={g.type + i} goal={g} index={i} onUpdate={updateGoal}
            liveFollowers={liveFollowers} liveSubscribers={liveSubscribers} />
        ))}

        {/* Add custom goal */}
        <button
          onClick={() => setGoals(prev => [...prev, {
            type: `custom_${Date.now()}`,
            label: 'Nytt mål',
            icon: '◆',
            mal: 100,
            gjeldende: 0,
            aktiv: true,
            farge: FARGE_OPTIONS[prev.length % FARGE_OPTIONS.length],
            manuell: true,
          }])}
          style={{
            padding: '11px',
            background: 'transparent',
            border: '1px dashed #1a2f1a',
            borderRadius: '10px',
            color: '#3a5a3a',
            fontSize: '11px', fontFamily: 'monospace', fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ff4140'; e.currentTarget.style.color = '#00ff41'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2f1a'; e.currentTarget.style.color = '#3a5a3a'; }}
        >
          + Legg til eget mål
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={lagre} style={{
          flex: 1, padding: '11px', fontFamily: 'monospace', fontWeight: 700,
          fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
          background: lagret ? '#00ff4115' : '#00ff410a',
          border: `1px solid ${lagret ? '#00ff41' : '#00ff4130'}`,
          color: lagret ? '#00ff41' : '#c8f5c8',
          borderRadius: '7px', cursor: 'pointer', transition: 'all 0.2s',
        }}>
          {lagret ? '✓ Lagret' : '◆ Lagre mål'}
        </button>
        <button onClick={postTilDiscord} disabled={posting} style={{
          flex: 1, padding: '11px', fontFamily: 'monospace', fontWeight: 700,
          fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
          background: '#0d1117', border: '1px solid #1a2f1a',
          color: '#4a6a4a', borderRadius: '7px', cursor: posting ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
        }}>
          {posting ? 'Poster...' : '↗ Post til Discord'}
        </button>
      </div>

      {postRes && (
        <div style={{
          padding: '8px 12px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace',
          background: postRes.startsWith('✓') ? '#00ff4110' : '#ff003310',
          border: `1px solid ${postRes.startsWith('✓') ? '#00ff4130' : '#ff003330'}`,
          color: postRes.startsWith('✓') ? '#00ff41' : '#ff6b6b',
        }}>{postRes}</div>
      )}

      {/* OBS Section */}
      {overlayUrl && (
        <div style={{ background: '#0d1117', border: '1px solid #1a2f1a', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #1a2f1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: '#00ff41', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 }}>OBS Browser Source</span>
            <span style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>— {goals.filter(g => g.aktiv && g.mal > 0).length} aktive mål</span>
          </div>

          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1a2f1a' }}>
            <div style={{ fontSize: '9px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'monospace' }}>Forhåndsvisning</div>
            <div style={{
              borderRadius: '6px', overflow: 'hidden', border: '1px solid #1a2f1a',
              minHeight: '130px',
              backgroundImage: 'repeating-conic-gradient(#0e1a0e 0% 25%, #080f08 0% 50%) 0 0 / 14px 14px',
            }}>
              <iframe src={overlayUrl} style={{ width: '100%', minHeight: '130px', border: 'none', display: 'block', background: 'transparent' }} title="Goals overlay preview" />
            </div>
            <p style={{ fontSize: '9px', color: '#3a5a3a', marginTop: '5px', fontFamily: 'monospace' }}>
              Rutemønster = transparent — slik ser det ut i OBS over din stream.
            </p>
          </div>

          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <code style={{
                flex: 1, fontSize: '11px', color: '#00ff41', fontFamily: 'monospace',
                background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px',
                padding: '7px 11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{overlayUrl}</code>
              <button onClick={() => { navigator.clipboard.writeText(overlayUrl); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }} style={{
                padding: '7px 14px', background: kopiert ? '#00ff4115' : '#0d1117',
                border: `1px solid ${kopiert ? '#00ff41' : '#1a2f1a'}`, borderRadius: '5px',
                color: kopiert ? '#00ff41' : '#4a6a4a', fontSize: '11px', fontFamily: 'monospace',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
              }}>
                {kopiert ? '✓ Kopiert' : 'Kopier'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
              {[['Bredde', '380px'], ['Høyde', '200px'], ['FPS', '30'], ['Huk av', '«Transparent bakgrunn»']].map(([k, v]) => (
                <div key={k} style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                  <span style={{ color: '#3a5a3a' }}>{k}: </span>
                  <span style={{ color: '#c8f5c8' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
