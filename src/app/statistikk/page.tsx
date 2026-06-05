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
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${
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
    <svg width={W} height={H} className="overflow-visible">
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
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Statistikk</h1>
          <p className="text-xs text-g-muted mt-0.5">Uke {events?.weekNumber ?? '–'} · Vekstanalyse og events</p>
        </div>
        {sisteOppdatert && (
          <p className="text-[9px] text-g-muted">
            ↻ {sisteOppdatert.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
      </div>

      {/* ─── Vekstanalyse ──────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">◆ Twitch Vekstanalyse</p>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
            <span className="text-[9px] text-g-green">Live · 30s</span>
          </div>
        </div>

        {growthLoading ? (
          <div className="h-24 bg-g-bg border border-g-border rounded-lg animate-pulse" />
        ) : growth ? (
          <>
            {/* Hoved-tall */}
            <div className="flex items-end gap-4">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Følgere totalt</p>
                <p className="text-4xl font-black text-g-green font-mono leading-none mt-1">
                  {growth.total.toLocaleString('no-NO')}
                </p>
              </div>
              <div className="flex gap-2 pb-1">
                <GainBadge value={growth.gainDag} label="siste 24t" />
                <GainBadge value={growth.gainUke} label="siste 7d" />
              </div>
            </div>

            {/* Sparkline */}
            {growth.chartData.length >= 2 && (
              <div className="bg-g-bg border border-g-border rounded-lg px-4 py-3">
                <p className="text-[9px] text-g-muted mb-2">Siste 7 dager</p>
                <MiniChart data={growth.chartData} />
              </div>
            )}

            {/* Nylige følgere */}
            {growth.recentFollowers.length > 0 ? (
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Siste nye følgere</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {growth.recentFollowers.map((f, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-g-bg border border-g-border">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-g-green/60 flex-shrink-0" />
                        <span className="text-xs font-bold text-g-text">{f.user_name}</span>
                      </div>
                      <span className="text-[10px] text-g-muted">
                        {formatRelativ(f.followed_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-g-bg border border-g-border/50 rounded-lg">
                <p className="text-[10px] text-g-muted">
                  {growth.harBrukertToken
                    ? 'Ingen nylige følgere å vise'
                    : '⚠ TWITCH_USER_OAUTH (broadcaster-token) mangler – kan ikke vise enkeltfølgere, bare totaltall'}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-g-muted">Kunne ikke hente Twitch-data – sjekk at TWITCH_CLIENT_ID er satt i Vercel</p>
        )}
      </div>

      {/* ─── Event-oppsummering ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Raids denne uken', value: events?.raids.length ?? 0 },
          { label: 'Raid-seere totalt', value: totalRaidViewers.toLocaleString() },
          { label: 'Gift subs totalt', value: totalGiftSubs.toLocaleString() },
        ].map(item => (
          <div key={item.label} className="bg-g-card border border-g-border rounded-lg p-4">
            <p className="text-[10px] text-g-muted uppercase tracking-widest">{item.label}</p>
            <p className="text-2xl font-black text-g-green font-mono mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* ─── Topp raids ───────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
          🚨 Topp raids denne uken
        </h2>
        {loading ? (
          <p className="text-xs text-g-muted">Laster...</p>
        ) : topRaids.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen raids registrert ennå.</p>
        ) : (
          <div className="space-y-2">
            {topRaids.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-g-border/50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-g-green font-black font-mono text-sm w-5">{i + 1}</span>
                  <div>
                    <p className="text-sm text-g-text font-semibold">{r.username}</p>
                    <p className="text-[10px] text-g-muted">
                      {new Date(r.timestamp).toLocaleDateString('no-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <span className="text-g-green font-bold font-mono">{r.viewers.toLocaleString()} seere</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Topp gift-givere ─────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
          🎁 Topp gift-givere denne uken
        </h2>
        {loading ? (
          <p className="text-xs text-g-muted">Laster...</p>
        ) : topGifters.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen gift subs registrert ennå.</p>
        ) : (
          <div className="space-y-2">
            {topGifters.map((g, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-g-border/50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`font-black font-mono text-sm w-5 ${i === 0 ? 'text-yellow-400' : 'text-g-green'}`}>{i + 1}</span>
                  <p className="text-sm text-g-text font-semibold">{g.username}</p>
                </div>
                <span className="text-g-green font-bold font-mono">{g.count} subs giftet</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(events?.raids.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
            Alle raids denne uken
          </h2>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {[...(events?.raids ?? [])].reverse().map((r, i) => (
              <div key={i} className="flex justify-between py-1 text-xs border-b border-g-border/30 last:border-0">
                <span className="text-g-text font-mono">{r.username}</span>
                <span className="text-g-muted">{r.viewers} seere · {new Date(r.timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}</span>
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
