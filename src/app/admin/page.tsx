'use client';

import { useEffect, useState } from 'react';

interface Workspace {
  id: string;
  brandName: string;
  streamerName: string;
  twitchLogin: string | null;
  twitchDisplayName: string | null;
  twitchConnectedAt: string | null;
  discordGuildId: string | null;
  discordGuildName: string | null;
  discordConnectedAt: string | null;
  alphaEnabled: boolean;
  onboardingComplete: boolean;
  onboardingStep: number;
  plan: string;
  createdAt: string;
  lastEvent: { event_type: string; title: string; created_at: string } | null;
  lastError: { event_type: string; title: string; created_at: string } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '–';
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  const h    = Math.floor(diff / 3_600_000);
  const d    = Math.floor(diff / 86_400_000);
  if (d > 0)  return `${d}d siden`;
  if (h > 0)  return `${h}t siden`;
  if (min > 0) return `${min}m siden`;
  return 'Akkurat nå';
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
      ok ? 'bg-g-green/10 text-g-green border border-g-green/20' : 'bg-g-border/30 text-g-muted border border-g-border/50'
    }`}>
      <span className={`w-1 h-1 rounded-full ${ok ? 'bg-g-green' : 'bg-g-muted'}`} />
      {label}
    </span>
  );
}

export default function AdminPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [toggling, setToggling]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/admin/workspaces').catch(() => null);
    if (!res || !res.ok) {
      setError(res?.status === 403 ? 'Ikke tilgang — ADMIN_EMAIL stemmer ikke' : 'Feil ved lasting');
      setLoading(false);
      return;
    }
    const d = await res.json();
    setWorkspaces(d.workspaces ?? []);
    setLoading(false);
  }

  async function toggleAlpha(wsId: string, current: boolean) {
    setToggling(wsId);
    const res = await fetch('/api/admin/workspaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId, alpha_enabled: !current }),
    }).catch(() => null);
    if (res?.ok) {
      setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, alphaEnabled: !current } : w));
    }
    setToggling(null);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-g-bg p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black text-g-text uppercase tracking-wider">Admin Panel</h1>
            <p className="text-[10px] text-g-muted mt-0.5">Alpha-workspace administrasjon</p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-[10px] text-g-muted hover:text-g-green transition-colors">← Dashboard</a>
            <button onClick={load} disabled={loading}
              className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
              {loading ? '⟳' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Stats */}
        {!loading && !error && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Totalt', val: workspaces.length },
              { label: 'Alpha aktiv', val: workspaces.filter(w => w.alphaEnabled).length },
              { label: 'Twitch tilkoblet', val: workspaces.filter(w => w.twitchConnectedAt).length },
              { label: 'Discord tilkoblet', val: workspaces.filter(w => w.discordConnectedAt).length },
            ].map(s => (
              <div key={s.label} className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-2xl font-black text-g-text">{s.val}</p>
                <p className="text-[10px] text-g-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">{error}</div>
        )}

        {loading && (
          <div className="text-xs text-g-muted animate-pulse">Laster workspaces...</div>
        )}

        {/* Workspace table */}
        {!loading && !error && (
          <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-g-border">
              <p className="text-[10px] font-bold text-g-muted uppercase tracking-widest">
                Workspaces ({workspaces.length})
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-g-border/50">
                    {['Workspace', 'Twitch', 'Discord', 'Steg', 'Opprettet', 'Siste hendelse', 'Siste feil', 'Alpha'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[9px] font-bold text-g-muted uppercase tracking-widest">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workspaces.map(ws => (
                    <tr key={ws.id} className="border-b border-g-border/30 hover:bg-g-bg/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-xs font-bold text-g-text">{ws.brandName || ws.id}</p>
                        <p className="text-[9px] text-g-muted font-mono">{ws.id}</p>
                        <span className="text-[8px] text-g-muted/60 uppercase">{ws.plan}</span>
                      </td>
                      <td className="px-4 py-3">
                        {ws.twitchLogin ? (
                          <div>
                            <Badge ok label={ws.twitchLogin} />
                            <p className="text-[8px] text-g-muted mt-0.5">{timeAgo(ws.twitchConnectedAt)}</p>
                          </div>
                        ) : <Badge ok={false} label="Ikke tilkoblet" />}
                      </td>
                      <td className="px-4 py-3">
                        {ws.discordGuildName ? (
                          <div>
                            <Badge ok label={ws.discordGuildName} />
                            <p className="text-[8px] text-g-muted mt-0.5">{timeAgo(ws.discordConnectedAt)}</p>
                          </div>
                        ) : <Badge ok={false} label="Ikke tilkoblet" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {[1,2,3,4,5].map(s => (
                            <div key={s} className={`w-3 h-1 rounded-full ${
                              s <= (ws.onboardingStep ?? 0) ? 'bg-g-green' : 'bg-g-border'
                            }`} />
                          ))}
                        </div>
                        <p className="text-[8px] text-g-muted mt-0.5">
                          {ws.onboardingComplete ? '✓ Ferdig' : `Steg ${ws.onboardingStep ?? 0}/5`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-[9px] text-g-muted">
                        {timeAgo(ws.createdAt)}
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {ws.lastEvent ? (
                          <div>
                            <p className="text-[9px] text-g-text truncate">{ws.lastEvent.event_type}</p>
                            <p className="text-[8px] text-g-muted">{timeAgo(ws.lastEvent.created_at)}</p>
                          </div>
                        ) : <span className="text-[9px] text-g-muted">–</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {ws.lastError ? (
                          <div>
                            <p className="text-[9px] text-red-400 truncate">{ws.lastError.event_type}</p>
                            <p className="text-[8px] text-g-muted">{timeAgo(ws.lastError.created_at)}</p>
                          </div>
                        ) : <span className="text-[9px] text-g-green/60">–</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleAlpha(ws.id, ws.alphaEnabled)}
                          disabled={toggling === ws.id}
                          className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                            ws.alphaEnabled ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'
                          } disabled:opacity-50`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                            ws.alphaEnabled ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'
                          }`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
