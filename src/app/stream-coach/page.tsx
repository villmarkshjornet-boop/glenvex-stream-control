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
  const gradeColor = grade === 'S' ? '#00ff41' : grade === 'A' ? '#00cc33' : grade === 'B' ? '#88cc00' : grade === 'C' ? '#ffaa00' : '#ff4444';

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
        <div className="text-3xl font-black font-mono" style={{ color: gradeColor, textShadow: `0 0 12px ${gradeColor}` }}>{score}</div>
        <div className="text-xs font-bold" style={{ color: gradeColor }}>{grade}</div>
      </div>
    </div>
  );
}

// ── Retention curve SVG ───────────────────────────────────────────────────────

function RetentionChart({ data }: { data: RetentionPoint[] }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-g-muted">
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
      {/* grid lines */}
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
      {/* y-axis labels */}
      {[0, Math.round(maxCount / 2), maxCount].map(v => (
        <text key={v}
          x={pad.l - 4}
          y={pad.t + innerH - (v / maxCount) * innerH + 4}
          textAnchor="end" fontSize="9" fill="#4a6a4a">{v}</text>
      ))}
      {/* x-axis labels */}
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
    if (v.moderator) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-900/40 text-green-400 border border-green-800/50">MOD</span>;
    if (v.subscriber) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-900/40 text-purple-400 border border-purple-800/50">SUB</span>;
    if (v.vip) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-pink-900/40 text-pink-400 border border-pink-800/50">VIP</span>;
    if (v.follower) return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-900/40 text-blue-400 border border-blue-800/50">FLW</span>;
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søk bruker..."
          className="flex-1 bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text placeholder-g-muted focus:outline-none focus:border-g-green/40"
        />
        <div className="flex border border-g-border rounded overflow-hidden">
          {(['messages', 'firstSeen'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${sortBy === s ? 'bg-g-green text-g-bg' : 'text-g-muted hover:text-g-text'}`}>
              {s === 'messages' ? 'Aktivitet' : 'Rekkefølge'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {visible.map((v, i) => (
          <div key={v.username}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-g-bg border border-g-border/50 hover:border-g-border transition-colors group">
            <span className="text-[10px] font-mono text-g-muted w-6 text-right">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-g-text truncate">{v.username}</span>
                {badge(v)}
                {v.firstTimeSeen && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-g-green/10 text-g-green border border-g-green/20">NY</span>
                )}
                {v.returningViewer && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-g-card text-g-muted border border-g-border">↻</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold font-mono text-g-green">{v.messagesSent}</div>
              <div className="text-[9px] text-g-muted">mld</div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[9px] text-g-muted">
                {new Date(v.firstSeen).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-[9px] text-g-muted/60">
                {new Date(v.lastSeen).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length > 20 && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full mt-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-g-muted hover:text-g-green border border-g-border hover:border-g-green/30 rounded-lg transition-colors">
          {showAll ? 'Vis færre' : `Vis alle ${filtered.length}`}
        </button>
      )}
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
    }).catch(() => setLoading(false));
  }

  useEffect(() => { load(initialStreamId ?? undefined); }, [initialStreamId]);

  function selectStream(streamId: string) {
    setSelectedId(streamId);
    load(streamId);
  }

  const s = data?.selectedStream;
  const score = data?.streamScore;
  const audience = data?.audience;

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-12">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase flex items-center gap-2">
            <span className="text-g-green">▲</span> Stream Coach
          </h1>
          <p className="text-xs text-g-muted mt-0.5">Creator intelligence — hva fungerte, hvem var der, hva gjøres neste gang</p>
        </div>
        {!loading && data && data.history.length > 0 && (
          <div className="text-[10px] text-g-muted font-mono">
            {data.history.length} streams analysert
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-xl p-12 text-center">
          <div className="text-g-green text-2xl mb-3 animate-pulse-green">◆</div>
          <p className="text-xs text-g-muted">Analyserer stream-data...</p>
        </div>
      ) : !data || data.history.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-xl p-12 text-center">
          <div className="text-4xl text-g-muted mb-4">◈</div>
          <p className="text-sm text-g-muted">Ingen stream-historikk ennå.</p>
          <p className="text-xs text-g-muted/60 mt-1">Data samles automatisk etter første stream.</p>
        </div>
      ) : (
        <>
          {/* ── Stream selector ── */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {data.history.slice(0, 8).map(h => {
              const isActive = (selectedId || data.selectedStream?.id) === h.id;
              return (
                <button key={h.id} onClick={() => selectStream(h.id)}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg border text-left transition-all ${
                    isActive
                      ? 'border-g-green/50 bg-g-green/5 shadow-green-sm'
                      : 'border-g-border bg-g-card hover:border-g-border/80'
                  }`}>
                  <div className="text-[10px] font-bold text-g-text">{h.game || 'Ukjent'}</div>
                  <div className="text-[9px] text-g-muted">{new Date(h.started_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short' })}</div>
                </button>
              );
            })}
          </div>

          {s && (
            <>
              {/* ── KPI-rad ── */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Score */}
                <div className="col-span-2 lg:col-span-1 bg-g-card border border-g-border rounded-xl p-4 flex flex-col items-center justify-center">
                  {score ? (
                    <>
                      <ScoreRing score={score.total} grade={score.grade} />
                      <p className="text-[10px] text-g-muted mt-2 uppercase tracking-widest">Stream Score</p>
                    </>
                  ) : (
                    <div className="text-g-muted text-xs">Ingen score</div>
                  )}
                </div>

                {/* Seere */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest mb-1">Peak seere</p>
                  <p className="text-3xl font-black font-mono text-g-green">{s.peak_viewers}</p>
                  <p className="text-[10px] text-g-muted mt-1">Snitt {s.avg_viewers}</p>
                </div>

                {/* Varighet */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest mb-1">Varighet</p>
                  <p className="text-3xl font-black font-mono text-g-green">
                    {s.duration_minutes >= 60
                      ? `${Math.floor(s.duration_minutes / 60)}t${s.duration_minutes % 60 > 0 ? `${s.duration_minutes % 60}m` : ''}`
                      : `${s.duration_minutes}m`}
                  </p>
                  <p className="text-[10px] text-g-muted mt-1">{s.game || 'Ukjent spill'}</p>
                </div>

                {/* Chat */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest mb-1">Chat-meldinger</p>
                  <p className="text-3xl font-black font-mono text-g-green">{s.chat_messages}</p>
                  <p className="text-[10px] text-g-muted mt-1">
                    {s.duration_minutes > 0 ? `${Math.round(s.chat_messages / (s.duration_minutes / 60))}/t` : '—'}
                  </p>
                </div>

                {/* Vekst */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest mb-1">Vekst</p>
                  <div className="flex items-end gap-3">
                    <div>
                      <p className="text-2xl font-black font-mono text-g-green">+{s.followers_gained}</p>
                      <p className="text-[9px] text-g-muted">følgere</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black font-mono text-blue-400">+{s.subs_gained}</p>
                      <p className="text-[9px] text-g-muted">subs</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Top insight ── */}
              {data.analyse?.toppInsikt && (
                <div className="bg-g-card border border-g-green/20 rounded-xl p-4 flex items-start gap-3"
                  style={{ boxShadow: '0 0 20px rgba(0,255,65,0.05)' }}>
                  <span className="text-g-green text-lg mt-0.5">◆</span>
                  <div>
                    <p className="text-[10px] text-g-muted uppercase tracking-widest font-semibold mb-1">AI Topp-innsikt</p>
                    <p className="text-sm text-g-text font-semibold leading-snug">{data.analyse.toppInsikt}</p>
                    {data.analyse.audienceObservasjon && (
                      <p className="text-xs text-g-muted mt-1">{data.analyse.audienceObservasjon}</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Score breakdown (hvis score finnes) ── */}
              {score && (
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest mb-3">Score-fordeling</p>
                  <div className="space-y-2">
                    {([
                      ['Seertall', score.breakdown.viewers, 20],
                      ['Retention', score.breakdown.retention, 20],
                      ['Chat-aktivitet', score.breakdown.chat, 20],
                      ['Vekst', score.breakdown.growth, 20],
                      ['Community', score.breakdown.community, 20],
                    ] as [string, number, number][]).map(([label, val, max]) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-[10px] text-g-muted w-28 flex-shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-g-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-g-green rounded-full"
                            style={{ width: `${(val / max) * 100}%`, boxShadow: '0 0 6px rgba(0,255,65,0.4)' }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-g-green w-10 text-right">{val}/{max}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tab navigation ── */}
              <div className="flex border-b border-g-border">
                {([
                  ['coach', 'Coach-rapport'],
                  ['audience', `Publikum${audience ? ` (${audience.total})` : ''}`],
                  ['retention', 'Retention'],
                  ['historical', 'Historisk'],
                ] as const).map(([tab, label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
                      activeTab === tab
                        ? 'border-g-green text-g-green'
                        : 'border-transparent text-g-muted hover:text-g-text'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Tab: Coach-rapport ── */}
              {activeTab === 'coach' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-g-card border border-g-border rounded-xl p-4">
                      <p className="text-[10px] font-bold text-g-green uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <span>✓</span> Hva fungerte
                      </p>
                      {data.analyse?.fungerteBra && data.analyse.fungerteBra.length > 0 ? (
                        <ul className="space-y-2">
                          {data.analyse.fungerteBra.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-g-text">
                              <span className="text-g-green mt-0.5 flex-shrink-0">▸</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-g-muted">Ikke nok data ennå</p>
                      )}
                    </div>

                    <div className="bg-g-card border border-g-border rounded-xl p-4">
                      <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <span>✗</span> Hva fungerte ikke
                      </p>
                      {data.analyse?.fungerteIkke && data.analyse.fungerteIkke.length > 0 ? (
                        <ul className="space-y-2">
                          {data.analyse.fungerteIkke.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-g-text">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">▸</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-g-muted">Ikke nok data ennå</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-g-card border border-g-border rounded-xl p-4">
                    <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <span>→</span> Anbefalinger — neste stream
                    </p>
                    {data.analyse?.anbefalinger && data.analyse.anbefalinger.length > 0 ? (
                      <div className="grid sm:grid-cols-2 gap-2">
                        {data.analyse.anbefalinger.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 px-3 py-2 bg-g-bg border border-g-border rounded-lg">
                            <span className="text-yellow-400 mt-0.5 flex-shrink-0 text-xs">{i + 1}.</span>
                            <span className="text-xs text-g-text">{item}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-g-muted">Anbefalinger genereres etter neste stream</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Tab: Publikum ── */}
              {activeTab === 'audience' && (
                <div className="space-y-4">
                  {!audience ? (
                    <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
                      <p className="text-xs text-g-muted">Publikumssporing starter automatisk fra neste stream.</p>
                      <p className="text-[10px] text-g-muted/60 mt-1">Data samles i sanntid når du er live.</p>
                    </div>
                  ) : (
                    <>
                      {/* Audience stats */}
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {[
                          ['Totalt', audience.total, 'text-g-text'],
                          ['Nye', audience.newViewers, 'text-g-green'],
                          ['Returnerende', audience.returningViewers, 'text-blue-400'],
                          ['Subscribers', audience.subscribers, 'text-purple-400'],
                          ['VIP', audience.vips, 'text-pink-400'],
                          ['Mods', audience.moderators, 'text-green-400'],
                        ].map(([label, val, color]) => (
                          <div key={label as string} className="bg-g-card border border-g-border rounded-lg p-3 text-center">
                            <p className={`text-xl font-black font-mono ${color}`}>{val}</p>
                            <p className="text-[9px] text-g-muted mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Audience distribution bar */}
                      {audience.total > 0 && (
                        <div className="bg-g-card border border-g-border rounded-xl p-4">
                          <p className="text-[10px] text-g-muted uppercase tracking-widest mb-3">Publikumsfordeling</p>
                          <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
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
                              <div
                                className="bg-g-border flex-1"
                                title="Ukjent"
                              />
                            )}
                          </div>
                          <div className="flex gap-4 mt-2">
                            <span className="flex items-center gap-1 text-[10px] text-g-muted">
                              <span className="w-2 h-2 rounded-full bg-g-green inline-block" /> Nye ({Math.round(audience.newViewers / audience.total * 100)}%)
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-g-muted">
                              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Returnerende ({Math.round(audience.returningViewers / audience.total * 100)}%)
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Viewer table */}
                      <div className="bg-g-card border border-g-border rounded-xl p-4">
                        <p className="text-[10px] text-g-muted uppercase tracking-widest mb-4">
                          Brukere innom streamen
                        </p>
                        <ViewerRoster viewers={audience.viewers} topChattters={audience.topChattters} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Tab: Retention ── */}
              {activeTab === 'retention' && (
                <div className="space-y-4">
                  <div className="bg-g-card border border-g-border rounded-xl p-4">
                    <p className="text-[10px] text-g-muted uppercase tracking-widest mb-3">Seertall over tid</p>
                    <RetentionChart data={data.retentionCurve ?? []} />
                    {data.analyse?.retentionObservasjon && (
                      <div className="mt-3 pt-3 border-t border-g-border">
                        <p className="text-xs text-g-text flex items-start gap-2">
                          <span className="text-g-green flex-shrink-0">◆</span>
                          {data.analyse.retentionObservasjon}
                        </p>
                      </div>
                    )}
                  </div>

                  {data.retentionCurve && data.retentionCurve.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-g-card border border-g-border rounded-xl p-4 text-center">
                        <p className="text-2xl font-black font-mono text-g-green">
                          {data.retentionCurve[0]?.count ?? 0}
                        </p>
                        <p className="text-[10px] text-g-muted mt-1">Åpning</p>
                      </div>
                      <div className="bg-g-card border border-g-border rounded-xl p-4 text-center">
                        <p className="text-2xl font-black font-mono text-g-green">
                          {Math.max(...data.retentionCurve.map(r => r.count))}
                        </p>
                        <p className="text-[10px] text-g-muted mt-1">Peak</p>
                      </div>
                      <div className="bg-g-card border border-g-border rounded-xl p-4 text-center">
                        <p className="text-2xl font-black font-mono text-g-green">
                          {data.retentionCurve[data.retentionCurve.length - 1]?.count ?? 0}
                        </p>
                        <p className="text-[10px] text-g-muted mt-1">Avslutning</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Historisk ── */}
              {activeTab === 'historical' && (
                <div className="space-y-4">
                  {data.historiskAnalyse ? (
                    <>
                      <div className="bg-g-card border border-g-border rounded-xl p-4 flex items-start gap-3">
                        <span className="text-g-green text-lg mt-0.5">◆</span>
                        <div>
                          <p className="text-[10px] text-g-muted uppercase tracking-widest font-semibold mb-1">Historisk mønster</p>
                          <p className="text-sm text-g-text font-semibold">{data.historiskAnalyse.toppInsikt}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {([
                          ['✓ Fungerer bra', data.historiskAnalyse.fungerteBra, 'text-g-green'],
                          ['✗ Fungerer ikke', data.historiskAnalyse.fungerteIkke, 'text-red-400'],
                          ['↻ Bør gjentas', data.historiskAnalyse.børGjentas, 'text-blue-400'],
                          ['⚠ Bør unngås', data.historiskAnalyse.børUnngås, 'text-yellow-400'],
                        ] as [string, string[], string][]).map(([label, items, color]) => (
                          <div key={label} className="bg-g-card border border-g-border rounded-xl p-4">
                            <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${color}`}>{label}</p>
                            <ul className="space-y-2">
                              {(items ?? []).map((item, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-g-text">
                                  <span className={`mt-0.5 flex-shrink-0 ${color}`}>▸</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
                      <p className="text-xs text-g-muted">Historisk analyse krever minst 3 streams.</p>
                    </div>
                  )}

                  {/* Stream-historikk tabell */}
                  <div className="bg-g-card border border-g-border rounded-xl p-4">
                    <p className="text-[10px] text-g-muted uppercase tracking-widest mb-4">Siste streams</p>
                    <div className="space-y-2">
                      {data.history.slice(0, 10).map(h => (
                        <button key={h.id} onClick={() => selectStream(h.id)}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            (selectedId || data.selectedStream?.id) === h.id
                              ? 'border-g-green/40 bg-g-green/5'
                              : 'border-g-border bg-g-bg hover:border-g-border/80'
                          }`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-xs font-bold text-g-text">{h.game || 'Ukjent'}</span>
                              <span className="text-[10px] text-g-muted ml-2">
                                {new Date(h.started_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                            <span className="text-[10px] text-g-muted">
                              {h.duration_minutes >= 60
                                ? `${Math.floor(h.duration_minutes / 60)}t${h.duration_minutes % 60 > 0 ? `${h.duration_minutes % 60}m` : ''}`
                                : `${h.duration_minutes}m`}
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            {[
                              ['Peak', h.peak_viewers],
                              ['Snitt', h.avg_viewers],
                              ['Chat', h.chat_messages],
                              ['Flw', `+${h.followers_gained}`],
                              ['Sub', `+${h.subs_gained}`],
                            ].map(([l, v]) => (
                              <div key={l as string} className="text-center">
                                <p className="text-[8px] text-g-muted uppercase">{l}</p>
                                <p className="text-[11px] font-black text-g-green font-mono">{v}</p>
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
