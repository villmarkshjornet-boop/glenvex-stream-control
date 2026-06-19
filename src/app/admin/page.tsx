'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  event_type: string;
  title: string;
  severity?: string;
  metadata?: any;
  created_at: string;
  source?: string;
}

interface VodSummary {
  id: string;
  title: string;
  status: string;
  created_at: string;
  twitch_vod_id?: string;
}

interface IntegrationDim {
  connected: boolean; oauthDone: boolean; oauthValid?: boolean;
  botWatching?: boolean; botInGuild?: boolean;
  channelsConfigured?: boolean; canPost?: boolean;
  login?: string | null; guildName?: string | null;
  lastEventAt: string | null; reason: string;
}
interface IntegrationStatusShape {
  twitch: IntegrationDim & { botWatching: boolean; oauthValid: boolean };
  discord: IntegrationDim & { botInGuild: boolean; channelsConfigured: boolean; canPost: boolean };
  checks: { twitchConnected: boolean; discordConnected: boolean; liveChannelSet: boolean; onboardingComplete: boolean; alphaEnabled: boolean };
  readyForRuntime: boolean;
}

interface WorkspaceRow {
  id: string;
  brandName: string;
  streamerName: string | null;
  twitchLogin: string | null;
  twitchUserId: string | null;
  twitchDisplayName: string | null;
  twitchConnectedAt: string | null;
  discordGuildId: string | null;
  discordGuildName: string | null;
  discordConnectedAt: string | null;
  liveChannelId: string | null;
  kanalPrefs: Record<string, string>;
  alphaEnabled: boolean;
  onboardingComplete: boolean;
  onboardingCompletedAt: string | null;
  onboardingStep: number;
  plan: string;
  createdAt: string;
  ownerUserId: string;
  lastEvent: EventRow | null;
  lastError: EventRow | null;
  audienceHb: { created_at: string; metadata: any } | null;
  botHb: { created_at: string } | null;
  twitchBotLastEventAt: string | null;
  discordBotLastEventAt: string | null;
  integrationStatus: IntegrationStatusShape;
  lastStream: { created_at: string; metadata: any } | null;
  lastStreamEnd: { created_at: string } | null;
  coachReport: { created_at: string; metadata: any } | null;
  cfActive: number;
  cfFailed: number;
  cfQueued: number;
  cfLastVod: VodSummary | null;
  audienceSnapshot: { created_at: string; metadata: any } | null;
}

type TL = 'green' | 'yellow' | 'red' | 'grey';

// ─── Utilities ────────────────────────────────────────────────────────────────

function ageMs(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '–';
  const ms = ageMs(iso);
  const min = Math.floor(ms / 60_000);
  const h   = Math.floor(ms / 3_600_000);
  const d   = Math.floor(ms / 86_400_000);
  if (d > 0)   return `${d}d siden`;
  if (h > 0)   return `${h}t siden`;
  if (min > 0) return `${min}m siden`;
  return 'Nå';
}

function hbLight(iso: string | null | undefined, greenMs = 10 * 60_000, yellowMs = 60 * 60_000): TL {
  if (!iso) return 'grey';
  const age = ageMs(iso);
  if (age < greenMs)  return 'green';
  if (age < yellowMs) return 'yellow';
  return 'red';
}

function connLight(at: string | null | undefined): TL {
  return at ? 'green' : 'grey';
}

function isLiveNow(ws: WorkspaceRow): boolean {
  if (!ws.lastStream) return false;
  if (!ws.lastStreamEnd) return true;
  return new Date(ws.lastStream.created_at) > new Date(ws.lastStreamEnd.created_at);
}

const DOT_CLASS: Record<TL, string> = {
  green:  'bg-g-green shadow-[0_0_5px_#00ff41]',
  yellow: 'bg-yellow-400 shadow-[0_0_5px_#facc15]',
  red:    'bg-red-500 shadow-[0_0_5px_#ef4444]',
  grey:   'bg-g-muted/25',
};

function Dot({ c, title }: { c: TL; title: string }) {
  return <span title={title} className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${DOT_CLASS[c]}`} />;
}

function Badge({ ok, label, tiny }: { ok: boolean; label: string; tiny?: boolean }) {
  const size = tiny ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-0.5 text-[9px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded font-bold ${size} ${
      ok
        ? 'bg-g-green/10 text-g-green border border-g-green/20'
        : 'bg-g-muted/10 text-g-muted border border-g-border/50'
    }`}>
      <span className={`w-1 h-1 rounded-full ${ok ? 'bg-g-green' : 'bg-g-muted'}`} />
      {label}
    </span>
  );
}

function healthDots(ws: WorkspaceRow) {
  return {
    twitch:   ws.integrationStatus.twitch.connected   ? 'green' : ('grey' as TL),
    discord:  ws.integrationStatus.discord.connected  ? 'green' : ('grey' as TL),
    bot:      hbLight(ws.botHb?.created_at, 10 * 60_000, 60 * 60_000),
    audience: hbLight(ws.audienceHb?.created_at, 5 * 60_000, 30 * 60_000),
    cf:       (ws.cfActive > 0 ? 'green' : ws.cfLastVod ? 'grey' : 'grey') as TL,
    coach:    (ws.coachReport ? hbLight(ws.coachReport.created_at, 7 * 86_400_000, 30 * 86_400_000) : 'grey') as TL,
    errors:   (ws.lastError && ageMs(ws.lastError.created_at) < 24 * 3_600_000 ? 'red' : 'green') as TL,
  };
}

function sevColor(sev?: string): string {
  if (sev === 'error')   return 'text-red-400';
  if (sev === 'warning') return 'text-yellow-400';
  return 'text-g-muted';
}

// ─── Detail Sidebar ───────────────────────────────────────────────────────────

function DetailSidebar({
  ws,
  onClose,
  onAlphaToggle,
}: {
  ws: WorkspaceRow;
  onClose: () => void;
  onAlphaToggle: (wsId: string, current: boolean) => Promise<void>;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [evLoading, setEvLoading] = useState(true);
  const [repairResult, setRepairResult] = useState<any>(null);
  const [repairing, setRepairing] = useState(false);
  const [liveCheckResult, setLiveCheckResult] = useState<any>(null);
  const [liveChecking, setLiveChecking] = useState(false);
  const dots = healthDots(ws);
  const live = isLiveNow(ws);

  const handleLiveCheck = async () => {
    setLiveChecking(true);
    setLiveCheckResult(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${ws.id}/live-check`, { method: 'POST' });
      setLiveCheckResult(await res.json());
    } catch (err: any) {
      setLiveCheckResult({ ok: false, error: err?.message });
    } finally {
      setLiveChecking(false);
    }
  };

  const handleRepair = async (forceAlpha = false) => {
    setRepairing(true);
    setRepairResult(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${ws.id}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceAlpha }),
      });
      const data = await res.json();
      setRepairResult(data);
    } catch (err: any) {
      setRepairResult({ ok: false, error: err?.message });
    } finally {
      setRepairing(false);
    }
  };

  useEffect(() => {
    setEvLoading(true);
    fetch(`/api/admin/workspaces/${ws.id}/events`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => { setEvents(d.events ?? []); setEvLoading(false); })
      .catch(() => setEvLoading(false));
  }, [ws.id]);

  const Section = ({ title }: { title: string }) => (
    <div className="px-4 pt-4 pb-1">
      <p className="text-[9px] font-bold text-g-muted uppercase tracking-widest border-b border-g-border/40 pb-1">{title}</p>
    </div>
  );

  const Row = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
    <div className="px-4 py-1 flex items-start justify-between gap-2">
      <span className="text-[10px] text-g-muted flex-shrink-0 w-28">{label}</span>
      <span className={`text-[10px] font-semibold text-right leading-tight ${color ?? 'text-g-text'}`}>{value ?? '–'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-[440px] bg-g-card border-l border-g-border h-full overflow-y-auto flex-shrink-0 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-g-card border-b border-g-border px-4 py-3 flex items-center justify-between z-10">
          <div>
            <p className="text-sm font-black text-g-text">{ws.brandName || ws.id}</p>
            <p className="text-[9px] text-g-muted font-mono">{ws.id}</p>
          </div>
          <div className="flex items-center gap-2">
            {live && <Badge ok label="LIVE" />}
            <button onClick={onClose} className="w-6 h-6 rounded border border-g-border text-g-muted hover:text-g-text hover:border-g-green/30 text-[10px] flex items-center justify-center transition-colors">✕</button>
          </div>
        </div>

        {/* Health */}
        <div className="px-4 py-3 border-b border-g-border/50">
          <div className="grid grid-cols-7 gap-1">
            {([
              ['Twitch', dots.twitch], ['Discord', dots.discord], ['Bot', dots.bot],
              ['Audience', dots.audience], ['CF', dots.cf], ['Coach', dots.coach], ['Feil', dots.errors],
            ] as [string, TL][]).map(([label, c]) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <Dot c={c} title={label} />
                <span className="text-[7px] text-g-muted uppercase tracking-wider">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-3 border-b border-g-border/50 flex flex-wrap gap-2">
          <a href={`/?workspace=${ws.id}`} target="_blank"
            className="px-2 py-1 text-[9px] border border-g-border rounded text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
            Dashboard ↗
          </a>
          <a href={`/stream-coach?workspace=${ws.id}`} target="_blank"
            className="px-2 py-1 text-[9px] border border-g-border rounded text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
            Stream Coach ↗
          </a>
          <a href="/content-factory-admin" target="_blank"
            className="px-2 py-1 text-[9px] border border-g-border rounded text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
            CF Admin ↗
          </a>
          <button
            onClick={handleLiveCheck}
            disabled={liveChecking}
            className="px-2 py-1 text-[9px] border border-g-border rounded text-g-muted hover:text-purple-400 hover:border-purple-400/30 transition-colors disabled:opacity-50"
          >
            {liveChecking ? 'Sjekker…' : 'Test live check ↻'}
          </button>
        </div>
        {liveCheckResult && (
          <div className={`mx-4 mt-2 mb-1 p-2 rounded text-[9px] border ${liveCheckResult.isLive ? 'border-red-500/30 bg-red-500/5 text-red-400' : liveCheckResult.error ? 'border-red-500/30 bg-red-500/5 text-red-400' : 'border-g-border bg-g-bg/50 text-g-muted'}`}>
            {liveCheckResult.error
              ? `Feil: ${liveCheckResult.error}`
              : liveCheckResult.isLive
                ? `🔴 LIVE — ${liveCheckResult.stream?.title?.slice(0, 50)} · ${liveCheckResult.stream?.viewerCount} seere · ${liveCheckResult.stream?.game}`
                : `Offline — ${liveCheckResult.twitchLogin} · sjekket ${new Date(liveCheckResult.checkedAt).toLocaleTimeString('no-NO')}`
            }
          </div>
        )}

        {/* Onboarding Diagnostics */}
        <Section title="Onboarding Diagnostics" />
        {(() => {
          const is       = ws.integrationStatus;
          const hasTwitch    = is.twitch.connected;
          const hasDiscord   = is.discord.connected;
          const hasChannel   = is.checks.liveChannelSet;
          const hasOnboarding = is.checks.onboardingComplete;
          const hasAlpha     = is.checks.alphaEnabled;
          const runtimeReady = is.readyForRuntime;

          const twitchLabel = hasTwitch
            ? (is.twitch.botWatching ? `✓ Bot aktiv${is.twitch.login ? ' · ' + is.twitch.login : ''}` : `✓ OAuth · ${is.twitch.login ?? 'koblet'}`)
            : '✗ Mangler';
          const discordLabel = hasDiscord
            ? (is.discord.botInGuild ? `✓ Bot aktiv · ${is.discord.guildName ?? ws.discordGuildId}` : `✓ Guild koblet · ${is.discord.guildName ?? ws.discordGuildId}`)
            : '✗ Mangler';

          return (
            <>
              <Row label="Twitch koblet"  value={twitchLabel} color={hasTwitch ? 'text-g-green' : 'text-red-400'} />
              {!hasTwitch && <Row label="  Årsak" value={is.twitch.reason} color="text-red-400/70" />}
              <Row label="Discord koblet" value={discordLabel} color={hasDiscord ? 'text-g-green' : 'text-red-400'} />
              {!hasDiscord && <Row label="  Årsak" value={is.discord.reason} color="text-red-400/70" />}
              <Row label="Live-kanal"     value={hasChannel  ? '✓ ' + (ws.kanalPrefs?.live ?? ws.liveChannelId) : '✗ Mangler'}  color={hasChannel  ? 'text-g-green' : 'text-red-400'} />
              <Row label="Onboarding"     value={hasOnboarding ? '✓ Steg 5/5' : `✗ Steg ${ws.onboardingStep}/5`} color={hasOnboarding ? 'text-g-green' : 'text-yellow-400'} />
              <Row label="Alpha"          value={hasAlpha    ? '✓ Aktivert' : '✗ Ikke aktivert'} color={hasAlpha    ? 'text-g-green' : 'text-g-muted'} />
              <Row label="Runtime klar"   value={runtimeReady ? '✓ Klart' : '✗ Ikke klar'} color={runtimeReady ? 'text-g-green' : 'text-red-400'} />
              <div className="px-4 py-2 flex gap-2">
                <button
                  onClick={() => handleRepair(false)}
                  disabled={repairing}
                  className="flex-1 py-1.5 text-[9px] bg-g-green/10 border border-g-green/30 rounded text-g-green hover:bg-g-green/20 transition-colors disabled:opacity-50"
                >
                  {repairing ? 'Reparerer…' : 'Kjør Repair'}
                </button>
                {!hasAlpha && (
                  <button
                    onClick={() => handleRepair(true)}
                    disabled={repairing}
                    className="flex-1 py-1.5 text-[9px] bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                  >
                    Repair + Alpha
                  </button>
                )}
              </div>
              {repairResult && (
                <div className={`mx-4 mb-2 p-2 rounded text-[9px] border ${repairResult.ok ? 'border-g-green/30 bg-g-green/5 text-g-green' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
                  {repairResult.repairActions?.length > 0
                    ? repairResult.repairActions.join(' · ')
                    : repairResult.nextStep ?? repairResult.error ?? 'Ingen endringer'}
                </div>
              )}
            </>
          );
        })()}

        {/* Workspace Info */}
        <Section title="Workspace" />
        <Row label="Plan" value={ws.plan ?? '–'} />
        <Row label="Onboarding" value={ws.onboardingComplete ? `Ferdig ${timeAgo(ws.onboardingCompletedAt)}` : `Steg ${ws.onboardingStep}/5`} color={ws.onboardingComplete ? 'text-g-green' : 'text-yellow-400'} />
        <Row label="Opprettet" value={timeAgo(ws.createdAt)} />
        <Row label="Owner ID" value={<span className="font-mono text-[9px]">{ws.ownerUserId?.slice(0, 16) ?? '–'}…</span>} />
        <Row label="Alpha" value={
          <button
            onClick={() => onAlphaToggle(ws.id, ws.alphaEnabled)}
            className={`relative w-9 h-5 rounded-full transition-colors ${ws.alphaEnabled ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${ws.alphaEnabled ? 'left-4 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
          </button>
        } />

        {/* Twitch */}
        <Section title="Twitch" />
        <Row label="Login" value={ws.twitchLogin ?? '–'} color={ws.integrationStatus.twitch.connected ? 'text-g-green' : 'text-g-muted'} />
        <Row label="User ID" value={<span className="font-mono text-[9px]">{ws.twitchUserId ?? '–'}</span>} />
        <Row label="OAuth tilkoblet" value={timeAgo(ws.twitchConnectedAt)} />
        <Row label="Bot siste event" value={timeAgo(ws.twitchBotLastEventAt)} color={ws.integrationStatus.twitch.botWatching ? 'text-g-green' : 'text-g-muted'} />
        <Row label="OAuth-tokens" value={ws.integrationStatus.twitch.oauthValid ? '✓ Gyldige' : '✗ Mangler'} color={ws.integrationStatus.twitch.oauthValid ? 'text-g-green' : 'text-red-400'} />
        <Row label="Status" value={live ? '🔴 LIVE' : 'Offline'} color={live ? 'text-red-400' : 'text-g-muted'} />
        {ws.lastStream && (
          <Row label="Siste stream" value={`${ws.lastStream.metadata?.title?.slice(0, 40) ?? '–'} (${timeAgo(ws.lastStream.created_at)})`} />
        )}
        {ws.lastStream?.metadata?.game && (
          <Row label="Spill" value={ws.lastStream.metadata.game} />
        )}
        {ws.lastStream?.metadata?.viewerCount !== undefined && (
          <Row label="Peak viewers" value={ws.lastStream.metadata.viewerCount} />
        )}

        {/* Discord */}
        <Section title="Discord" />
        <Row label="Guild" value={ws.discordGuildName ?? '–'} color={ws.integrationStatus.discord.connected ? 'text-g-green' : 'text-g-muted'} />
        <Row label="Guild ID" value={<span className="font-mono text-[9px]">{ws.discordGuildId ?? '–'}</span>} />
        <Row label="OAuth tilkoblet" value={timeAgo(ws.discordConnectedAt)} />
        <Row label="Bot siste event" value={timeAgo(ws.discordBotLastEventAt)} color={ws.integrationStatus.discord.botInGuild ? 'text-g-green' : 'text-g-muted'} />
        <Row label="Kan poste" value={ws.integrationStatus.discord.canPost ? '✓ Ja' : '✗ Nei'} color={ws.integrationStatus.discord.canPost ? 'text-g-green' : 'text-red-400'} />
        <Row label="Live-kanal" value={ws.kanalPrefs?.live ? `#${ws.kanalPrefs.live}` : ws.liveChannelId ? `#${ws.liveChannelId}` : '–'} />
        {ws.kanalPrefs?.chat && <Row label="Chat-kanal" value={`#${ws.kanalPrefs.chat}`} />}
        {ws.kanalPrefs?.clips && <Row label="Klipp-kanal" value={`#${ws.kanalPrefs.clips}`} />}

        {/* Audience Tracking */}
        <Section title="Audience Tracking" />
        <Row label="Status" value={hbLight(ws.audienceHb?.created_at, 5 * 60_000) === 'green' ? 'Aktiv' : ws.audienceHb ? 'Inaktiv' : 'Ingen data'}
          color={hbLight(ws.audienceHb?.created_at, 5 * 60_000) === 'green' ? 'text-g-green' : 'text-g-muted'} />
        <Row label="Siste heartbeat" value={timeAgo(ws.audienceHb?.created_at)}
          color={hbLight(ws.audienceHb?.created_at) === 'red' ? 'text-red-400' : undefined} />
        {ws.audienceHb?.metadata && (
          <>
            <Row label="Observerte brukere" value={ws.audienceHb.metadata.totalObserved ?? '–'} />
            <Row label="Abonnenter" value={ws.audienceHb.metadata.subscribers ?? '–'} />
            <Row label="Aktive chattere" value={ws.audienceHb.metadata.activeChattters ?? '–'} />
            <Row label="Viewers sist sett" value={ws.audienceHb.metadata.lastViewerCount ?? '–'} />
          </>
        )}
        {!ws.audienceHb && ws.audienceSnapshot && (
          <Row label="Siste snapshot" value={`${ws.audienceSnapshot.metadata?.total ?? 0} brukere (${timeAgo(ws.audienceSnapshot.created_at)})`} />
        )}

        {/* Stream Coach */}
        <Section title="Stream Coach" />
        {ws.coachReport ? (
          <>
            <Row label="Siste analyse" value={timeAgo(ws.coachReport.created_at)} />
            <Row label="Score" value={ws.coachReport.metadata?.score !== undefined ? `${ws.coachReport.metadata.score} / 100` : '–'}
              color={ws.coachReport.metadata?.score >= 70 ? 'text-g-green' : ws.coachReport.metadata?.score >= 40 ? 'text-yellow-400' : 'text-red-400'} />
            {ws.coachReport.metadata?.grade && <Row label="Grade" value={ws.coachReport.metadata.grade} />}
          </>
        ) : (
          <div className="px-4 py-2 text-[10px] text-g-muted">Ingen analyse registrert</div>
        )}

        {/* Content Factory */}
        <Section title="Content Factory" />
        <Row label="Aktive jobber" value={ws.cfActive} color={ws.cfActive > 0 ? 'text-g-green' : 'text-g-muted'} />
        <Row label="Feilede jobber" value={ws.cfFailed} color={ws.cfFailed > 0 ? 'text-red-400' : 'text-g-muted'} />
        <Row label="Kø" value={ws.cfQueued} />
        {ws.cfLastVod && (
          <>
            <Row label="Siste VOD" value={ws.cfLastVod.title?.slice(0, 40) ?? ws.cfLastVod.id} />
            <Row label="VOD status" value={ws.cfLastVod.status}
              color={ws.cfLastVod.status === 'DONE' ? 'text-g-green' : ws.cfLastVod.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'} />
            <Row label="Sist oppdatert" value={timeAgo(ws.cfLastVod.created_at)} />
          </>
        )}
        <div className="px-4 py-2 flex gap-2">
          <a href="/content-factory-admin" target="_blank"
            className="px-2 py-1 text-[9px] border border-g-border rounded text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
            Åpne CF Admin ↗
          </a>
        </div>

        {/* Last Heartbeats */}
        <Section title="Siste Heartbeats" />
        <Row label="Bot runtime" value={timeAgo(ws.botHb?.created_at)}
          color={hbLight(ws.botHb?.created_at) === 'red' ? 'text-red-400' : hbLight(ws.botHb?.created_at) === 'yellow' ? 'text-yellow-400' : undefined} />
        <Row label="Audience" value={timeAgo(ws.audienceHb?.created_at)}
          color={hbLight(ws.audienceHb?.created_at, 5 * 60_000) === 'red' ? 'text-red-400' : undefined} />

        {/* Last Error */}
        {ws.lastError && (
          <>
            <Section title="Siste Feil" />
            <Row label="Type" value={ws.lastError.event_type} color="text-red-400" />
            <Row label="Tittel" value={ws.lastError.title?.slice(0, 60)} />
            <Row label="Tidspunkt" value={timeAgo(ws.lastError.created_at)} />
            {ws.lastError.metadata?.error && (
              <div className="px-4 pb-2">
                <p className="text-[9px] text-red-400/70 font-mono bg-red-500/5 border border-red-500/10 rounded p-2 break-all leading-relaxed">
                  {String(ws.lastError.metadata.error).slice(0, 200)}
                </p>
              </div>
            )}
          </>
        )}

        {/* System Events */}
        <Section title="Siste 50 hendelser" />
        <div className="px-4 pb-6">
          {evLoading && <p className="text-[10px] text-g-muted animate-pulse py-2">Laster hendelser…</p>}
          {!evLoading && events.length === 0 && <p className="text-[10px] text-g-muted py-2">Ingen hendelser funnet</p>}
          {!evLoading && events.map((ev, i) => (
            <div key={i} className="py-1.5 border-b border-g-border/20 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <span className={`text-[9px] font-mono font-bold ${sevColor(ev.severity)}`}>{ev.event_type}</span>
                <span className="text-[8px] text-g-muted flex-shrink-0">{timeAgo(ev.created_at)}</span>
              </div>
              {ev.title && <p className="text-[9px] text-g-muted/80 mt-0.5 leading-tight">{ev.title.slice(0, 80)}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [workspaces, setWorkspaces]   = useState<WorkspaceRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [toggling, setToggling]       = useState<string | null>(null);
  const [selected, setSelected]       = useState<WorkspaceRow | null>(null);
  const [search, setSearch]           = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [diagnoseEmail, setDiagnoseEmail] = useState('');
  const [diagnoseResult, setDiagnoseResult] = useState<any>(null);
  const [diagnosing, setDiagnosing]   = useState(false);
  const [filters, setFilters]         = useState({
    alphaOnly: false,
    liveOnly: false,
    errorsOnly: false,
    onboardingIncomplete: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/admin/workspaces').catch(() => null);
    if (!res || !res.ok) {
      setError(res?.status === 403 ? 'Ikke tilgang — ADMIN_EMAIL matcher ikke' : 'Feil ved lasting av data');
      setLoading(false);
      return;
    }
    const d = await res.json();
    setWorkspaces(d.workspaces ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleAlpha(wsId: string, current: boolean) {
    setToggling(wsId);
    const res = await fetch('/api/admin/workspaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId, alpha_enabled: !current }),
    }).catch(() => null);
    if (res?.ok) {
      setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, alphaEnabled: !current } : w));
      if (selected?.id === wsId) setSelected(prev => prev ? { ...prev, alphaEnabled: !current } : null);
    }
    setToggling(null);
  }

  const filtered = useMemo(() => {
    let ws = workspaces;
    if (search.trim()) {
      const q = search.toLowerCase();
      ws = ws.filter(w =>
        w.brandName?.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        w.twitchLogin?.toLowerCase().includes(q) ||
        w.discordGuildName?.toLowerCase().includes(q) ||
        w.streamerName?.toLowerCase().includes(q)
      );
    }
    if (filters.alphaOnly)            ws = ws.filter(w => w.alphaEnabled);
    if (filters.liveOnly)             ws = ws.filter(w => isLiveNow(w));
    if (filters.errorsOnly)           ws = ws.filter(w => w.lastError && ageMs(w.lastError.created_at) < 24 * 3_600_000);
    if (filters.onboardingIncomplete) ws = ws.filter(w => !w.onboardingComplete);
    return ws;
  }, [workspaces, search, filters]);

  // Summary stats
  const stats = useMemo(() => {
    const now = Date.now();
    return {
      total:        workspaces.length,
      alphaEnabled: workspaces.filter(w => w.alphaEnabled).length,
      online:       workspaces.filter(w => w.botHb && ageMs(w.botHb.created_at) < 10 * 60_000).length,
      liveNow:      workspaces.filter(w => isLiveNow(w)).length,
      audience:     workspaces.filter(w => w.audienceHb && ageMs(w.audienceHb.created_at) < 5 * 60_000).length,
      cfActive:     workspaces.reduce((a, w) => a + w.cfActive, 0),
      errWs:        workspaces.filter(w => w.lastError && ageMs(w.lastError.created_at) < 24 * 3_600_000).length,
      twitchConn:   workspaces.filter(w => w.twitchConnectedAt).length,
    };
  }, [workspaces]);

  const StatCard = ({ label, value, color }: { label: string; value: number; color?: string }) => (
    <div className="bg-g-card border border-g-border rounded-2xl p-3 flex flex-col gap-0.5">
      <p className={`text-2xl font-black ${color ?? 'text-g-text'}`}>{value}</p>
      <p className="text-[9px] text-g-muted uppercase tracking-wider">{label}</p>
    </div>
  );

  const toggleFilter = (key: keyof typeof filters) =>
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));

  async function diagnoseUser() {
    if (!diagnoseEmail.trim()) return;
    setDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const res = await fetch(`/api/admin/diagnose-user?email=${encodeURIComponent(diagnoseEmail.trim())}`);
      setDiagnoseResult(await res.json());
    } catch (err: any) {
      setDiagnoseResult({ error: err?.message });
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <div className="min-h-screen bg-g-bg text-g-text">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-g-sidebar/90 backdrop-blur-sm border-b border-g-border px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-black uppercase tracking-widest text-g-text">Admin Control Center</h1>
          <p className="text-[9px] text-g-muted mt-0.5">
            {lastRefresh ? `Oppdatert ${lastRefresh.toLocaleTimeString('no-NO')}` : 'Laster…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="text-[10px] text-g-muted hover:text-g-green transition-colors">← Dashboard</a>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all disabled:opacity-40"
          >
            {loading ? '⟳ Laster…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-[1800px] mx-auto">
        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-sm text-red-400">{error}</div>
        )}

        {/* System Summary */}
        {!loading && !error && (
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            <StatCard label="Totalt" value={stats.total} />
            <StatCard label="Alpha aktiv" value={stats.alphaEnabled} color="text-g-green" />
            <StatCard label="Bot online" value={stats.online} color={stats.online > 0 ? 'text-g-green' : 'text-g-muted'} />
            <StatCard label="Live nå" value={stats.liveNow} color={stats.liveNow > 0 ? 'text-red-400' : 'text-g-muted'} />
            <StatCard label="Audience aktiv" value={stats.audience} color={stats.audience > 0 ? 'text-g-green' : 'text-g-muted'} />
            <StatCard label="CF jobber" value={stats.cfActive} color={stats.cfActive > 0 ? 'text-yellow-400' : 'text-g-muted'} />
            <StatCard label="Feil 24t" value={stats.errWs} color={stats.errWs > 0 ? 'text-red-400' : 'text-g-green'} />
            <StatCard label="Twitch tilkoblet" value={stats.twitchConn} />
          </div>
        )}

        {/* Diagnose User */}
        <div className="bg-g-card border border-g-border rounded-2xl p-4 space-y-3">
          <p className="text-[9px] font-bold text-g-muted uppercase tracking-widest">Diagnose Bruker</p>
          <div className="flex gap-2">
            <input
              type="email"
              value={diagnoseEmail}
              onChange={e => setDiagnoseEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && diagnoseUser()}
              placeholder="E-post til brukeren (f.eks. jacob@...)"
              className="flex-1 bg-g-bg border border-g-border rounded-lg px-3 py-1.5 text-[11px] text-g-text placeholder:text-g-muted/50 focus:outline-none focus:border-g-green/30"
            />
            <button
              onClick={diagnoseUser}
              disabled={diagnosing || !diagnoseEmail.trim()}
              className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-colors disabled:opacity-40"
            >
              {diagnosing ? 'Sjekker…' : 'Diagnose →'}
            </button>
          </div>
          {diagnoseResult && (
            <div className="space-y-1.5">
              <div className={`p-2.5 rounded-lg border text-[10px] font-semibold ${
                diagnoseResult.error ? 'border-red-500/30 bg-red-500/5 text-red-400' :
                !diagnoseResult.authUser && diagnoseResult.diagnosis ? 'border-red-500/30 bg-red-500/5 text-red-400' :
                diagnoseResult.workspace ? 'border-g-border bg-g-bg text-g-text' : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
              }`}>
                {diagnoseResult.error ?? diagnoseResult.diagnosis ?? 'Ingen diagnose'}
              </div>
              {diagnoseResult.authUid && (
                <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                  <div className="bg-g-bg border border-g-border/50 rounded p-2">
                    <p className="text-g-muted mb-1 font-bold uppercase">Auth</p>
                    <p className="font-mono text-g-text">{diagnoseResult.authUid?.slice(0, 20)}…</p>
                    <p className="text-g-muted mt-0.5">meta.workspace_id: <span className={`font-mono ${diagnoseResult.authUserMeta?.workspace_id ? 'text-g-green' : 'text-red-400'}`}>{diagnoseResult.authUserMeta?.workspace_id ?? '(ingen)'}</span></p>
                    <p className="text-g-muted">meta.alpha_enabled: <span className={diagnoseResult.authUserMeta?.alpha_enabled ? 'text-g-green' : 'text-g-muted'}>{String(diagnoseResult.authUserMeta?.alpha_enabled ?? '(ikke satt)')}</span></p>
                  </div>
                  <div className="bg-g-bg border border-g-border/50 rounded p-2">
                    <p className="text-g-muted mb-1 font-bold uppercase">Workspace</p>
                    {diagnoseResult.workspace ? (
                      <>
                        <p className="font-mono text-g-text">{diagnoseResult.workspace.id}</p>
                        <p className="text-g-muted">owner_uid: <span className={`font-mono ${diagnoseResult.checks?.ownerIdMatches ? 'text-g-green' : 'text-red-400'}`}>{diagnoseResult.workspace.owner_user_id?.slice(0, 12)}…</span></p>
                        <p className="text-g-muted">Twitch: <span className={diagnoseResult.checks?.twitchConnected ? 'text-g-green' : 'text-red-400'}>{diagnoseResult.checks?.twitchConnected ? '✓' : '✗'}</span></p>
                        <p className="text-g-muted">Discord: <span className={diagnoseResult.checks?.discordConnected ? 'text-g-green' : 'text-red-400'}>{diagnoseResult.checks?.discordConnected ? '✓' : '✗'}</span></p>
                        <p className="text-g-muted">Alpha: <span className={diagnoseResult.checks?.alphaEnabled ? 'text-g-green' : 'text-red-400'}>{diagnoseResult.checks?.alphaEnabled ? '✓' : '✗'}</span></p>
                      </>
                    ) : (
                      <p className="text-red-400 font-bold">INGEN WORKSPACE FUNNET</p>
                    )}
                  </div>
                </div>
              )}
              {diagnoseResult.recentEvents?.length > 0 && (
                <div className="bg-g-bg border border-g-border/50 rounded p-2 space-y-0.5">
                  <p className="text-[8px] font-bold text-g-muted uppercase mb-1">Siste hendelser</p>
                  {(diagnoseResult.recentEvents as any[]).slice(0, 5).map((e: any, i: number) => (
                    <p key={i} className="text-[9px] text-g-muted"><span className="text-g-text">{e.type}</span> — {e.title?.slice(0, 60)}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search + Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Søk workspace, Twitch login, Discord guild…"
            className="flex-1 min-w-[220px] bg-g-card border border-g-border rounded-lg px-3 py-1.5 text-[11px] text-g-text placeholder:text-g-muted/50 focus:outline-none focus:border-g-green/30"
          />
          {([ ['alphaOnly', 'Alpha enabled'], ['liveOnly', 'Live nå'], ['errorsOnly', 'Feil 24t'], ['onboardingIncomplete', 'Onboarding ufullstendig'] ] as [keyof typeof filters, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                filters[key]
                  ? 'bg-g-green/10 border-g-green/30 text-g-green'
                  : 'border-g-border text-g-muted hover:border-g-green/20 hover:text-g-text'
              }`}
            >
              {label}
            </button>
          ))}
          {(search || Object.values(filters).some(Boolean)) && (
            <button
              onClick={() => { setSearch(''); setFilters({ alphaOnly: false, liveOnly: false, errorsOnly: false, onboardingIncomplete: false }); }}
              className="px-2 py-1.5 text-[10px] text-g-muted hover:text-red-400 transition-colors"
            >
              ✕ Nullstill
            </button>
          )}
          <span className="text-[10px] text-g-muted ml-auto">{filtered.length} workspace{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        {loading && <div className="text-xs text-g-muted animate-pulse py-8 text-center">Laster alle workspaces…</div>}

        {!loading && !error && (
          <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px]">
                <thead>
                  <tr className="border-b border-g-border/60">
                    {[
                      'Workspace', 'Helse', 'Twitch', 'Discord',
                      'Onboarding', 'Audience', 'Stream Coach', 'Content Factory',
                      'Siste Stream', 'Heartbeat', 'Siste Feil', 'Alpha',
                    ].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[8px] font-bold text-g-muted uppercase tracking-widest whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-[11px] text-g-muted">
                        Ingen workspaces matcher filteret
                      </td>
                    </tr>
                  )}
                  {filtered.map(ws => {
                    const dots = healthDots(ws);
                    const live = isLiveNow(ws);
                    const botAge = hbLight(ws.botHb?.created_at);
                    const audAge = hbLight(ws.audienceHb?.created_at, 5 * 60_000);
                    const errRecent = ws.lastError && ageMs(ws.lastError.created_at) < 24 * 3_600_000;
                    const audienceUsers = ws.audienceHb?.metadata?.totalObserved ?? ws.audienceSnapshot?.metadata?.total ?? null;

                    return (
                      <tr
                        key={ws.id}
                        onClick={() => setSelected(ws)}
                        className={`border-b border-g-border/25 hover:bg-white/[0.02] cursor-pointer transition-colors ${selected?.id === ws.id ? 'bg-g-green/5 border-g-green/20' : ''}`}
                      >
                        {/* Workspace */}
                        <td className="px-3 py-2.5">
                          <p className="text-[11px] font-bold text-g-text leading-tight">{ws.brandName || ws.id}</p>
                          <p className="text-[8px] text-g-muted font-mono">{ws.id.slice(0, 18)}…</p>
                          <span className="text-[7px] text-g-muted/60 uppercase">{ws.plan}</span>
                        </td>

                        {/* Health dots */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <Dot c={dots.twitch}   title="Twitch" />
                            <Dot c={dots.discord}  title="Discord" />
                            <Dot c={dots.bot}      title="Bot runtime" />
                            <Dot c={dots.audience} title="Audience Tracking" />
                            <Dot c={dots.cf}       title="Content Factory" />
                            <Dot c={dots.coach}    title="Stream Coach" />
                            <Dot c={dots.errors}   title="Feil siste 24t" />
                          </div>
                        </td>

                        {/* Twitch */}
                        <td className="px-3 py-2.5">
                          {ws.integrationStatus.twitch.connected ? (
                            <div className="space-y-0.5">
                              <p className="text-[10px] text-g-text font-semibold">
                                {ws.twitchLogin ?? (ws.integrationStatus.twitch.botWatching ? 'Bot aktiv' : 'Koblet')}
                              </p>
                              {live
                                ? <Badge ok label="LIVE" tiny />
                                : <span className="text-[8px] text-g-muted">Offline</span>
                              }
                            </div>
                          ) : <Badge ok={false} label="Ikke koblet" tiny />}
                        </td>

                        {/* Discord */}
                        <td className="px-3 py-2.5">
                          {ws.integrationStatus.discord.connected ? (
                            <p className="text-[10px] text-g-text">
                              {ws.discordGuildName ?? (ws.integrationStatus.discord.botInGuild ? 'Bot aktiv' : 'Koblet')}
                            </p>
                          ) : <Badge ok={false} label="Ikke koblet" tiny />}
                        </td>

                        {/* Onboarding */}
                        <td className="px-3 py-2.5">
                          <div className="flex gap-0.5 items-center mb-0.5">
                            {[1,2,3,4,5].map(s => (
                              <div key={s} className={`w-3 h-1 rounded-full ${s <= ws.onboardingStep ? 'bg-g-green' : 'bg-g-border'}`} />
                            ))}
                          </div>
                          <p className="text-[8px] text-g-muted">
                            {ws.onboardingComplete ? '✓ Ferdig' : `${ws.onboardingStep}/5`}
                          </p>
                        </td>

                        {/* Audience Tracking */}
                        <td className="px-3 py-2.5">
                          {ws.audienceHb ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <Dot c={audAge} title="Audience HB" />
                                <span className="text-[10px] text-g-text">
                                  {audienceUsers !== null ? `${audienceUsers} brukere` : 'Aktiv'}
                                </span>
                              </div>
                              <p className="text-[8px] text-g-muted">{timeAgo(ws.audienceHb.created_at)}</p>
                            </div>
                          ) : audienceUsers !== null ? (
                            <div>
                              <p className="text-[10px] text-g-muted">{audienceUsers} obs.</p>
                              <p className="text-[8px] text-g-muted">{timeAgo(ws.audienceSnapshot?.created_at)}</p>
                            </div>
                          ) : <span className="text-[9px] text-g-muted/50">–</span>}
                        </td>

                        {/* Stream Coach */}
                        <td className="px-3 py-2.5">
                          {ws.coachReport ? (
                            <div>
                              {ws.coachReport.metadata?.score !== undefined && (
                                <p className={`text-[11px] font-bold ${ws.coachReport.metadata.score >= 70 ? 'text-g-green' : ws.coachReport.metadata.score >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {ws.coachReport.metadata.score}
                                  <span className="text-[8px] text-g-muted font-normal"> /100</span>
                                </p>
                              )}
                              <p className="text-[8px] text-g-muted">{timeAgo(ws.coachReport.created_at)}</p>
                            </div>
                          ) : <span className="text-[9px] text-g-muted/50">–</span>}
                        </td>

                        {/* Content Factory */}
                        <td className="px-3 py-2.5">
                          <div className="space-y-0.5">
                            {ws.cfActive > 0 && <p className="text-[9px] text-g-green">{ws.cfActive} aktiv{ws.cfActive > 1 ? 'e' : ''}</p>}
                            {ws.cfFailed > 0 && <p className="text-[9px] text-red-400">{ws.cfFailed} feilet</p>}
                            {ws.cfQueued > 0 && <p className="text-[9px] text-yellow-400">{ws.cfQueued} i kø</p>}
                            {ws.cfActive === 0 && ws.cfFailed === 0 && ws.cfQueued === 0 && (
                              <span className="text-[9px] text-g-muted/50">{ws.cfLastVod ? 'Ferdig' : '–'}</span>
                            )}
                          </div>
                        </td>

                        {/* Last Stream */}
                        <td className="px-3 py-2.5 max-w-[160px]">
                          {ws.lastStream ? (
                            <div>
                              <p className="text-[9px] text-g-text truncate">{ws.lastStream.metadata?.title?.slice(0, 35) ?? '–'}</p>
                              <p className="text-[8px] text-g-muted">{ws.lastStream.metadata?.game ?? '–'}</p>
                              <p className="text-[8px] text-g-muted/60">{timeAgo(ws.lastStream.created_at)}</p>
                            </div>
                          ) : <span className="text-[9px] text-g-muted/50">–</span>}
                        </td>

                        {/* Heartbeat */}
                        <td className="px-3 py-2.5">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Dot c={botAge} title="Bot HB" />
                              <span className={`text-[8px] ${botAge === 'red' ? 'text-red-400' : botAge === 'yellow' ? 'text-yellow-400' : 'text-g-muted'}`}>
                                Bot {timeAgo(ws.botHb?.created_at)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Dot c={audAge} title="Audience HB" />
                              <span className={`text-[8px] ${audAge === 'red' ? 'text-red-400' : audAge === 'yellow' ? 'text-yellow-400' : 'text-g-muted'}`}>
                                Aud {timeAgo(ws.audienceHb?.created_at)}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Last Error */}
                        <td className="px-3 py-2.5 max-w-[160px]">
                          {ws.lastError ? (
                            <div>
                              <p className={`text-[9px] font-mono truncate ${errRecent ? 'text-red-400' : 'text-g-muted/60'}`}>
                                {ws.lastError.event_type}
                              </p>
                              <p className="text-[8px] text-g-muted">{timeAgo(ws.lastError.created_at)}</p>
                            </div>
                          ) : <span className="text-[9px] text-g-green/60">–</span>}
                        </td>

                        {/* Alpha toggle */}
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => toggleAlpha(ws.id, ws.alphaEnabled)}
                            disabled={toggling === ws.id}
                            className={`relative w-10 h-5 rounded-full transition-all duration-200 disabled:opacity-40 ${
                              ws.alphaEnabled ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'
                            }`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                              ws.alphaEnabled ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'
                            }`} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Detail Sidebar */}
      {selected && (
        <DetailSidebar
          ws={selected}
          onClose={() => setSelected(null)}
          onAlphaToggle={toggleAlpha}
        />
      )}
    </div>
  );
}
