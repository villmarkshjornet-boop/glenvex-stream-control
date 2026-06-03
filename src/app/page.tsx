'use client';

import { useEffect, useState, useCallback } from 'react';
import LiveStatusCard from '@/components/LiveStatusCard';
import SystemStatusCard from '@/components/SystemStatusCard';
import StatsCards from '@/components/StatsCards';
import QuickActions from '@/components/QuickActions';
import ConfigPanel from '@/components/ConfigPanel';
import LogsPreview from '@/components/LogsPreview';
import type { StatusResponse } from '@/types';

export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setData(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
          Dashboard
        </h1>
        <p className="text-xs text-g-muted mt-0.5">Oversikt over systemet</p>
      </div>

      {/* Row 1: Live Status + System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveStatusCard stream={data?.stream ?? null} loading={loading} />
        <SystemStatusCard
          twitchApi={data?.twitchApi ?? 'offline'}
          discordBot={data?.discordBot ?? 'offline'}
          lastCheck={data?.recentLogs?.[0]?.timestamp}
          loading={loading}
        />
      </div>

      {/* Row 2: Stats */}
      <StatsCards
        lastNotification={data?.lastNotification}
        totalAlerts={data?.totalAlerts ?? 0}
        memberCount={
          data?.guild?.approximate_member_count ?? data?.guild?.member_count
        }
        loading={loading}
      />

      {/* Row 3: Logs + Quick Actions + Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <LogsPreview logs={data?.recentLogs ?? []} loading={loading} maxRows={7} />
        </div>
        <QuickActions
          twitchUrl={data?.settings?.twitchUrl}
          onRefresh={refresh}
        />
        <ConfigPanel
          settings={data?.settings ?? null}
          onSave={() => refresh()}
        />
      </div>
    </div>
  );
}
