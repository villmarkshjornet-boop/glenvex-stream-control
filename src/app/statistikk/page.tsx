'use client';

import { useEffect, useState, useCallback } from 'react';

interface Raid { username: string; viewers: number; timestamp: string; }
interface GiftSub { username: string; count: number; timestamp: string; }
interface EventData { weekNumber: number; raids: Raid[]; giftSubs: GiftSub[]; }

interface RecentFollower { user_name: string; followed_at: string; }
interface ChartPoint { ts: string; total: number; }
interface GrowthData {
  total: number;
  gainDag: number | null;
  gainUke: number | null;
  recentFollowers: RecentFollower[];
  chartData: ChartPoint[];
  harBrukertToken: boolean;
}

function GainBadge({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const pos = value >= 0;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${
      pos ? 'border-g-green/30 text-g-green bg-g-green/5' : 'border-red-500/30 text-red-400 bg-red-500/5'
    }`}>
      {pos ? '↑' : '↓'} {pos ? '+' : ''}{value} {label}
    </div>
  );
}

function MiniChart({ data }: { data: ChartPoint[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data.map(d => d.total));
  const max = Math.max(...data.map(d => d.total));
  const range = max - min || 1;
  const W = 280;
  const H = 48;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d.total - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={W} height={H} className="overflow-visible w-full">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00e676" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill="url(#chartGrad)"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="#00e676"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(data.length - 1) / (data.length - 1) * W}
        cy={H - ((data[data.length - 1].total - min) / range) * H}
        r="3"
        fill="#00e676"
      />
    </svg>
  );
}

export default function StatistikkPage() {
  const [events, setEvents] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [sisteOppdatert, setSisteOppdatert] = useState<Date | null>(null);

  const hentGrowth = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/growth');
      if (res.ok) {
        setGrowth(await res.json());
        setSisteOppdatert(new Date());
      }
    } catch {}
    setGrowthLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(d => { setEvents(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    hentGrowth();
    const t = setInterval(hentGrowth, 30_000);
    return () => clearInterval(t);
  }, [hentGrowth]);

  const topRaids = [...(events?.raids ?? [])].sort((a, b) => b.viewers - a.viewers).slice(0, 5);
  const topGifters = [...(events?.giftSubs ?? [])].sort((a, b) => b.count - a.count).slice(0, 5);
  const totalRaidViewers = events?.raids.reduce((s, r) => s + r.viewers, 0) ?? 0;
  const totalGiftSubs = events?.giftSubs.reduce((s, g) => s + g.count, 0) ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-g-text">Statistikk</h1>
          <p className="text-sm text-g-muted mt-1">
            Uke {events?.weekNumber ?? '–'} · Vekstanalyse og events
          </p>
        </div>
        {sisteOppdatert && (
          <div className="flex items-center gap-1.5 pb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
            <span className="text-xs text-g-muted font-mono">
              {sisteOppdatert.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* Hero metrics row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Følgere totalt</p>
          {growthLoading ? (
            <div className="animate-pulse h-10 bg-g-border/50 rounded w-3/4" />
          ) : (
            <>
              <p className="text-4xl font-mono font-bold text-g-green leading-none">
                {growth?.total.toLocaleString('no-NO') ?? '–'}
              </p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <GainBadge value={growth?.gainDag ?? null} label="24t" />
                <GainBadge value={growth?.gainUke ?? null} label="7d" />
              </div>
            </>
          )}
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Raids denne uken</p>
          <p className="text-4xl font-mono font-bold text-g-text leading-none">
            {loading ? '–' : (events?.raids.length ?? 0)}
          </p>
          <p className="text-xs text-g-muted mt-2 font-mono">
            {totalRaidViewers.toLocaleString()} seere totalt
          </p>
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">Gift subs totalt</p>
          <p className="text-4xl font-mono font-bold text-g-text leading-none">
            {loading ? '–' : totalGiftSubs.toLocaleString()}
          </p>
          <p className="text-xs text-g-muted mt-2">denne uken</p>
        </div>
      </div>

      {/* Growth sparkline */}
      {!growthLoading && growth && growth.chartData.length >= 2 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Vekst siste 7 dager
          </h2>
          <div className="bg-g-bg border border-g-border rounded-xl px-4 py-4">
            <MiniChart data={growth.chartData} />
          </div>
        </div>
      )}

      {/* Recent followers */}
      {!growthLoading && growth && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Siste nye følgere
          </h2>
          {growth.recentFollowers.length > 0 ? (
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {growth.recentFollowers.map((f, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-g-bg border border-g-border/50">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-g-green/60 flex-shrink-0" />
                    <span className="text-sm font-medium text-g-text">{f.user_name}</span>
                  </div>
                  <span className="text-xs text-g-muted font-mono">
                    {formatRelativ(f.followed_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-g-muted">
                {growth.harBrukertToken
                  ? 'Ingen nylige følgere å vise'
                  : 'TWITCH_USER_OAUTH mangler — kan ikke vise enkeltfølgere'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Topp raids + topp gift-givere */}
      <div className="grid grid-cols-2 gap-6">

        {/* Topp raids */}
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Topp raids denne uken
          </h2>
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-g-border/50 rounded w-3/4" />
              <div className="h-4 bg-g-border/50 rounded w-1/2" />
              <div className="h-4 bg-g-border/50 rounded w-2/3" />
            </div>
          ) : topRaids.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-g-muted">Ingen raids registrert ennå.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {topRaids.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-g-border/20 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-g-green font-mono font-bold text-sm w-5">{i + 1}</span>
                    <div>
                      <p className="text-sm text-g-text font-medium">{r.username}</p>
                      <p className="text-xs text-g-muted">
                        {new Date(r.timestamp).toLocaleDateString('no-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className="text-g-green font-mono font-semibold text-xs">{r.viewers.toLocaleString()} seere</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Topp gift-givere */}
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Topp gift-givere denne uken
          </h2>
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-g-border/50 rounded w-3/4" />
              <div className="h-4 bg-g-border/50 rounded w-1/2" />
              <div className="h-4 bg-g-border/50 rounded w-2/3" />
            </div>
          ) : topGifters.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-g-muted">Ingen gift subs registrert ennå.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {topGifters.map((g, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-g-border/20 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`font-mono font-bold text-sm w-5 ${i === 0 ? 'text-yellow-400' : 'text-g-green'}`}>{i + 1}</span>
                    <p className="text-sm text-g-text font-medium">{g.username}</p>
                  </div>
                  <span className="text-g-green font-mono font-semibold text-xs">{g.count} subs</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alle raids — full log */}
      {(events?.raids.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
            Alle raids denne uken
          </h2>
          <div className="space-y-px max-h-60 overflow-y-auto">
            {[...(events?.raids ?? [])].reverse().map((r, i) => (
              <div key={i} className="flex justify-between py-2 text-xs border-b border-g-border/20 last:border-0">
                <span className="text-g-text font-mono">{r.username}</span>
                <span className="text-g-muted font-mono">
                  {r.viewers} seere · {new Date(r.timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativ(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'nå akkurat';
  if (min < 60) return `${min}m siden`;
  const t = Math.floor(min / 60);
  if (t < 24) return `${t}t siden`;
  return `${Math.floor(t / 24)}d siden`;
}
