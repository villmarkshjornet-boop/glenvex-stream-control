'use client';

import { useEffect, useState, useCallback } from 'react';

interface Tiltak {
  tekst: string;
  prioritet: 'lav' | 'medium' | 'høy' | 'kritisk';
}

interface ProducerData {
  isLive: boolean;
  stream: { title: string; game: string; viewerCount: number; thumbnailUrl?: string } | null;
  analyse: string;
  tiltak: Tiltak[];
  metrics: {
    viewers: number;
    activeDiscord: number;
    raidsToday: number;
    giftSubsToday: number;
    engagementScore: number;
  };
}

const PRIORITET_STIL: Record<string, string> = {
  lav:     'border-g-border text-g-muted bg-g-bg',
  medium:  'border-blue-400/30 text-blue-400 bg-blue-400/10',
  høy:     'border-yellow-400/30 text-yellow-400 bg-yellow-400/10',
  kritisk: 'border-red-400/40 text-red-400 bg-red-400/15 animate-pulse',
};

function MetricKort({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-g-bg border border-g-border rounded-lg p-4 text-center">
      <p className="text-[9px] text-g-muted uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-black text-g-green font-mono mt-1">{value}</p>
      {sub && <p className="text-[9px] text-g-muted mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AIProducerPage() {
  const [data, setData] = useState<ProducerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sisteOppdatert, setSisteOppdatert] = useState<Date | null>(null);

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-producer');
      if (res.ok) {
        setData(await res.json());
        setSisteOppdatert(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    hent();
    const interval = setInterval(hent, 30_000); // Oppdater hvert 30. sek
    return () => clearInterval(interval);
  }, [hent]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Producer</h1>
          <p className="text-xs text-g-muted mt-0.5">Sanntids stream-analyse og AI-anbefalinger</p>
        </div>
        <div className="text-right">
          {sisteOppdatert && (
            <p className="text-[9px] text-g-muted">Oppdatert {sisteOppdatert.toLocaleTimeString('no-NO')}</p>
          )}
          <div className={`flex items-center gap-1.5 justify-end mt-1 ${data?.isLive ? 'text-g-green' : 'text-g-muted'}`}>
            <span className={`w-2 h-2 rounded-full ${data?.isLive ? 'bg-g-green animate-pulse' : 'bg-g-muted'}`} />
            <span className="text-xs font-bold">{data?.isLive ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-12 text-center">
          <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
          <p className="text-xs text-g-muted mt-4">Analyserer stream...</p>
        </div>
      ) : !data?.isLive ? (
        <div className="bg-g-card border border-g-border rounded-lg p-12 text-center space-y-2">
          <p className="text-g-muted text-sm font-semibold">Du streamer ikke akkurat nå.</p>
          <p className="text-xs text-g-muted">AI Producer aktiveres automatisk når du går live. Oppdaterer hvert 30. sekund.</p>
        </div>
      ) : (
        <>
          {/* Stream-info */}
          {data.stream && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 flex gap-4 items-start">
              {data.stream.thumbnailUrl && (
                <img src={data.stream.thumbnailUrl} alt="Stream" className="w-32 h-18 object-cover rounded border border-g-border flex-shrink-0" style={{ aspectRatio: '16/9' }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-g-muted uppercase tracking-widest">{data.stream.game}</p>
                <p className="text-sm font-bold text-g-text mt-0.5">{data.stream.title}</p>
              </div>
            </div>
          )}

          {/* Metrics */}
          {data.metrics && (
            <div className="grid grid-cols-5 gap-3">
              <MetricKort label="Seere" value={data.metrics.viewers} />
              <MetricKort label="Discord aktive" value={data.metrics.activeDiscord} />
              <MetricKort label="Raids i dag" value={data.metrics.raidsToday} />
              <MetricKort label="Gift subs" value={data.metrics.giftSubsToday} />
              <MetricKort label="Engagement" value={`${data.metrics.engagementScore}%`} />
            </div>
          )}

          {/* AI Analyse */}
          {data.analyse && (
            <div className="bg-g-card border border-g-border rounded-lg p-5">
              <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">◆ AI Analyse</p>
              <p className="text-sm text-g-text leading-relaxed">{data.analyse}</p>
            </div>
          )}

          {/* Tiltak */}
          {data.tiltak.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-lg p-5">
              <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-3">AI Tiltak</p>
              <div className="space-y-2">
                {data.tiltak.map((t, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${PRIORITET_STIL[t.prioritet]}`}>
                    <span className="text-[10px] font-black uppercase tracking-widest w-16 flex-shrink-0">{t.prioritet}</span>
                    <p className="text-xs font-semibold">{t.tekst}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
