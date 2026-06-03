'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import LiveStatusCard from '@/components/LiveStatusCard';
import SystemStatusCard from '@/components/SystemStatusCard';
import StatsCards from '@/components/StatsCards';
import QuickActions from '@/components/QuickActions';
import ConfigPanel from '@/components/ConfigPanel';
import LogsPreview from '@/components/LogsPreview';
import type { StatusResponse } from '@/types';

interface BotHealth { online: boolean; latency?: number; status: string; }
interface FeaturedPartner { navn: string; rabattkode: string; affiliateLink: string; beskrivelse: string; logo?: string; }

export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [featured, setFeatured] = useState<FeaturedPartner | null>(null);
  const [aiScores, setAiScores] = useState<{ communityScore: number; growthScore: number; sponsorScore: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    // Bot health
    fetch('/api/bot-health').then(r => r.json()).then(setBotHealth).catch(() => {});
    // Featured partner
    fetch('/api/partners/featured').then(r => r.json()).then(d => { if (d?.navn) setFeatured(d); }).catch(() => {});
    // AI Scores
    fetch('/api/ai-scores').then(r => r.json()).then(setAiScores).catch(() => {});
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Dashboard</h1>
          <p className="text-xs text-g-muted mt-0.5">GLENVEX Creator Operating System</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-bold ${botHealth?.online ? 'text-g-green' : 'text-yellow-400'}`}>
            <span className={`w-2 h-2 rounded-full ${botHealth?.online ? 'bg-g-green animate-pulse' : 'bg-yellow-400'}`} />
            Bot {botHealth?.online ? `Online ${botHealth.latency ? `(${botHealth.latency}ms)` : ''}` : botHealth?.status ?? 'Sjekker...'}
          </div>
          <Link href="/ai-command-center" className="text-xs text-g-muted hover:text-g-green transition-colors">AI Center →</Link>
        </div>
      </div>

      {/* Featured Partner Banner */}
      {featured && (
        <a href={featured.affiliateLink} target="_blank" rel="noopener noreferrer"
          className="block bg-g-card border border-g-green/20 rounded-lg p-4 hover:border-g-green/40 transition-all group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-g-green/10 rounded border border-g-green/20 flex items-center justify-center">
                <span className="text-g-green font-black text-xs">★</span>
              </div>
              <div>
                <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">Featured Partner</p>
                <p className="text-sm font-black text-g-text">{featured.navn}</p>
                <p className="text-xs text-g-muted">{featured.beskrivelse}</p>
              </div>
            </div>
            {featured.rabattkode && (
              <div className="text-right">
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Kode</p>
                <p className="text-sm font-black text-g-green font-mono tracking-widest">{featured.rabattkode}</p>
              </div>
            )}
          </div>
        </a>
      )}

      {/* AI Scores */}
      {aiScores && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Community Score', value: aiScores.communityScore, color: '#00ff41' },
            { label: 'Growth Score', value: aiScores.growthScore, color: '#00aaff' },
            { label: 'Sponsor Score', value: aiScores.sponsorScore, color: '#ffd700' },
          ].map(s => (
            <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <div className="flex items-end gap-2 mt-1">
                <p className="text-2xl font-black font-mono" style={{ color: s.color }}>{s.value}</p>
                <p className="text-g-muted text-xs mb-0.5">/100</p>
              </div>
              <div className="w-full bg-g-border rounded-full h-1 mt-2">
                <div className="h-1 rounded-full transition-all" style={{ width: `${s.value}%`, backgroundColor: s.color }} />
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* Stats */}
      <StatsCards
        lastNotification={data?.lastNotification}
        totalAlerts={data?.totalAlerts ?? 0}
        memberCount={data?.guild?.approximate_member_count ?? data?.guild?.member_count}
        loading={loading}
      />

      {/* Quick links */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {[
          { label: 'AI Producer', href: '/ai-producer', icon: '◆' },
          { label: 'Clip Factory', href: '/clip-factory', icon: '▶' },
          { label: 'Partner Hub', href: '/partner-hub', icon: '◇' },
          { label: 'GlenCoins', href: '/glencoins', icon: '◎' },
          { label: 'Pre-Live', href: '/pre-live', icon: '((•))' },
          { label: 'Polls', href: '/polls', icon: '◈' },
          { label: 'RP Manager', href: '/rp-manager', icon: '◉' },
          { label: 'Events', href: '/event-generator', icon: '⊕' },
        ].map(l => (
          <Link key={l.href} href={l.href}
            className="bg-g-card border border-g-border rounded-lg p-3 text-center hover:border-g-green/30 hover:bg-g-green/5 transition-all group">
            <p className="text-g-green text-sm group-hover:scale-110 transition-transform inline-block">{l.icon}</p>
            <p className="text-[9px] text-g-muted group-hover:text-g-text transition-colors mt-1 leading-tight">{l.label}</p>
          </Link>
        ))}
      </div>

      {/* Row 3: Logs + Quick Actions + Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <LogsPreview logs={data?.recentLogs ?? []} loading={loading} maxRows={7} />
        </div>
        <QuickActions twitchUrl={data?.settings?.twitchUrl} onRefresh={refresh} />
        <ConfigPanel settings={data?.settings ?? null} onSave={() => refresh()} />
      </div>
    </div>
  );
}
