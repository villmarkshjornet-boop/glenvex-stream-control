'use client';

import { useEffect, useState } from 'react';

interface Raid {
  username: string;
  viewers: number;
  timestamp: string;
}

interface GiftSub {
  username: string;
  count: number;
  timestamp: string;
}

interface EventData {
  weekNumber: number;
  raids: Raid[];
  giftSubs: GiftSub[];
}

export default function StatistikkPage() {
  const [data, setData] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const topRaids = [...(data?.raids ?? [])].sort((a, b) => b.viewers - a.viewers).slice(0, 5);
  const topGifters = [...(data?.giftSubs ?? [])].sort((a, b) => b.count - a.count).slice(0, 5);
  const totalRaidViewers = data?.raids.reduce((s, r) => s + r.viewers, 0) ?? 0;
  const totalGiftSubs = data?.giftSubs.reduce((s, g) => s + g.count, 0) ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Statistikk</h1>
        <p className="text-xs text-g-muted mt-0.5">Ukentlig oversikt – Uke {data?.weekNumber ?? '–'}</p>
      </div>

      {/* Oppsummering */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Raids denne uken', value: data?.raids.length ?? 0 },
          { label: 'Raid-seere totalt', value: totalRaidViewers.toLocaleString() },
          { label: 'Gift subs totalt', value: totalGiftSubs.toLocaleString() },
        ].map(item => (
          <div key={item.label} className="bg-g-card border border-g-border rounded-lg p-4">
            <p className="text-[10px] text-g-muted uppercase tracking-widest">{item.label}</p>
            <p className="text-2xl font-black text-g-green font-mono mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Topp raids */}
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

      {/* Topp gift givers */}
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

      {/* Alle raids */}
      {(data?.raids.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
            Alle raids denne uken
          </h2>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {[...(data?.raids ?? [])].reverse().map((r, i) => (
              <div key={i} className="flex justify-between py-1 text-xs border-b border-g-border/30 last:border-0">
                <span className="text-g-text font-mono">{r.username}</span>
                <span className="text-g-muted">{r.viewers} seere • {new Date(r.timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
