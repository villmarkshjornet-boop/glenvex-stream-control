'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface StreamSummary {
  id: string;
  stream_id?: string;
  title: string;
  game: string;
  started_at: string;
  peak_viewers: number;
  avg_viewers: number;
  chat_messages: number;
  duration_minutes: number;
  followers_gained: number;
  subs_gained: number;
  raids_during: number;
}

interface ViewerEntry {
  username: string;
  firstSeen: string;
  lastSeen: string;
  messagesSent: number;
  follower: boolean;
  subscriber: boolean;
  moderator: boolean;
  vip: boolean;
  returningViewer: boolean;
  firstTimeSeen: boolean;
}

interface AudienceData {
  viewers: ViewerEntry[];
  total: number;
  newViewers: number;
  returningViewers: number;
  subscribers: number;
  moderators: number;
  vips: number;
  activeChattters: number;
  lurkers: number;
  topChattters: Array<{ username: string; messages: number }>;
}

interface RetentionPoint {
  ts: string;
  count: number;
  minuteFromStart: number;
}

interface StreamScore {
  total: number;
  grade: string;
  breakdown: {
    viewers: number;
    retention: number;
    chat: number;
    growth: number;
    community: number;
  };
}

interface CoachReport {
  history: StreamSummary[];
  selectedStream: StreamSummary | null;
  audience: AudienceData | null;
  retentionCurve: RetentionPoint[] | null;
  streamScore: StreamScore | null;
  analyse: {
    fungerteBra: string[];
    fungerteIkke: string[];
    anbefalinger: string[];
    toppInsikt: string;
    audienceObservasjon: string;
    retentionObservasjon: string;
  } | null;
  historiskAnalyse: {
    fungerteBra: string[];
    fungerteIkke: string[];
    børGjentas: string[];
    børUnngås: string[];
    toppInsikt: string;
  } | null;
}

// ── Score ring SVG ────────────────────────────────────────────────────────────

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const gradeColor =
    grade === 'S' ? '#00ff41' :
    grade === 'A' ? '#00cc33' :
    grade === 'B' ? '#88cc00' :
    grade === 'C' ? '#ffaa00' :
    '#ff4444';

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg width="144" height="144" className="rotate-[-90deg]">
        <circle cx="72" cy="72" r={r} fill="none" stroke="#1a2f1a" strokeWidth="8" />
        <circle
          cx="72" cy="72" r={r} fill="none"
          stroke={gradeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${fill} ${circ}`}
          style={{ filter: `drop-shadow(0 0 6px ${gradeColor})`, transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-mono font-bold" style={{ color: gradeColor, textShadow: `0 0 12px ${gradeColor}` }}>{score}</div>
        <div className="text-xs font-semibold" style={{ color: gradeColor }}>{grade}</div>
      </div>
    </div>
  );
}

// ── Retention curve SVG ───────────────────────────────────────────────────────

function RetentionChart({ data }: { data: RetentionPoint[] }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-28 text-sm text-g-muted">
        Retention-data samles under neste stream
      </div>
    );
  }

  const W = 560;
  const H = 100;
  const pad = { t: 8, r: 8, b: 24, l: 32 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const maxMin = Math.max(...data.map(d => d.minuteFromStart), 1);

  const pts = data.map(d => ({
    x: pad.l + (d.minuteFromStart / maxMin) * innerW,
    y: pad.t + innerH - (d.count / maxCount) * innerH,
    d,
  }));

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;

  const ticks = [0, Math.round(maxMin / 4), Math.round(maxMin / 2), Math.round(maxMin * 3 / 4), maxMin];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 100 }}>
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00ff41" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00ff41" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f}
          x1={pad.l} y1={pad.t + innerH * (1 - f)}
          x2={pad.l + innerW} y2={pad.t + innerH * (1 - f)}
          stroke="#1a2f1a" strokeWidth="1"
        />
      ))}
      <path d={areaD} fill="url(#rg)" />
      <path d={pathD} fill="none" stroke="#00ff41" strokeWidth="2"
        style={{ filter: 'drop-shadow(0 0 4px rgba(0,255,65,0.5))' }} />
      {[0, Math.round(maxCount / 2), maxCount].map(v => (
        <text key={v}
          x={pad.l - 4}
          y={pad.t + innerH - (v / maxCount) * innerH + 4}
          textAnchor="end" fontSize="9" fill="#4a6a4a">{v}</text>
      ))}
      {ticks.map(t => (
        <text key={t}
          x={pad.l + (t / maxMin) * innerW}
          y={H - 6}
          textAnchor="middle" fontSize="9" fill="#4a6a4a">{t}m</text>
      ))}
    </svg>
  );
}

// ── Viewer roster ─────────────────────────────────────────────────────────────

function ViewerRoster({ viewers, topChattters }: { viewers: ViewerEntry[]; topChattters: Array<{ username: string; messages: number }> }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'messages' | 'firstSeen'>('messages');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    let list = [...viewers];
    if (search) list = list.filter(v => v.username.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => sortBy === 'messages' ? b.messagesSent - a.messagesSent : new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime());
    return list;
  }, [viewers, search, sortBy]);

  const visible = showAll ? filtered : filtered.slice(0, 20);

  function badge(v: ViewerEntry) {
    if (v.moderator) return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-green-900/40 text-green-400 border border-green-800/50">MOD</span>;
    if (v.subscriber) return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-purple-900/40 text-purple-400 border border-purple-800/50">SUB</span>;
    if (v.vip) return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-pink-900/40 text-pink-400 border border-pink-800/50">VIP</span>;
    if (v.follower) return <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-900/40 text-blue-400 border border-blue-800/50">FLW</span>;
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søk bruker..."
          className="flex-1 bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all"
        />
        <div className="flex border border-g-border rounded-lg overflow-hidden">
          {(['messages', 'firstSeen'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${sortBy === s ? 'bg-g-green text-g-bg' : 'text-g-muted hover:text-g-text'}`}>
              {s === 'messages' ? 'Aktivitet' : 'Rekkefølge'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {visible.map((v, i) => (
          <div key={v.username}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-g-bg border border-g-border/50 hover:border-g-border transition-colors">
            <span className="text-xs font-mono text-g-muted w-6 text-right flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-g-text truncate">{v.username}</span>
                {badge(v)}
                {v.firstTimeSeen && (
                  <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-g-green/10 text-g-green border border-g-green/20">NY</span>
                )}
                {v.returningViewer && (
                  <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-g-card text-g-muted border border-g-border">↻</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono font-semibold text-g-green">{v.messagesSent}</div>
              <div className="text-xs text-g-muted">mld</div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-xs text-g-muted font-mono">
                {new Date(v.firstSeen).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-xs text-g-muted/60 font-mono">
                {new Date(v.lastSeen).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length > 20 && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full mt-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-g-muted hover:text-g-green border border-g-border hover:border-g-green/30 rounded-lg transition-colors">
          {showAll ? 'Vis færre' : `Vis alle ${filtered.length}`}
        </button>
      )}
    </div>
  );
}

// ── Coach Tips ────────────────────────────────────────────────────────────────

interface CoachTip {
  id:             string;
  stream_id:      string;
  tip_text:       string;
  tip_category:   string;
  sort_order:     number;
  is_executed:    boolean;
  executed_at:    string | null;
  outcome:        'positive' | 'negative' | 'pending' | null;
  metrics_before: Record<string, unknown> | null;
  metrics_after:  Record<string, unknown> | null;
  created_at:     string;
}

const CATEGORY_LABELS: Record<string, string> = {
  viewers:   'Seertall',
  chat:      'Chat',
  retention: 'Retention',
  growth:    'Vekst',
  community: 'Community',
  general:   'Generelt',
};

function CoachTips({
  streamId,
  score,
  game,
  toppInsikt,
  avgViewers,
  chatMessages,
}: {
  streamId:     string;
  score?:       { total: number; breakdown: Record<string, number> } | null;
  game?:        string;
  toppInsikt?:  string;
  avgViewers?:  number;
  chatMessages?: number;
}) {
  const [tips, setTips]       = useState<CoachTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // First try to load existing tips
    fetch(`/api/stream-coach/tips?streamId=${encodeURIComponent(streamId)}`)
      .then(r => r.json())
      .then(async (d: { tips: CoachTip[] }) => {
        if (cancelled) return;
        if (d.tips.length > 0) {
          setTips(d.tips);
          setLoading(false);
          return;
        }
        // Generate tips if none exist yet
        const genRes = await fetch('/api/stream-coach/tips', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ streamId, game, score, toppInsikt, avgViewers, chatMessages }),
        });
        const gen: { tips: CoachTip[] } = await genRes.json();
        if (!cancelled) {
          setTips(gen.tips ?? []);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleExecuted(tip: CoachTip) {
    setSaving(s => ({ ...s, [tip.id]: true }));
    const next = !tip.is_executed;
    await fetch(`/api/stream-coach/tips/${tip.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isExecuted: next }),
    });
    setTips(prev => prev.map(t => t.id === tip.id ? { ...t, is_executed: next, executed_at: next ? new Date().toISOString() : null } : t));
    setSaving(s => ({ ...s, [tip.id]: false }));
  }

  const outcomeIcon = (tip: CoachTip) => {
    if (!tip.is_executed) return null;
    if (tip.outcome === 'positive') return <span className="text-g-green text-xs font-semibold">✓ Slår ut positivt!</span>;
    if (tip.outcome === 'negative') return <span className="text-red-400 text-xs font-semibold">Ingen tydelig effekt — prøv noe annet</span>;
    if (tip.outcome === 'pending')  return <span className="text-yellow-400 text-xs">Følger med på effekt...</span>;
    return <span className="text-g-muted text-xs">Utført — følger opp ved neste stream</span>;
  };

  if (loading) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-5 animate-pulse space-y-3">
        <div className="h-3 bg-g-border rounded w-1/3" />
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-g-border/50 rounded-xl" />)}
      </div>
    );
  }

  if (tips.length === 0) return null;

  return (
    <div className="bg-g-card border border-yellow-500/20 rounded-2xl p-5">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-yellow-400 mb-4 pb-3 border-b border-g-border/40">
        Anbefalte tiltak — 3 konkrete steg
      </h2>
      <div className="space-y-3">
        {tips.map((tip, i) => (
          <div
            key={tip.id}
            className={`flex items-start gap-4 px-4 py-3.5 rounded-xl border transition-all ${
              tip.is_executed
                ? 'border-g-green/30 bg-g-green/5'
                : 'border-g-border bg-g-bg'
            }`}
          >
            <span className="text-yellow-400 font-mono font-bold text-sm flex-shrink-0 mt-0.5">{i + 1}.</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-g-border text-g-muted">
                  {CATEGORY_LABELS[tip.tip_category] ?? tip.tip_category}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${tip.is_executed ? 'text-g-muted line-through' : 'text-g-text'}`}>
                {tip.tip_text}
              </p>
              {tip.is_executed && (
                <div className="mt-1.5">{outcomeIcon(tip)}</div>
              )}
            </div>
            <button
              onClick={() => toggleExecuted(tip)}
              disabled={saving[tip.id]}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                tip.is_executed
                  ? 'border-g-green/40 bg-g-green/10 text-g-green hover:bg-g-green/20'
                  : 'border-g-border text-g-muted hover:border-g-green/40 hover:text-g-green hover:bg-g-green/5'
              } disabled:opacity-50`}
            >
              {saving[tip.id] ? '...' : tip.is_executed ? '✓ Utført' : 'Marker utført'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-g-muted/60 mt-3 leading-relaxed">
        Marker tipsene som utført. Vi følger med på om de gir effekt i neste stream — positive tiltak noteres og gjentas.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function StreamCoachInner() {
  const searchParams = useSearchParams();
  const initialStreamId = searchParams.get('streamId');

  const [data, setData] = useState<CoachReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialStreamId);
  const [activeTab, setActiveTab] = useState<'audience' | 'retention' | 'coach' | 'historical'>('coach');

  function load(streamId?: string) {
    setLoading(true);
    const url = streamId ? `/api/stream-coach?streamId=${encodeURIComponent(streamId)}` : '/api/stream-coach';
    fetch(url).then(r => r.json()).then((d: CoachReport) => {
      setData(d);
      setLoading(false);

      // Outcome tracking: if we're loading a new stream, check if previous stream's
      // executed tips need an outcome evaluation based on the new stream's metrics.
      if (d.history && d.history.length >= 2 && d.selectedStream) {
        const curIdx  = d.history.findIndex(h => h.id === (streamId ?? d.selectedStream?.id));
        const prevStream = d.history[curIdx + 1]; // older stream
        if (prevStream) {
          evaluatePreviousTips(prevStream.stream_id ?? prevStream.id, d.selectedStream);
        }
      }
    }).catch(() => setLoading(false));
  }

  function evaluatePreviousTips(prevStreamId: string, curStream: StreamSummary) {
    fetch(`/api/stream-coach/tips?streamId=${encodeURIComponent(prevStreamId)}`)
      .then(r => r.json())
      .then((d: { tips: CoachTip[] }) => {
        const pending = (d.tips ?? []).filter(t => t.is_executed && !t.outcome);
        for (const tip of pending) {
          const before = tip.metrics_before as Record<string, number> | null;
          const prevAvg = Number(before?.avgViewers ?? 0);
          const curAvg  = curStream.avg_viewers ?? 0;
          const outcome: 'positive' | 'negative' = curAvg > prevAvg * 1.1 ? 'positive' : 'negative';
          const metricsAfter = { avgViewers: curAvg, chatMessages: curStream.chat_messages, score: undefined };
          fetch(`/api/stream-coach/tips/${tip.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ outcome, metricsAfter }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }

  useEffect(() => { load(initialStreamId ?? undefined); }, [initialStreamId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectStream(streamId: string) {
    setSelectedId(streamId);
    load(streamId);
  }

  const s = data?.selectedStream;
  const score = data?.streamScore;
  const audience = data?.audience;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 animate-fade-in">

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold gradient-text">Stream Coach</h1>
          <p className="text-sm text-g-muted mt-1">Creator intelligence — hva fungerte, hvem var der, hva gjøres neste gang</p>
        </div>
        {!loading && data && data.history.length > 0 && (
          <span className="text-xs text-g-muted font-mono pb-0.5">{data.history.length} streams analysert</span>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-g-border/50 rounded w-1/4" />
            <div className="grid grid-cols-5 gap-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-24 bg-g-border/50 rounded-xl" />
              ))}
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-g-border/50 rounded w-full" />
              <div className="h-4 bg-g-border/50 rounded w-3/4" />
            </div>
          </div>
        </div>
      ) : !data || data.history.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-2xl p-12 text-center">
          <div className="text-4xl text-g-muted mb-4">◈</div>
          <p className="text-sm text-g-muted">Ingen stream-historikk ennå.</p>
          <p className="text-xs text-g-muted/60 mt-1">Data samles automatisk etter første stream.</p>
        </div>
      ) : (
        <>
          {/* Stream selector */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.history.slice(0, 8).map(h => {
              const isActive = (selectedId || data.selectedStream?.id) === h.id;
              return (
                <button
                  key={h.id}
                  onClick={() => selectStream(h.id)}
                  className={`flex-shrink-0 px-4 py-2.5 rounded-xl border text-left transition-all duration-200 ${
                    isActive
                      ? 'border-g-green/50 bg-g-green/5 shadow-green-sm'
                      : 'border-g-border bg-g-card hover:bg-g-card-hover'
                  }`}
                >
                  <div className="text-xs font-semibold text-g-text">{h.game || 'Ukjent'}</div>
                  <div className="text-[11px] text-g-muted mt-0.5">
                    {new Date(h.started_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short' })}
                  </div>
                </button>
              );
            })}
          </div>

          {s && (
            <>
              {/* KPI-rad */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Score ring */}
                <div className="col-span-2 lg:col-span-1 glass-card rounded-2xl p-4 flex flex-col items-center justify-center shadow-green-sm">
                  {score ? (
                    <>
                      <ScoreRing score={score.total} grade={score.grade} />
                      <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mt-2">Stream Score</p>
                    </>
                  ) : (
                    <div className="text-sm text-g-muted">Ingen score</div>
                  )}
                </div>

                {/* Peak seere */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Peak seere</p>
                  <p className="text-3xl font-mono font-bold text-g-green">{s.peak_viewers}</p>
                  <p className="text-xs text-g-muted mt-1 font-mono">Snitt {s.avg_viewers}</p>
                </div>

                {/* Varighet */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Varighet</p>
                  <p className="text-3xl font-mono font-bold text-g-green">
                    {s.duration_minutes >= 60
                      ? `${Math.floor(s.duration_minutes / 60)}t${s.duration_minutes % 60 > 0 ? `${s.duration_minutes % 60}m` : ''}`
                      : `${s.duration_minutes}m`}
                  </p>
                  <p className="text-xs text-g-muted mt-1">{s.game || 'Ukjent spill'}</p>
                </div>

                {/* Chat */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Chat-meldinger</p>
                  <p className="text-3xl font-mono font-bold text-g-green">{s.chat_messages}</p>
                  <p className="text-xs text-g-muted mt-1 font-mono">
                    {s.duration_minutes > 0 ? `${Math.round(s.chat_messages / (s.duration_minutes / 60))}/t` : '—'}
                  </p>
                </div>

                {/* Vekst */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Vekst</p>
                  <div className="flex items-end gap-3">
                    <div>
                      <p className="text-2xl font-mono font-bold text-g-green">+{s.followers_gained}</p>
                      <p className="text-xs text-g-muted">følgere</p>
                    </div>
                    <div>
                      <p className="text-2xl font-mono font-bold text-blue-400">+{s.subs_gained}</p>
                      <p className="text-xs text-g-muted">subs</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top insight */}
              {data.analyse?.toppInsikt && (
                <div className="bg-g-card border border-g-green/20 rounded-2xl p-5 flex items-start gap-4">
                  <span className="text-g-green text-lg mt-0.5 flex-shrink-0">◆</span>
                  <div>
                    <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-2">AI Topp-innsikt</p>
                    <p className="text-sm text-g-text font-medium leading-relaxed">{data.analyse.toppInsikt}</p>
                    {data.analyse.audienceObservasjon && (
                      <p className="text-xs text-g-muted mt-2 leading-relaxed">{data.analyse.audienceObservasjon}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Actionable tips with outcome tracking */}
              {s && (
                <CoachTips
                  streamId={s.stream_id ?? s.id}
                  score={score}
                  game={s.game}
                  toppInsikt={data.analyse?.toppInsikt}
                  avgViewers={s.avg_viewers}
                  chatMessages={s.chat_messages}
                />
              )}

              {/* Score breakdown */}
              {score && (
                <div className="bg-g-card border border-g-border rounded-2xl p-6">
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
                    Score-fordeling
                  </h2>
                  <div className="space-y-3">
                    {([
                      ['Seertall', score.breakdown.viewers, 20],
                      ['Retention', score.breakdown.retention, 20],
                      ['Chat-aktivitet', score.breakdown.chat, 20],
                      ['Vekst', score.breakdown.growth, 20],
                      ['Community', score.breakdown.community, 20],
                    ] as [string, number, number][]).map(([label, val, max]) => (
                      <div key={label} className="flex items-center gap-4">
                        <span className="text-xs text-g-muted w-28 flex-shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-g-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-g-green rounded-full"
                            style={{ width: `${(val / max) * 100}%`, boxShadow: '0 0 6px rgba(0,255,65,0.4)' }}
                          />
                        </div>
                        <span className="text-xs font-mono text-g-green w-10 text-right">{val}/{max}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab navigation */}
              <div className="flex border-b border-g-border">
                {([
                  ['coach', 'Coach-rapport'],
                  ['audience', `Publikum${audience ? ` (${audience.total})` : ''}`],
                  ['retention', 'Retention'],
                  ['historical', 'Historisk'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
                      activeTab === tab
                        ? 'border-g-green text-g-green'
                        : 'border-transparent text-g-muted hover:text-g-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab: Coach-rapport */}
              {activeTab === 'coach' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-g-card border border-g-border rounded-2xl p-5">
                      <h3 className="text-xs font-semibold tracking-widest uppercase text-g-green mb-3 pb-2 border-b border-g-border/40">
                        Hva fungerte
                      </h3>
                      {data.analyse?.fungerteBra && data.analyse.fungerteBra.length > 0 ? (
                        <ul className="space-y-2.5">
                          {data.analyse.fungerteBra.map((item, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-g-text">
                              <span className="text-g-green mt-0.5 flex-shrink-0">▸</span>
                              <span className="leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-g-muted">Ikke nok data ennå</p>
                      )}
                    </div>

                    <div className="bg-g-card border border-g-border rounded-2xl p-5">
                      <h3 className="text-xs font-semibold tracking-widest uppercase text-red-400 mb-3 pb-2 border-b border-g-border/40">
                        Hva fungerte ikke
                      </h3>
                      {data.analyse?.fungerteIkke && data.analyse.fungerteIkke.length > 0 ? (
                        <ul className="space-y-2.5">
                          {data.analyse.fungerteIkke.map((item, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-g-text">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">▸</span>
                              <span className="leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-g-muted">Ikke nok data ennå</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-g-card border border-g-border rounded-2xl p-5">
                    <h3 className="text-xs font-semibold tracking-widest uppercase text-yellow-400 mb-4 pb-2 border-b border-g-border/40">
                      Anbefalinger — neste stream
                    </h3>
                    {data.analyse?.anbefalinger && data.analyse.anbefalinger.length > 0 ? (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {data.analyse.anbefalinger.map((item, i) => (
                          <div key={i} className="flex items-start gap-3 px-4 py-3 bg-g-bg border border-g-border rounded-xl">
                            <span className="text-yellow-400 mt-0.5 flex-shrink-0 text-sm font-mono font-semibold">{i + 1}.</span>
                            <span className="text-sm text-g-text leading-relaxed">{item}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-g-muted">Anbefalinger genereres etter neste stream</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab: Publikum */}
              {activeTab === 'audience' && (
                <div className="space-y-4">
                  {!audience ? (
                    <div className="bg-g-card border border-g-border rounded-2xl p-10 text-center">
                      <p className="text-sm text-g-muted">Publikumssporing starter automatisk fra neste stream.</p>
                      <p className="text-xs text-g-muted/60 mt-1">Data samles i sanntid når du er live.</p>
                    </div>
                  ) : (
                    <>
                      {/* Audience stats */}
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {([
                          ['Totalt', audience.total, 'text-g-text'],
                          ['Nye', audience.newViewers, 'text-g-green'],
                          ['Returnerende', audience.returningViewers, 'text-blue-400'],
                          ['Subscribers', audience.subscribers, 'text-purple-400'],
                          ['VIP', audience.vips, 'text-pink-400'],
                          ['Mods', audience.moderators, 'text-green-400'],
                        ] as [string, number, string][]).map(([label, val, color]) => (
                          <div key={label} className="bg-g-card border border-g-border rounded-xl p-3 text-center">
                            <p className={`text-2xl font-mono font-bold ${color}`}>{val}</p>
                            <p className="text-[11px] text-g-muted mt-1">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Audience distribution bar */}
                      {audience.total > 0 && (
                        <div className="bg-g-card border border-g-border rounded-2xl p-5">
                          <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-2 border-b border-g-border/40">
                            Publikumsfordeling
                          </h3>
                          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                            {audience.newViewers > 0 && (
                              <div
                                className="bg-g-green"
                                style={{ width: `${(audience.newViewers / audience.total) * 100}%`, boxShadow: '0 0 8px rgba(0,255,65,0.4)' }}
                                title={`Nye: ${audience.newViewers}`}
                              />
                            )}
                            {audience.returningViewers > 0 && (
                              <div
                                className="bg-blue-500"
                                style={{ width: `${(audience.returningViewers / audience.total) * 100}%` }}
                                title={`Returnerende: ${audience.returningViewers}`}
                              />
                            )}
                            {(audience.total - audience.newViewers - audience.returningViewers) > 0 && (
                              <div className="bg-g-border flex-1" title="Ukjent" />
                            )}
                          </div>
                          <div className="flex gap-5 mt-3">
                            <span className="flex items-center gap-1.5 text-xs text-g-muted">
                              <span className="w-2 h-2 rounded-full bg-g-green inline-block" />
                              Nye ({Math.round(audience.newViewers / audience.total * 100)}%)
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-g-muted">
                              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                              Returnerende ({Math.round(audience.returningViewers / audience.total * 100)}%)
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Viewer table */}
                      <div className="bg-g-card border border-g-border rounded-2xl p-5">
                        <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-2 border-b border-g-border/40">
                          Brukere innom streamen
                        </h3>
                        <ViewerRoster viewers={audience.viewers} topChattters={audience.topChattters} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Tab: Retention */}
              {activeTab === 'retention' && (
                <div className="space-y-4">
                  <div className="bg-g-card border border-g-border rounded-2xl p-6">
                    <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
                      Seertall over tid
                    </h3>
                    <RetentionChart data={data.retentionCurve ?? []} />
                    {data.analyse?.retentionObservasjon && (
                      <div className="mt-4 pt-4 border-t border-g-border/40">
                        <p className="text-sm text-g-text leading-relaxed flex items-start gap-2">
                          <span className="text-g-green flex-shrink-0">◆</span>
                          {data.analyse.retentionObservasjon}
                        </p>
                      </div>
                    )}
                  </div>

                  {data.retentionCurve && data.retentionCurve.length > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {([
                        ['Åpning', data.retentionCurve[0]?.count ?? 0],
                        ['Peak', Math.max(...data.retentionCurve.map(r => r.count))],
                        ['Avslutning', data.retentionCurve[data.retentionCurve.length - 1]?.count ?? 0],
                      ] as [string, number][]).map(([label, val]) => (
                        <div key={label} className="bg-g-card border border-g-border rounded-xl p-5 text-center">
                          <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">{label}</p>
                          <p className="text-3xl font-mono font-bold text-g-green">{val}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Historisk */}
              {activeTab === 'historical' && (
                <div className="space-y-4">
                  {data.historiskAnalyse ? (
                    <>
                      <div className="bg-g-card border border-g-green/20 rounded-2xl p-5 flex items-start gap-4">
                        <span className="text-g-green text-lg mt-0.5 flex-shrink-0">◆</span>
                        <div>
                          <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted mb-2">Historisk mønster</p>
                          <p className="text-sm text-g-text font-medium leading-relaxed">{data.historiskAnalyse.toppInsikt}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {([
                          ['Fungerer bra', data.historiskAnalyse.fungerteBra, 'text-g-green'],
                          ['Fungerer ikke', data.historiskAnalyse.fungerteIkke, 'text-red-400'],
                          ['Bør gjentas', data.historiskAnalyse.børGjentas, 'text-blue-400'],
                          ['Bør unngås', data.historiskAnalyse.børUnngås, 'text-yellow-400'],
                        ] as [string, string[], string][]).map(([label, items, color]) => (
                          <div key={label} className="bg-g-card border border-g-border rounded-2xl p-5">
                            <h3 className={`text-xs font-semibold tracking-widest uppercase mb-3 pb-2 border-b border-g-border/40 ${color}`}>
                              {label}
                            </h3>
                            <ul className="space-y-2.5">
                              {(items ?? []).map((item, i) => (
                                <li key={i} className="flex items-start gap-2.5 text-sm text-g-text">
                                  <span className={`mt-0.5 flex-shrink-0 ${color}`}>▸</span>
                                  <span className="leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="bg-g-card border border-g-border rounded-2xl p-10 text-center">
                      <p className="text-sm text-g-muted">Historisk analyse krever minst 3 streams.</p>
                    </div>
                  )}

                  {/* Stream-historikk tabell */}
                  <div className="bg-g-card border border-g-border rounded-2xl p-5">
                    <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
                      Siste streams
                    </h3>
                    <div className="space-y-2">
                      {data.history.slice(0, 10).map(h => (
                        <button
                          key={h.id}
                          onClick={() => selectStream(h.id)}
                          className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                            (selectedId || data.selectedStream?.id) === h.id
                              ? 'border-g-green/40 bg-g-green/5'
                              : 'border-g-border bg-g-bg hover:bg-g-card-hover'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <span className="text-sm font-medium text-g-text">{h.game || 'Ukjent'}</span>
                              <span className="text-xs text-g-muted ml-3 font-mono">
                                {new Date(h.started_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                            <span className="text-xs text-g-muted font-mono">
                              {h.duration_minutes >= 60
                                ? `${Math.floor(h.duration_minutes / 60)}t${h.duration_minutes % 60 > 0 ? `${h.duration_minutes % 60}m` : ''}`
                                : `${h.duration_minutes}m`}
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {([
                              ['Peak', h.peak_viewers],
                              ['Snitt', h.avg_viewers],
                              ['Chat', h.chat_messages],
                              ['Flw', `+${h.followers_gained}`],
                              ['Sub', `+${h.subs_gained}`],
                            ] as [string, string | number][]).map(([l, v]) => (
                              <div key={l} className="text-center">
                                <p className="text-[11px] text-g-muted uppercase tracking-wide">{l}</p>
                                <p className="text-xs font-mono font-semibold text-g-green">{v}</p>
                              </div>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function StreamCoachPage() {
  return (
    <Suspense fallback={null}>
      <StreamCoachInner />
    </Suspense>
  );
}
