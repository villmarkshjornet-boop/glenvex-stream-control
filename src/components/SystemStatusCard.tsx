'use client';

interface Props {
  twitchApi: 'online' | 'offline' | 'error';
  discordBot: 'online' | 'offline' | 'error';
  lastCheck?: string | null;
  loading?: boolean;
}

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: 'online' | 'offline' | 'error';
}) {
  const color =
    status === 'online'
      ? 'text-g-green'
      : status === 'error'
        ? 'text-red-400'
        : 'text-yellow-400';
  const dotColor =
    status === 'online'
      ? 'bg-g-green shadow-green-sm'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-yellow-400';
  const label2 =
    status === 'online' ? 'Online' : status === 'error' ? 'Feil' : 'Offline';

  return (
    <div className="flex items-center justify-between py-2 border-b border-g-border/50 last:border-0">
      <span className="text-xs text-g-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold ${color}`}>{label2}</span>
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      </div>
    </div>
  );
}

export default function SystemStatusCard({ twitchApi, discordBot, lastCheck, loading }: Props) {
  const now = new Date();
  const nextCheck = new Date(now.getTime() + 30_000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="bg-g-card border border-g-border rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
          Systemstatus
        </h2>
        {!loading && (
          <div className="w-8 h-8 rounded-full border-2 border-g-green/30 flex items-center justify-center"
            style={{ boxShadow: '0 0 12px rgba(0,255,65,0.2)' }}>
            <span className="text-g-green text-sm">✓</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 bg-g-bg rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div>
          <StatusRow label="Twitch API" status={twitchApi} />
          <StatusRow label="Discord Bot" status={discordBot} />
          <div className="flex items-center justify-between py-2 border-b border-g-border/50">
            <span className="text-xs text-g-muted">Siste sjekk</span>
            <span className="text-xs text-g-text font-mono">
              {lastCheck ? new Date(lastCheck).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : fmt(now)}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-g-muted">Neste sjekk</span>
            <span className="text-xs text-g-text font-mono">{fmt(nextCheck)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
