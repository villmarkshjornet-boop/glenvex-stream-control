'use client';

import { useEffect, useState } from 'react';
import { GoalBarsPreview, FxStyles, DEFAULT_FX, PRESETS, type OverlayFx } from '@/components/GoalBars';

interface Goal {
  type: string;
  label: string;
  icon: string;
  mal: number;
  gjeldende: number;
  aktiv: boolean;
  farge: string;
  manuell?: boolean;
  source?: 'auto' | 'manual';
  startValue?: number;
  resetPolicy?: 'never' | 'per_stream' | 'daily' | 'manual';
}

const FARGER = ['#00ff41', '#9b77cf', '#ff7b47', '#00d4ff', '#ffd700', '#ff4466', '#44ffcc'];

const DEFAULT_GOALS: Goal[] = [
  { type: 'followers',   label: 'Følgere',     icon: '◈', mal: 400,  gjeldende: 0, aktiv: true,  farge: '#00ff41', manuell: false, source: 'auto'   },
  { type: 'subscribers', label: 'Subscribers', icon: '★', mal: 10,   gjeldende: 0, aktiv: false, farge: '#9b77cf', manuell: false, source: 'auto'   },
  { type: 'donations',   label: 'Donasjoner',  icon: '♥', mal: 1000, gjeldende: 0, aktiv: false, farge: '#ff7b47', manuell: true,  source: 'manual' },
];

/* ─── Segmented bar (settings panel) ─── */
function SegBar({ pct, farge }: { pct: number; farge: string }) {
  const [r, setR] = useState(0);
  useEffect(() => { const t = setTimeout(() => setR(pct), 250); return () => clearTimeout(t); }, [pct]);
  const segs = 20;
  const filled = Math.round((r / 100) * segs);
  return (
    <div style={{ display: 'flex', gap: '2px', height: '12px' }}>
      {Array.from({ length: segs }, (_, i) => {
        const f = i < filled; const tip = i === filled - 1;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: '2px',
            background: f ? (tip ? farge : farge + 'bb') : 'rgba(255,255,255,0.05)',
            border: `1px solid ${f ? farge + '55' : 'rgba(255,255,255,0.06)'}`,
            boxShadow: tip ? `0 0 6px ${farge}, 0 0 12px ${farge}55` : 'none',
            transition: `all 0.06s ease ${i * 0.03}s`,
            position: 'relative', overflow: 'hidden',
          }}>
            {f && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.15) 0%,transparent 100%)' }} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Goal card ─── */
function GoalCard({ goal, index, onUpdate, onRemove, onIncrement, liveF, liveSub }: {
  goal: Goal; index: number;
  onUpdate: (i: number, u: Partial<Goal>) => void;
  onRemove: (i: number) => void;
  onIncrement: (i: number, delta: number) => Promise<void>;
  liveF: number | null; liveSub: number | null;
}) {
  // Derive effective source (backward-compat with old manuell field)
  const effectiveSource: 'auto' | 'manual' =
    goal.source ??
    (['followers', 'subscribers'].includes(goal.type) ? 'auto' : 'manual');

  const gjeldende =
    effectiveSource === 'auto' && goal.type === 'followers'   && liveF   !== null ? liveF   :
    effectiveSource === 'auto' && goal.type === 'subscribers' && liveSub !== null ? liveSub :
    goal.gjeldende;

  const pct   = goal.mal > 0 ? Math.min(100, Math.round((gjeldende / goal.mal) * 100)) : 0;
  const igjen = Math.max(0, goal.mal - gjeldende);
  const isCustom = goal.type.startsWith('custom_');

  const btnStyle = (active: boolean, color: string) => ({
    padding: '4px 10px', fontSize: '11px', fontFamily: 'monospace' as const,
    border: `1px solid ${active ? color + '80' : '#1a2f1a'}`,
    background: active ? color + '12' : 'transparent',
    color: active ? color : '#3a5a3a',
    borderRadius: '4px', cursor: 'pointer' as const, fontWeight: 700 as const,
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    transition: 'all 0.2s',
  });

  return (
    <div style={{
      background: goal.aktiv ? `linear-gradient(135deg, #0d1117, ${goal.farge}06)` : '#0a0e0a',
      border: `1px solid ${goal.aktiv ? goal.farge + '28' : '#141f14'}`,
      borderRadius: '10px', overflow: 'hidden', transition: 'all 0.25s',
    }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: '3px', background: goal.aktiv ? `linear-gradient(180deg,${goal.farge},${goal.farge}40)` : '#1a2f1a', flexShrink: 0, transition: 'background 0.3s' }} />
        <div style={{ flex: 1, padding: '14px 16px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: goal.aktiv ? '12px' : '0' }}>
            <button onClick={() => onUpdate(index, { aktiv: !goal.aktiv })} style={{
              width: '18px', height: '18px', borderRadius: '3px', flexShrink: 0,
              border: `1.5px solid ${goal.aktiv ? goal.farge : '#2a3d2a'}`,
              background: goal.aktiv ? goal.farge + '18' : 'transparent',
              cursor: 'pointer', fontSize: '11px', color: goal.aktiv ? goal.farge : '#2a3d2a',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
            }}>{goal.aktiv ? '✓' : ''}</button>

            <span style={{ color: goal.aktiv ? goal.farge : '#2a3d2a', fontSize: '12px', transition: 'color 0.2s' }}>{goal.icon}</span>

            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', fontFamily: 'monospace', color: goal.aktiv ? '#c8f5c8' : '#2a3d2a', transition: 'color 0.2s' }}>
              {goal.label}
            </span>

            {goal.aktiv && (
              <>
                <span style={{ fontSize: '24px', fontWeight: 900, color: goal.farge, fontFamily: 'monospace', lineHeight: 1 }}>
                  {gjeldende.toLocaleString('no-NO')}
                </span>
                <span style={{ fontSize: '11px', color: '#4a6a4a', fontFamily: 'monospace', alignSelf: 'flex-end', paddingBottom: '2px' }}>
                  / {goal.mal.toLocaleString('no-NO')}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 900, color: pct >= 100 ? goal.farge : 'rgba(200,245,200,0.5)', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}>
                  {pct}%
                </span>
              </>
            )}

            {isCustom && (
              <button onClick={() => onRemove(index)} style={{ background: 'none', border: 'none', color: '#3a5a3a', cursor: 'pointer', fontSize: '14px', padding: '0 4px', lineHeight: 1 }} title="Fjern">×</button>
            )}
          </div>

          {goal.aktiv && (
            <>
              <SegBar pct={pct} farge={goal.farge} />
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0 10px' }}>
                <span style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>{igjen.toLocaleString('no-NO')} igjen</span>
                <span style={{ fontSize: '11px', color: effectiveSource === 'manual' ? '#4a6a4a' : '#00ff4145', fontFamily: 'monospace' }}>
                  {effectiveSource === 'manual' ? 'Manuell' : '● Live'}
                </span>
              </div>

              {/* Source selector */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
                <button onClick={() => onUpdate(index, { source: 'auto', manuell: false })} style={btnStyle(effectiveSource === 'auto', goal.farge)}>
                  ● Auto (Twitch)
                </button>
                <button onClick={() => onUpdate(index, { source: 'manual', manuell: true })} style={btnStyle(effectiveSource === 'manual', goal.farge)}>
                  ✎ Manuell
                </button>
              </div>

              {/* Manual increment controls */}
              {effectiveSource === 'manual' && (
                <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', alignItems: 'center' }}>
                  <button
                    onClick={() => onIncrement(index, -1)}
                    style={{ ...btnStyle(false, '#ff4466'), padding: '5px 14px', fontSize: '16px' }}
                  >−</button>
                  <button
                    onClick={() => onIncrement(index, 1)}
                    style={{ ...btnStyle(false, goal.farge), padding: '5px 14px', fontSize: '16px' }}
                  >+</button>
                  <button
                    onClick={() => onIncrement(index, 0)}
                    title={`Reset til ${goal.startValue ?? 0}`}
                    style={{ ...btnStyle(false, '#4a6a4a'), padding: '5px 10px', fontSize: '11px', marginLeft: '4px' }}
                  >↺ Reset</button>

                  {/* resetPolicy inline */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                    {(['never', 'per_stream', 'daily', 'manual'] as const).map(p => {
                      const labels: Record<string, string> = { never: 'Aldri', per_stream: 'Per stream', daily: 'Daglig', manual: 'Manuelt' };
                      const active = (goal.resetPolicy ?? 'never') === p;
                      return (
                        <button key={p} onClick={() => onUpdate(index, { resetPolicy: p })} style={{
                          padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace',
                          border: `1px solid ${active ? goal.farge + '80' : '#1a2f1a'}`,
                          background: active ? goal.farge + '12' : 'transparent',
                          color: active ? goal.farge : '#3a5a3a',
                          borderRadius: '4px', cursor: 'pointer', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'all 0.2s',
                        }}>{labels[p]}</button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Edit fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '3px' }}>Tekst / Navn</div>
                  <input type="text" value={goal.label} onChange={e => onUpdate(index, { label: e.target.value })}
                    style={{ width: '100%', background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px', padding: '5px 9px', fontSize: '12px', color: '#c8f5c8', fontFamily: 'monospace', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = goal.farge + '50'}
                    onBlur={e => e.target.style.borderColor = '#1a2f1a'} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '3px' }}>Mål</div>
                  <input type="number" value={goal.mal} onChange={e => onUpdate(index, { mal: Math.max(1, +e.target.value || 1) })}
                    style={{ width: '100%', background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px', padding: '5px 9px', fontSize: '13px', color: '#c8f5c8', fontFamily: 'monospace', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = goal.farge + '50'}
                    onBlur={e => e.target.style.borderColor = '#1a2f1a'} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '3px' }}>
                    {effectiveSource === 'manual' ? 'Startverdi (reset til)' : 'Gjeldende (auto)'}
                  </div>
                  {effectiveSource === 'manual' ? (
                    <input type="number" value={goal.startValue ?? 0}
                      onChange={e => onUpdate(index, { startValue: Math.max(0, +e.target.value) })}
                      style={{ width: '100%', background: '#050505', border: `1px solid ${goal.farge + '30'}`, borderRadius: '5px', padding: '5px 9px', fontSize: '13px', color: '#c8f5c8', fontFamily: 'monospace', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = goal.farge + '50'}
                      onBlur={e => e.target.style.borderColor = goal.farge + '30'} />
                  ) : (
                    <input type="number" value={gjeldende} disabled
                      style={{ width: '100%', background: '#050505', border: '1px solid #141f14', borderRadius: '5px', padding: '5px 9px', fontSize: '13px', color: '#2a3d2a', fontFamily: 'monospace', outline: 'none', cursor: 'default' }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '3px' }}>Farge</div>
                  <div style={{ display: 'flex', gap: '4px', paddingTop: '3px', flexWrap: 'wrap' }}>
                    {FARGER.map(f => (
                      <button key={f} onClick={() => onUpdate(index, { farge: f })} title={f} style={{
                        width: '20px', height: '20px', borderRadius: '4px', background: f, border: `2px solid ${goal.farge === f ? '#fff' : 'transparent'}`,
                        cursor: 'pointer', boxShadow: goal.farge === f ? `0 0 5px ${f}` : 'none', transition: 'all 0.15s', flexShrink: 0,
                      }} />
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

/* ─── Token status badge ─── */
function TokenStatus({ status }: { status: 'ok' | 'missing' | 'snapshot' | null }) {
  if (!status) return null;
  const cfg = {
    ok:       { text: '● Twitch-token OK',               color: '#00ff41', bg: '#00ff4110' },
    snapshot: { text: '⚠ Token utløpt — viser siste kjente tall', color: '#ffd700', bg: '#ffd70010' },
    missing:  { text: '✗ Twitch-token mangler — koble til Twitch på nytt i Innstillinger', color: '#ff4444', bg: '#ff444410' },
  }[status];
  return (
    <div style={{ padding: '8px 12px', background: cfg.bg, border: `1px solid ${cfg.color}30`, borderRadius: '7px', fontSize: '11px', color: cfg.color, fontFamily: 'monospace' }}>
      {cfg.text}
    </div>
  );
}

/* ─── URL rad-komponent ─── */
function UrlRad({ url, kopiert, onKopier, small }: { url: string; kopiert: boolean; onKopier: () => void; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <code style={{
        flex: 1, fontSize: small ? '9px' : '10px', color: '#00ff41', fontFamily: 'monospace',
        background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px',
        padding: small ? '5px 9px' : '7px 11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {url}
      </code>
      <button onClick={onKopier} style={{
        padding: small ? '5px 10px' : '7px 14px',
        background: kopiert ? '#00ff4115' : '#0d1117',
        border: `1px solid ${kopiert ? '#00ff41' : '#1a2f1a'}`,
        borderRadius: '5px', color: kopiert ? '#00ff41' : '#4a6a4a',
        fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
      }}>{kopiert ? '✓' : 'Kopier'}</button>
    </div>
  );
}

/* ─── Page ─── */
export default function ViewerGoalsPage() {
  const [goals, setGoals]           = useState<Goal[]>(DEFAULT_GOALS);
  const [liveF, setLiveF]           = useState<number | null>(null);
  const [liveSub, setLiveSub]       = useState<number | null>(null);
  const [canReadSub, setCanReadSub] = useState<boolean | null>(null);
  const [tokenStatus, setToken]     = useState<'ok' | 'missing' | 'snapshot' | null>(null);
  const [overlayUrl, setOverlayUrl] = useState('');
  const [workspaceId, setWsId]      = useState('');
  const [lagret, setLagret]         = useState(false);
  const [posting, setPosting]       = useState(false);
  const [postRes, setPostRes]       = useState('');
  const [fx, setFx]                 = useState<OverlayFx>(DEFAULT_FX);
  const [fxLagret, setFxLagret]     = useState(false);
  const [kopierteUrls, setKopierteUrls] = useState<Record<string, boolean>>({});
  const [lastRefresh, setLast]      = useState<Date | null>(null);

  const updateGoal = (i: number, u: Partial<Goal>) =>
    setGoals(prev => prev.map((g, idx) => idx === i ? { ...g, ...u } : g));

  const removeGoal = (i: number) =>
    setGoals(prev => prev.filter((_, idx) => idx !== i));

  async function inkrementGoal(index: number, delta: number) {
    const goal = goals[index];
    try {
      const res = await fetch(`/api/goals/${encodeURIComponent(goal.type)}/increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      });
      if (res.ok) {
        const data = await res.json() as { gjeldende?: number };
        if (typeof data.gjeldende === 'number') {
          updateGoal(index, { gjeldende: data.gjeldende });
        }
      }
    } catch {}
  }

  function applyGoalsResponse(d: any) {
    setToken(d.tokenStatus ?? null);
    if (d.live) {
      if (typeof d.live.followers === 'number') setLiveF(d.live.followers);
      setCanReadSub(d.live.canReadSubscribers ?? false);
      if (d.live.canReadSubscribers) setLiveSub(d.live.subscribers);
    }
    if (d.goals?.length > 0) setGoals(d.goals.map((g: any) => ({
      ...g,
      icon: g.icon ?? '◆',
      farge: g.farge ?? '#00ff41',
    })));
    if (d.fx) setFx(prev => ({ ...prev, ...d.fx }));
    setLast(new Date());
  }

  useEffect(() => {
    if (typeof window !== 'undefined') setOverlayUrl(window.location.origin + '/overlay/goals');

    // Fetch workspace ID first — /api/goals/live is PUBLIC (overlay access), so middleware
    // never injects x-workspace-id. Must pass ?ws= param explicitly.
    fetch('/api/me/workspace')
      .then(r => r.json())
      .then((d: { id?: string }) => {
        const ws = d.id ?? '';
        if (ws) setWsId(ws);
        return fetch(`/api/goals/live${ws ? `?ws=${encodeURIComponent(ws)}` : ''}`);
      })
      .then(r => r.json())
      .then(applyGoalsResponse)
      .catch(() => {});
  }, []);

  // Re-poll every 30s — workspaceId must be known first
  useEffect(() => {
    if (!workspaceId) return;
    const id = setInterval(() => {
      fetch(`/api/goals/live?ws=${encodeURIComponent(workspaceId)}`).then(r => r.json()).then(d => {
        setToken(d.tokenStatus ?? null);
        if (d.live) {
          if (typeof d.live.followers === 'number') setLiveF(d.live.followers);
          if (d.live.canReadSubscribers) setLiveSub(d.live.subscribers);
        }
        setLast(new Date());
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [workspaceId]);

  const fullOverlayUrl = workspaceId ? `${overlayUrl}?ws=${encodeURIComponent(workspaceId)}` : overlayUrl;

  // Live preview uses goals with current live data merged in
  const previewGoals = goals.map(g => {
    const src = g.source ?? (['followers', 'subscribers'].includes(g.type) ? 'auto' : 'manual');
    return {
      ...g,
      gjeldende:
        src === 'auto' && g.type === 'followers'   && liveF   !== null ? liveF   :
        src === 'auto' && g.type === 'subscribers' && liveSub !== null ? liveSub :
        g.gjeldende,
    };
  });

  async function lagre() {
    const toSave = goals.map(g => ({
      type: g.type, label: g.label, icon: g.icon, mal: g.mal,
      gjeldende: g.gjeldende, aktiv: g.aktiv, farge: g.farge,
      manuell: g.manuell, source: g.source,
      startValue: g.startValue, resetPolicy: g.resetPolicy,
    }));
    await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toSave) });
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  }

  async function lagreFx(nyFx: OverlayFx) {
    setFx(nyFx);
    await fetch('/api/goals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _fxOnly: true, fx: nyFx,
        goals: goals.map(g => ({
          type: g.type, label: g.label, icon: g.icon, mal: g.mal,
          gjeldende: g.gjeldende, aktiv: g.aktiv, farge: g.farge,
          manuell: g.manuell, source: g.source,
          startValue: g.startValue, resetPolicy: g.resetPolicy,
        })),
      }),
    }).catch(() => {});
    setFxLagret(true);
    setTimeout(() => setFxLagret(false), 1800);
  }

  function kopierUrl(key: string, url: string) {
    navigator.clipboard.writeText(url).catch(() => {});
    setKopierteUrls(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setKopierteUrls(prev => ({ ...prev, [key]: false })), 2000);
  }

  async function postTilDiscord() {
    setPosting(true); setPostRes('');
    try {
      const res = await fetch('/api/goals/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals, live: { followers: liveF, subscribers: liveSub } }),
      });
      const d = await res.json();
      setPostRes(d.ok ? '✓ Postet til Discord' : `✗ ${d.error}`);
    } catch (e) { setPostRes(`✗ ${(e as Error).message}`); }
    setPosting(false);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-g-text">
            <span className="text-g-green">◈</span> Viewer Goals
          </h1>
          <p className="text-xs text-g-muted mt-1 font-mono">
            Progressbarer til OBS — automatisk oppdatering hvert 30s
          </p>
        </div>
        {lastRefresh && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
            <span className="text-xs text-g-muted font-mono">{lastRefresh.toLocaleTimeString('no-NO')}</span>
          </div>
        )}
      </div>

      {/* Token status */}
      <TokenStatus status={tokenStatus} />

      {/* Live stat cards */}
      {(liveF !== null || liveSub !== null) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ background: 'linear-gradient(135deg,#0d1117,#00ff4108)', border: '1px solid #00ff4120', borderRadius: '10px', padding: '14px 18px' }}>
            <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '4px' }}>Følgere nå</div>
            <div style={{ fontSize: '36px', fontWeight: 900, color: '#00ff41', fontFamily: 'monospace', lineHeight: 1 }}>{(liveF ?? 0).toLocaleString('no-NO')}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg,#0d1117,#9b77cf08)', border: '1px solid #9b77cf20', borderRadius: '10px', padding: '14px 18px' }}>
            <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '4px' }}>Subscribers nå</div>
            {liveSub !== null
              ? <div style={{ fontSize: '36px', fontWeight: 900, color: '#9b77cf', fontFamily: 'monospace', lineHeight: 1 }}>{liveSub.toLocaleString('no-NO')}</div>
              : <div style={{ fontSize: '11px', color: '#3a5a3a', lineHeight: 1.5, marginTop: '4px' }}>
                  {canReadSub === false ? 'Krever Affiliate + broadcaster-token' : 'Laster...'}
                </div>}
          </div>
        </div>
      )}

      {/* Goal cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {goals.map((g, i) => (
          <GoalCard key={g.type + i} goal={g} index={i}
            onUpdate={updateGoal} onRemove={removeGoal} onIncrement={inkrementGoal}
            liveF={liveF} liveSub={liveSub} />
        ))}

        <button onClick={() => setGoals(prev => [...prev, {
          type: `custom_${Date.now()}`, label: 'Nytt mål', icon: '◆',
          mal: 100, gjeldende: 0, aktiv: true, manuell: true, source: 'manual',
          startValue: 0, resetPolicy: 'never',
          farge: FARGER[prev.length % FARGER.length],
        }])} style={{
          padding: '11px', background: 'transparent', border: '1px dashed #1a2f1a',
          borderRadius: '10px', color: '#3a5a3a', fontSize: '11px', fontFamily: 'monospace',
          fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
          cursor: 'pointer', transition: 'all 0.2s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ff4140'; e.currentTarget.style.color = '#00ff41'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2f1a'; e.currentTarget.style.color = '#3a5a3a'; }}>
          + Legg til manuelt mål
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={lagre} style={{
          flex: 1, padding: '11px', fontFamily: 'monospace', fontWeight: 700, fontSize: '11px',
          letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
          background: lagret ? '#00ff4115' : '#00ff410a', border: `1px solid ${lagret ? '#00ff41' : '#00ff4130'}`,
          color: lagret ? '#00ff41' : '#c8f5c8', borderRadius: '7px', transition: 'all 0.2s',
        }}>{lagret ? '✓ Lagret' : '◆ Lagre mål'}</button>
        <button onClick={postTilDiscord} disabled={posting} style={{
          flex: 1, padding: '11px', fontFamily: 'monospace', fontWeight: 700, fontSize: '11px',
          letterSpacing: '0.1em', textTransform: 'uppercase', cursor: posting ? 'not-allowed' : 'pointer',
          background: '#0d1117', border: '1px solid #1a2f1a', color: '#4a6a4a', borderRadius: '7px', transition: 'all 0.2s',
        }}>{posting ? 'Poster...' : '↗ Post til Discord'}</button>
      </div>

      {postRes && (
        <div style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace', background: postRes.startsWith('✓') ? '#00ff4110' : '#ff003310', border: `1px solid ${postRes.startsWith('✓') ? '#00ff4130' : '#ff003330'}`, color: postRes.startsWith('✓') ? '#00ff41' : '#ff6b6b' }}>
          {postRes}
        </div>
      )}

      {/* OBS Section */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2f1a', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #1a2f1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#00ff41', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 }}>OBS Browser Source</span>
          <span style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>— live forhåndsvisning + effekter</span>
        </div>

        {/* ── Effekter-panel ── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1a2f1a' }}>
          <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Animasjons-effekter</span>
            {fxLagret && <span style={{ color: '#00ff41' }}>✓ Lagret</span>}
          </div>

          {/* Preset-velger */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px', marginBottom: '12px' }}>
            {(['classic','neon','cinematic','minimal'] as const).map(p => (
              <button key={p} onClick={() => lagreFx({ ...DEFAULT_FX, ...PRESETS[p], preset: p })} style={{
                padding: '7px', border: `1px solid ${fx.preset === p ? '#00ff41' : '#1a2f1a'}`,
                background: fx.preset === p ? '#00ff4112' : 'transparent',
                borderRadius: '6px', color: fx.preset === p ? '#00ff41' : '#4a6a4a',
                fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase',
                cursor: 'pointer', letterSpacing: '0.06em', transition: 'all 0.2s',
              }}>
                {p === 'classic' ? 'Classic' : p === 'neon' ? '⚡ Neon' : p === 'cinematic' ? '🎬 Cinematic' : '○ Minimal'}
              </button>
            ))}
          </div>

          {/* Enkelt-toggles */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {([
              ['glow',       '✦ Glød'],
              ['scan',       '→ Scan-linje'],
              ['pulse',      '◉ Puls'],
              ['numberAnim', '↑ Tall-animasjon'],
              ['slideIn',    '◁ Glide inn'],
              ['milestone',  '★ Milepæl-burst'],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => lagreFx({ ...fx, preset: 'custom' as any, [key]: !fx[key as keyof OverlayFx] })} style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '6px 10px', border: `1px solid ${fx[key as keyof OverlayFx] ? '#00ff4140' : '#1a2f1a'}`,
                background: fx[key as keyof OverlayFx] ? '#00ff4108' : 'transparent',
                borderRadius: '5px', cursor: 'pointer', transition: 'all 0.18s',
              }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '2px',
                  background: fx[key as keyof OverlayFx] ? '#00ff41' : 'transparent',
                  border: `1px solid ${fx[key as keyof OverlayFx] ? '#00ff41' : '#3a5a3a'}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: '11px', color: fx[key as keyof OverlayFx] ? '#c8f5c8' : '#4a6a4a', fontFamily: 'monospace' }}>{label}</span>
              </button>
            ))}
          </div>

          {/* Glow intensitet + scan interval */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace', marginBottom: '5px' }}>Glow-styrke</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['low','medium','high'] as const).map(v => (
                  <button key={v} onClick={() => lagreFx({ ...fx, glowIntensity: v })} style={{
                    flex: 1, padding: '5px', fontSize: '11px', fontFamily: 'monospace',
                    border: `1px solid ${fx.glowIntensity === v ? '#00ff41' : '#1a2f1a'}`,
                    background: fx.glowIntensity === v ? '#00ff4112' : 'transparent',
                    color: fx.glowIntensity === v ? '#00ff41' : '#4a6a4a',
                    borderRadius: '4px', cursor: 'pointer', textTransform: 'uppercase',
                  }}>{v === 'low' ? 'Lav' : v === 'medium' ? 'Mid' : 'Høy'}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace', marginBottom: '5px' }}>Scan-interval (sek)</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[5,7,10,15].map(v => (
                  <button key={v} onClick={() => lagreFx({ ...fx, scanInterval: v })} style={{
                    flex: 1, padding: '5px', fontSize: '11px', fontFamily: 'monospace',
                    border: `1px solid ${fx.scanInterval === v ? '#00ff41' : '#1a2f1a'}`,
                    background: fx.scanInterval === v ? '#00ff4112' : 'transparent',
                    color: fx.scanInterval === v ? '#00ff41' : '#4a6a4a',
                    borderRadius: '4px', cursor: 'pointer',
                  }}>{v}s</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Live preview ── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1a2f1a' }}>
          <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px', fontFamily: 'monospace' }}>
            Forhåndsvisning — oppdaterer i sanntid
          </div>
          <div style={{
            borderRadius: '6px', padding: '10px',
            backgroundImage: 'repeating-conic-gradient(#0e1a0e 0% 25%, #080f08 0% 50%) 0 0 / 14px 14px',
            border: '1px solid #1a2f1a',
          }}>
            <FxStyles />
            <GoalBarsPreview goals={previewGoals} compact fx={fx} />
          </div>
          <p style={{ fontSize: '11px', color: '#3a5a3a', marginTop: '6px', fontFamily: 'monospace' }}>
            ↑ Slik ser det ut i OBS over din stream (transparent bakgrunn)
          </p>
        </div>

        {/* ── Alle mål — felles URL ── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1a2f1a' }}>
          <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '8px' }}>
            Felles URL — alle aktive mål
          </div>
          <UrlRad url={fullOverlayUrl} kopiert={kopierteUrls['all'] ?? false} onKopier={() => kopierUrl('all', fullOverlayUrl)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginTop: '8px' }}>
            {[['Bredde', '380px'], ['Høyde', previewGoals.filter(g=>g.aktiv&&g.mal>0).length > 1 ? `${previewGoals.filter(g=>g.aktiv&&g.mal>0).length * 56}px` : '80px'], ['FPS', '30'], ['Huk av', '«Transparent bakgrunn»']].map(([k, v]) => (
              <div key={k} style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                <span style={{ color: '#3a5a3a' }}>{k}: </span><span style={{ color: '#c8f5c8' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Per-bar URLs ── */}
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '11px', color: '#3a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '10px' }}>
            Individuelle browser sources — én bar per kilde
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {previewGoals.filter(g => g.aktiv && g.mal > 0).map(g => {
              const url = `${fullOverlayUrl}&goal=${encodeURIComponent(g.type)}`;
              return (
                <div key={g.type} style={{ padding: '10px 12px', background: '#0a0e0a', border: `1px solid ${(g.farge ?? '#00ff41')}22`, borderRadius: '7px', borderLeft: `3px solid ${g.farge ?? '#00ff41'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: g.farge ?? '#00ff41' }}>{g.icon ?? '◆'}</span>
                      <span style={{ fontSize: '11px', color: '#c8f5c8', fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{g.label}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>380×80px</span>
                  </div>
                  <UrlRad url={url} kopiert={kopierteUrls[g.type] ?? false} onKopier={() => kopierUrl(g.type, url)} small />
                </div>
              );
            })}
            {previewGoals.filter(g => g.aktiv && g.mal > 0).length === 0 && (
              <p style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>Ingen aktive mål ennå</p>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
