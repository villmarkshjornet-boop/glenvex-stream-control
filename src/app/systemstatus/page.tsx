'use client';

import { useEffect, useState } from 'react';
import type { StatusResponse } from '@/types';

function StatusBadge({ status }: { status: 'online' | 'offline' | 'error' }) {
  const cfg = {
    online: { bg: 'bg-g-green/10 border-g-green/30', text: 'text-g-green', dot: 'bg-g-green', label: 'Online' },
    offline: { bg: 'bg-yellow-900/20 border-yellow-600/30', text: 'text-yellow-400', dot: 'bg-yellow-400', label: 'Offline' },
    error: { bg: 'bg-red-900/20 border-red-600/30', text: 'text-red-400', dot: 'bg-red-500', label: 'Feil' },
  }[status];

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded border ${cfg.bg}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} style={status === 'online' ? { boxShadow: '0 0 6px #00ff41' } : {}} />
      <span className={`text-xs font-bold ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

export default function Systemstatus() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/status');
      if (res.ok) setData(await res.json());
    } catch {
      /* silent */
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Systemstatus</h1>
          <p className="text-xs text-g-muted mt-0.5">Sanntidsstatus for alle systemkomponenter</p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 bg-g-card border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/20 transition-all"
        >
          ↻ Oppdater
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Core services */}
          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
              Kjerne-tjenester
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Twitch API', status: data?.twitchApi ?? 'offline', desc: 'Helix API for stream-deteksjon' },
                { label: 'Discord Bot', status: data?.discordBot ?? 'offline', desc: 'Bot for meldinger og kommandoer' },
                { label: 'Next.js App', status: 'online' as const, desc: 'Dashboard og API-ruter' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between p-3 bg-g-bg border border-g-border rounded">
                  <div>
                    <p className="text-sm text-g-text font-semibold">{item.label}</p>
                    <p className="text-[11px] text-g-muted mt-0.5">{item.desc}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Stream status */}
          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
              Stream Status
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Live Status', value: data?.stream?.isLive ? '🔴 LIVE' : '⚫ Offline' },
                { label: 'Spill', value: data?.stream?.game || '–' },
                { label: 'Seere', value: data?.stream?.viewerCount?.toLocaleString() ?? '–' },
                { label: 'Stream ID', value: data?.stream?.id || '–' },
              ].map(item => (
                <div key={item.label} className="p-3 bg-g-bg border border-g-border rounded">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest">{item.label}</p>
                  <p className="text-sm text-g-text font-mono mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Discord */}
          {data?.guild && (
            <div className="bg-g-card border border-g-border rounded-lg p-5">
              <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
                Discord Server
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Server', value: data.guild.name },
                  { label: 'Medlemmer', value: (data.guild.approximate_member_count ?? data.guild.member_count ?? 0).toLocaleString() },
                  { label: 'Online', value: data.guild.approximate_presence_count?.toLocaleString() ?? '–' },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-g-bg border border-g-border rounded">
                    <p className="text-[10px] text-g-muted uppercase tracking-widest">{item.label}</p>
                    <p className="text-sm text-g-text font-bold mt-1">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Env check */}
          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
              Konfigurasjonskontroll
            </h2>
            <p className="text-xs text-g-muted mb-3">
              Sjekk at alle nødvendige .env-variabler er satt.
            </p>
            <div className="space-y-1.5">
              {[
                { key: 'DISCORD_BOT_TOKEN', set: data?.discordBot === 'online' },
                { key: 'TWITCH_CLIENT_ID', set: data?.twitchApi === 'online' },
                { key: 'OPENAI_API_KEY', set: null },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between text-xs py-1.5 border-b border-g-border/30 last:border-0">
                  <span className="font-mono text-g-muted">{item.key}</span>
                  <span className={item.set === null ? 'text-g-muted' : item.set ? 'text-g-green' : 'text-red-400'}>
                    {item.set === null ? 'Ukjent' : item.set ? '✓ Satt' : '✗ Mangler'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
