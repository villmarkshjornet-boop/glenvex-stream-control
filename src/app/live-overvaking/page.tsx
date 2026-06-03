'use client';

import { useEffect, useState, useCallback } from 'react';
import LiveStatusCard from '@/components/LiveStatusCard';
import type { StreamInfo } from '@/types';

export default function LiveOvervaking() {
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/twitch/live');
      if (res.ok) {
        setStream(await res.json());
        setLastUpdated(new Date().toLocaleTimeString('no-NO'));
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
            Live Overvåking
          </h1>
          <p className="text-xs text-g-muted mt-0.5">
            Sanntids Twitch-status for GLENVEX
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 bg-g-card border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
        >
          ↻ Oppdater
        </button>
      </div>

      <LiveStatusCard stream={stream} loading={loading} />

      {/* Detail cards */}
      {stream && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Status', value: stream.isLive ? 'LIVE' : 'Offline', color: stream.isLive ? 'text-red-400' : 'text-g-muted' },
            { label: 'Spill', value: stream.game || '–', color: 'text-g-text' },
            { label: 'Seere', value: stream.viewerCount?.toLocaleString() || '–', color: 'text-g-green' },
            { label: 'Streamer', value: stream.userName || 'glenvex', color: 'text-g-text' },
          ].map((item) => (
            <div key={item.label} className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[10px] text-g-muted uppercase tracking-widest">{item.label}</p>
              <p className={`text-base font-bold font-mono mt-1 ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stream title */}
      {stream?.title && (
        <div className="bg-g-card border border-g-border rounded-lg p-4">
          <p className="text-[10px] text-g-muted uppercase tracking-widest mb-1">Stream-tittel</p>
          <p className="text-g-text">{stream.title}</p>
        </div>
      )}

      {/* Thumbnail */}
      {stream?.thumbnailUrl && (
        <div className="bg-g-card border border-g-border rounded-lg p-4">
          <p className="text-[10px] text-g-muted uppercase tracking-widest mb-3">Thumbnail</p>
          <img
            src={stream.thumbnailUrl.replace('{width}', '640').replace('{height}', '360')}
            alt="Twitch thumbnail"
            className="w-full max-w-lg rounded border border-g-border"
          />
        </div>
      )}

      {lastUpdated && (
        <p className="text-[10px] text-g-muted text-right">
          Sist oppdatert: {lastUpdated} • Auto-refresh hvert 20. sek
        </p>
      )}
    </div>
  );
}
