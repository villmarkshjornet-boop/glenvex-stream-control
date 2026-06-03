'use client';

import type { StreamInfo } from '@/types';

interface Props {
  stream: StreamInfo | null;
  loading?: boolean;
}

function formatDuration(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}t ${m}m` : `${m}m`;
}

export default function LiveStatusCard({ stream, loading }: Props) {
  return (
    <div className="bg-g-card border border-g-border rounded-lg p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
          Live Status
        </h2>
        {stream?.isLive ? (
          <div className="flex items-center gap-1.5 bg-red-600/20 border border-red-600/40 rounded px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-green" />
            <span className="text-[10px] text-red-400 font-bold tracking-widest">LIVE</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-g-muted/10 border border-g-border rounded px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-g-muted" />
            <span className="text-[10px] text-g-muted font-bold tracking-widest">OFFLINE</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
        </div>
      ) : stream?.isLive ? (
        <div className="flex gap-4">
          {/* Thumbnail */}
          {stream.thumbnailUrl ? (
            <img
              src={stream.thumbnailUrl}
              alt="Stream thumbnail"
              className="w-32 h-[72px] rounded object-cover border border-g-border flex-shrink-0"
            />
          ) : (
            <div className="w-32 h-[72px] rounded bg-g-bg border border-g-border flex items-center justify-center flex-shrink-0">
              <span className="text-g-muted text-xl">◈</span>
            </div>
          )}

          {/* Info */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-g-green font-bold text-base leading-tight truncate"
              style={{ textShadow: '0 0 8px rgba(0,255,65,0.4)' }}>
              GLENVEX ER LIVE!
            </p>
            <p className="text-g-text text-sm font-semibold truncate">{stream.game}</p>
            <p className="text-g-muted text-xs truncate">{stream.title}</p>
            <div className="flex items-center gap-3 mt-1">
              {stream.startedAt && (
                <span className="text-[11px] text-g-muted">
                  ⏱ Startet: {formatDuration(stream.startedAt)} siden
                </span>
              )}
              {stream.viewerCount !== undefined && (
                <span className="text-[11px] text-g-muted">
                  👁 {stream.viewerCount.toLocaleString()} seere
                </span>
              )}
            </div>
            {stream.streamUrl && (
              <a
                href={stream.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 bg-g-green/10 hover:bg-g-green/20 border border-g-green/30 text-g-green text-xs font-semibold px-3 py-1.5 rounded transition-all w-fit"
              >
                ▶ Åpne Stream
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-g-bg border border-g-border flex items-center justify-center">
            <span className="text-3xl text-g-muted">◈</span>
          </div>
          <div>
            <p className="text-g-text font-semibold">GLENVEX er ikke live</p>
            <p className="text-g-muted text-xs mt-1">
              Ingen aktiv stream detektert
            </p>
            {stream?.streamUrl && (
              <a
                href={stream.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-g-green hover:underline"
              >
                twitch.tv/glenvex →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
