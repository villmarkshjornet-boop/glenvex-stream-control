'use client';

interface StatCard {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}

interface Props {
  lastNotification?: string | null;
  totalAlerts: number;
  memberCount?: number;
  loading?: boolean;
}

function Card({ label, value, sub, color = 'text-g-green' }: StatCard) {
  return (
    <div className="bg-g-card border border-g-border rounded-lg p-4 flex flex-col gap-1 hover:border-g-green/20 transition-colors">
      <span className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className={`text-2xl font-black font-mono ${color}`}
        style={{ textShadow: color === 'text-g-green' ? '0 0 12px rgba(0,255,65,0.3)' : undefined }}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-g-muted">{sub}</span>}
    </div>
  );
}

export default function StatsCards({ lastNotification, totalAlerts, memberCount, loading }: Props) {
  function fmtTime(iso?: string | null) {
    if (!iso) return '–';
    const d = new Date(iso);
    return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(iso?: string | null) {
    if (!iso) return 'Ingen varsler ennå';
    const d = new Date(iso);
    return d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-g-card border border-g-border rounded-lg p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card
        label="Siste varsel sendt"
        value={fmtTime(lastNotification)}
        sub={fmtDate(lastNotification)}
        color="text-g-green"
      />
      <Card
        label="Total live varsler"
        value={totalAlerts.toString()}
        sub="Alle tider"
        color="text-g-green"
      />
      <Card
        label="Server medlemmer"
        value={memberCount ? memberCount.toLocaleString() : '–'}
        sub="Discord server"
        color="text-g-green"
      />
      <Card
        label="System kjøretid"
        value="100%"
        sub="Uptime"
        color="text-g-green"
      />
    </div>
  );
}
