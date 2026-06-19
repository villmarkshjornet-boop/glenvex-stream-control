'use client';

import { useEffect, useState } from 'react';
import { tidSiden } from './helpers';

interface IntegrationStatusData {
  twitch: {
    connected: boolean;
    oauthValid: boolean;
    botWatching: boolean;
    login: string | null;
    lastEventAt: string | null;
    reason: string;
  };
  discord: {
    connected: boolean;
    botInGuild: boolean;
    channelsConfigured: boolean;
    canPost: boolean;
    guildName: string | null;
    lastEventAt: string | null;
    reason: string;
  };
}

function DimRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${ok ? 'bg-g-green' : 'bg-red-500'}`} />
      <div className="min-w-0">
        <span className="text-xs text-g-text">{label}</span>
        {detail && <p className="text-[10px] text-g-muted leading-tight">{detail}</p>}
      </div>
    </div>
  );
}

function IntegrationCard({ name, data }: {
  name: string;
  data: {
    connected: boolean;
    botActive: boolean;
    channelsOk: boolean;
    canPost: boolean;
    login: string | null;
    lastEventAt: string | null;
    reason: string;
  };
}) {
  const allGood = data.connected && data.botActive && data.channelsOk;
  return (
    <div className="rounded-xl border border-g-border/30 bg-g-bg/20 p-3 space-y-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">{name}</p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${allGood ? 'bg-g-green/10 text-g-green' : 'bg-red-500/10 text-red-400'}`}>
          {allGood ? 'OK' : 'Problem'}
        </span>
      </div>

      <DimRow
        label={data.login ? `OAuth: ${data.login}` : 'OAuth / tilkobling'}
        ok={data.connected}
        detail={data.connected ? undefined : data.reason}
      />
      <DimRow
        label="Bot runtime"
        ok={data.botActive}
        detail={data.lastEventAt ? `Siste: ${tidSiden(data.lastEventAt)}` : 'Ingen heartbeat siste 12t'}
      />
      <DimRow
        label="Kanaler konfigurert"
        ok={data.channelsOk}
      />
      <DimRow
        label="Kan poste"
        ok={data.canPost}
      />

      {!allGood && (
        <p className="text-[10px] text-red-400 mt-2 pt-2 border-t border-g-border/20 leading-snug">
          {data.reason}
        </p>
      )}
    </div>
  );
}

export function IntegrationStatus() {
  const [data, setData] = useState<IntegrationStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/integrations/status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Feil ved henting av integrasjonsstatus');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-g-border/30 bg-g-bg/20 p-3 animate-pulse">
        <div className="h-3 bg-g-border/30 rounded w-32 mb-2" />
        <div className="h-2 bg-g-border/20 rounded w-full mb-1" />
        <div className="h-2 bg-g-border/20 rounded w-3/4" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-g-border/30 bg-g-bg/20 p-3">
        <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-2">Integrasjonstatus</p>
        <p className="text-xs text-red-400">{error ?? 'Ingen data'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">Integrasjonstatus</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IntegrationCard
          name="Twitch"
          data={{
            connected:    data.twitch.connected,
            botActive:    data.twitch.botWatching,
            channelsOk:   data.twitch.oauthValid || data.twitch.botWatching,
            canPost:      data.twitch.botWatching,
            login:        data.twitch.login,
            lastEventAt:  data.twitch.lastEventAt,
            reason:       data.twitch.reason,
          }}
        />
        <IntegrationCard
          name="Discord"
          data={{
            connected:    data.discord.connected,
            botActive:    data.discord.botInGuild,
            channelsOk:   data.discord.channelsConfigured,
            canPost:      data.discord.canPost,
            login:        data.discord.guildName,
            lastEventAt:  data.discord.lastEventAt,
            reason:       data.discord.reason,
          }}
        />
      </div>
    </div>
  );
}
