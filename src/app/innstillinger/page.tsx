'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Settings } from '@/types';
import { LOCALE_LABEL, LOCALES } from '@/lib/i18n';

// ─── Shared Types ─────────────────────────────────────────────────────────────

interface HealthItem { ok: boolean; melding: string; }

interface WorkspaceMe {
  brandName?: string;
  twitchLogin?: string;
  twitchDisplayName?: string;
  twitchProfileImage?: string;
  twitchConnected?: boolean;
  discordConnected?: boolean;
  discordGuildName?: string;
}

interface BotSettingsData {
  aktiv?: boolean;
  tone?: string;
  pauseTwitch?: boolean;
  pausePartnerPromo?: boolean;
  pauseLiveVarsler?: boolean;
  pauseProaktiv?: boolean;
  pauseDiscord?: boolean;
  svarSjanse?: number;
  cooldownSek?: number;
  economyEnabled?: boolean;
  xpPerMessage?: number;
  coinsEnabled?: boolean;
  dailyBonusCoins?: number;
  streakBonusEnabled?: boolean;
  aiAutoPosting?: boolean;
  aiHypeEnabled?: boolean;
  aiSuggestions?: boolean;
  aiSafetyCooldown?: number;
}

// ─── Passord ──────────────────────────────────────────────────────────────────

function PassordPanel() {
  const [passord, setPassord] = useState('');
  const [bekreft, setBekreft] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [feil, setFeil] = useState('');

  async function settPassord(e: React.FormEvent) {
    e.preventDefault();
    if (passord !== bekreft) { setFeil('Passordene er ikke like'); return; }
    setStatus('loading'); setFeil('');
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passord }),
    });
    const data = await res.json();
    if (!res.ok) { setFeil(data.error ?? 'Noe gikk galt'); setStatus('error'); return; }
    setStatus('ok'); setPassord(''); setBekreft('');
  }

  return (
    <div id="passord" className="bg-g-card border border-g-border rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-g-text pb-4 mb-5 border-b border-g-border/40">Sett passord</h2>
      <p className="text-sm text-g-muted mb-5">Sett et passord så du kan logge inn direkte neste gang.</p>
      <form onSubmit={settPassord} className="space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <label className="text-xs font-medium tracking-wide uppercase text-g-muted block">Nytt passord</label>
          <input
            type="password"
            value={passord}
            onChange={e => setPassord(e.target.value)}
            minLength={6}
            required
            placeholder="Minst 6 tegn"
            className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium tracking-wide uppercase text-g-muted block">Bekreft passord</label>
          <input
            type="password"
            value={bekreft}
            onChange={e => setBekreft(e.target.value)}
            minLength={6}
            required
            placeholder="Gjenta passord"
            className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
          />
        </div>
        {feil && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{feil}</p>
        )}
        {status === 'ok' && (
          <p className="text-sm text-g-green bg-g-green/10 border border-g-green/20 rounded-lg px-3 py-2">
            ✓ Passord satt! Du kan nå logge inn med e-post og passord.
          </p>
        )}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-5 py-2.5 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 hover:shadow-green-sm transition-all duration-200 disabled:opacity-40"
        >
          {status === 'loading' ? 'Lagrer...' : 'Sett passord'}
        </button>
      </form>
    </div>
  );
}

// ─── Twitch Bot Admin Panel ───────────────────────────────────────────────────

const TONER_TWITCH = [
  { verdi: 'dark_gaming',  label: 'Dark Gaming',  desc: 'Rå, direkte, hacker-vibe' },
  { verdi: 'hype',         label: 'Hype',         desc: 'Energisk, caps, emojis' },
  { verdi: 'humoristisk',  label: 'Humoristisk',  desc: 'Lett og selvironisk' },
  { verdi: 'rp_stil',      label: 'RP-stil',      desc: 'I karakter, fortellende' },
  { verdi: 'cinematic',    label: 'Cinematisk',   desc: 'Dramatisk, slagkraftig' },
  { verdi: 'profesjonell', label: 'Profesjonell', desc: 'Kort, ryddig, ingen slang' },
];

type BotEvent = { id: string; source: string; event_type: string; title: string; created_at: string; metadata?: Record<string, unknown> };

function TwitchBotAdminPanel() {
  const [settings, setSettings] = useState<BotSettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [clearResult, setClearResult] = useState<{ ok: boolean; tekst: string } | null>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setSettings(d.settings ?? d)).catch(() => {});
    fetch('/api/bot-health').then(r => r.json()).then(d => setBotOnline(d.online)).catch(() => setBotOnline(false));
    hentEvents();
  }, []);

  async function hentEvents() {
    setLoadingEvents(true);
    try {
      const r = await fetch('/api/system-events?minutesBack=1440&limit=30');
      const d = await r.json();
      setEvents((d.events ?? []).filter((e: BotEvent) =>
        e.source === 'twitch_bot' || (e.source === 'discord_bot' && e.event_type === 'BOT_DISCORD_MESSAGE')
      ));
    } catch {}
    setLoadingEvents(false);
  }

  async function lagreFelt(felt: string, verdi: boolean | number | string) {
    setSaving(true); setSaved(false);
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    });
    setSettings(prev => prev ? { ...prev, [felt]: verdi } as BotSettingsData : prev);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function Toggle({ felt, label, desc, invertert = false }: { felt: keyof BotSettingsData; label: string; desc?: string; invertert?: boolean }) {
    const raw = settings?.[felt];
    const aktiv = invertert ? !raw : !!raw;
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/30 last:border-0">
        <div>
          <p className="text-sm text-g-text">{label}</p>
          {desc && <p className="text-xs text-g-muted mt-0.5">{desc}</p>}
        </div>
        <button
          onClick={() => lagreFelt(felt, invertert ? !!raw : !raw)}
          className={`relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
        </button>
      </div>
    );
  }

  const eventTypeLabel: Record<string, string> = {
    BOT_CHAT_MESSAGE: '💬 Twitch Chat',
    BOT_DISCORD_MESSAGE: '🔵 Discord',
    TWITCH_EVENT_RECEIVED: '⚡ Hendelse',
    TWITCH_SUB_RECEIVED: '⭐ Sub',
    TWITCH_GIFT_SUB_RECEIVED: '🎁 Gift Sub',
    LIVE_DETECTED: '🔴 Live',
    DISCORD_LIVE_ANNOUNCEMENT_SENT: '📢 Live-varsel',
    PREHYPE_SENT: '🔥 Pre-hype',
  };

  return (
    <div id="twitch-bot" className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-g-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-g-text">Twitch Bot Admin</h2>
          <p className="text-xs text-g-muted mt-0.5">Chat-atferd, toggle-er og live aktivitet</p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-g-muted">Lagrer...</span>}
          {saved && <span className="text-xs text-g-green">✓ Lagret</span>}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
            botOnline === true  ? 'text-g-green border-g-green/20 bg-g-green/5' :
            botOnline === false ? 'text-red-400 border-red-500/20 bg-red-500/5' :
            'text-g-muted border-g-border'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${botOnline === true ? 'bg-g-green animate-pulse' : botOnline === false ? 'bg-red-400' : 'bg-g-muted'}`} />
            {botOnline === true ? 'Railway Online' : botOnline === false ? 'Railway Offline' : 'Sjekker...'}
          </div>
        </div>
      </div>

      {!settings ? (
        <div className="p-6"><p className="text-sm text-g-muted">Laster...</p></div>
      ) : (
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Master-kontroll</p>
            <div className="flex items-center justify-between p-4 rounded-lg border border-g-border bg-g-bg">
              <div>
                <p className="text-sm font-medium text-g-text">Bot aktiv</p>
                <p className="text-xs text-g-muted mt-0.5">Skrur av/på all bot-aktivitet (Twitch + Discord)</p>
              </div>
              <button
                onClick={() => lagreFelt('aktiv', !settings.aktiv)}
                className={`relative w-12 h-6 rounded-full transition-all duration-200 ${settings.aktiv ? 'bg-g-green/70' : 'bg-g-bg border-2 border-g-border'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200 ${settings.aktiv ? 'left-6 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Twitch Chat</p>
            <div className="bg-g-bg border border-g-border rounded-lg px-4 divide-y divide-g-border/30">
              <Toggle felt="pauseTwitch" label="Twitch chat-svar" desc="Boten svarer i Twitch-chat" invertert />
              <Toggle felt="pausePartnerPromo" label="Partner-promo i chat" desc="AI-generert partner-reklame hvert 60 min" invertert />
              <Toggle felt="pauseLiveVarsler" label="Live-varsler til Discord" desc="Poster embed når stream starter" invertert />
              <Toggle felt="pauseProaktiv" label="Proaktive Discord-meldinger" desc="Promo, streamplan, community-oppdateringer" invertert />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Chat-atferd</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-g-bg border border-g-border rounded-lg p-4">
                <label className="text-xs font-medium text-g-muted block mb-2">
                  Svar-sjanse: <span className="text-g-green">{Math.round((settings.svarSjanse ?? 0.35) * 100)}%</span>
                </label>
                <input
                  type="range" min="0" max="100" step="5"
                  value={Math.round((settings.svarSjanse ?? 0.35) * 100)}
                  onChange={e => lagreFelt('svarSjanse', parseInt(e.target.value) / 100)}
                  className="w-full accent-green-500"
                />
                <p className="text-xs text-g-muted mt-2">Sjanse for at boten svarer på tilfeldige meldinger</p>
              </div>
              <div className="bg-g-bg border border-g-border rounded-lg p-4">
                <label className="text-xs font-medium text-g-muted block mb-2">
                  Cooldown: <span className="text-g-green">{settings.cooldownSek ?? 15}s</span>
                </label>
                <input
                  type="number" min="5" max="300" step="5"
                  value={settings.cooldownSek ?? 15}
                  onChange={e => lagreFelt('cooldownSek', parseInt(e.target.value) || 15)}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2 text-sm text-g-text focus:outline-none focus:border-g-green/40 transition-all"
                />
                <p className="text-xs text-g-muted mt-2">Sekunder mellom svar til samme bruker</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Bot-tone i Twitch-chat</p>
            <div className="grid grid-cols-3 gap-2">
              {TONER_TWITCH.map(t => (
                <button
                  key={t.verdi}
                  onClick={() => lagreFelt('tone', t.verdi)}
                  className={`p-3 rounded-lg border text-left transition-all ${settings.tone === t.verdi ? 'border-g-green/40 bg-g-green/10' : 'border-g-border bg-g-bg hover:border-g-green/20'}`}
                >
                  <p className={`text-xs font-semibold ${settings.tone === t.verdi ? 'text-g-green' : 'text-g-text'}`}>{t.label}</p>
                  <p className="text-xs text-g-muted mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Tilgjengelige chat-kommandoer</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { cmd: '!discordsiste', desc: 'Oppsummerer siste Discord-aktivitet', plattform: 'Twitch' },
                { cmd: '!discordtema', desc: 'Viser hva som diskuteres i Discord', plattform: 'Twitch' },
                { cmd: '!twitchsiste', desc: 'Oppsummerer siste Twitch-aktivitet', plattform: 'Discord' },
                { cmd: '!twitchtema', desc: 'Viser aktuelle Twitch-temaer', plattform: 'Discord' },
                { cmd: '!communitymemory', desc: 'AI-oppsummering av community-hukommelse', plattform: 'Discord' },
              ].map(c => (
                <div key={c.cmd} className="bg-g-bg border border-g-border rounded-lg p-3">
                  <p className="text-xs font-mono font-semibold text-g-green">{c.cmd}</p>
                  <p className="text-xs text-g-muted mt-1">{c.desc}</p>
                  <span className="text-xs text-g-muted/50 uppercase tracking-wide">{c.plattform}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-g-border bg-g-bg">
            <div>
              <p className="text-sm text-g-text">Tøm Discord bot-logs</p>
              <p className="text-xs text-g-muted mt-0.5">Sletter alle meldinger i admin-kanalen. Kun siste oppstartsmelding beholdes.</p>
              {clearResult && (
                <p className={`text-xs mt-1.5 ${clearResult.ok ? 'text-g-green' : 'text-red-400'}`}>{clearResult.tekst}</p>
              )}
            </div>
            <button
              onClick={async () => {
                setClearingLogs(true); setClearResult(null);
                const res = await fetch('/api/bot/clear-logs', { method: 'POST' }).then(r => r.json()).catch(() => ({ ok: false, error: 'Nettverksfeil' }));
                setClearResult(res.ok
                  ? { ok: true,  tekst: `✓ ${res.slettet} meldinger slettet` }
                  : { ok: false, tekst: `✗ ${res.error}` });
                setClearingLogs(false);
              }}
              disabled={clearingLogs}
              className="px-3 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-50 flex-shrink-0"
            >
              {clearingLogs ? '⟳ Sletter...' : '🗑 Tøm nå'}
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-g-muted tracking-wide uppercase">Bot-aktivitet (siste 24t)</p>
              <button
                onClick={hentEvents}
                disabled={loadingEvents}
                className="text-xs text-g-muted hover:text-g-green transition-colors"
              >
                {loadingEvents ? '⟳ Laster...' : '↻ Oppdater'}
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-g-muted">Ingen registrert aktivitet de siste 24 timene.</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {events.map(e => (
                  <div key={e.id} className="flex items-start gap-2 py-2 border-b border-g-border/20 last:border-0">
                    <span className="text-xs text-g-muted flex-shrink-0 w-16 mt-0.5">
                      {new Date(e.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xs text-g-muted flex-shrink-0 w-28">
                      {eventTypeLabel[e.event_type] ?? e.event_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-g-text flex-1 leading-tight">{e.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Twitch Broadcaster Token ─────────────────────────────────────────────────

function TwitchBroadcasterPanel() {
  const [status, setStatus] = useState<{
    connected?: boolean;
    reason?: string;
    hasFollowerScope?: boolean;
    hasSubScope?: boolean;
    workspaceId?: string;
    twitchLogin?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/twitch/status').then(r => r.json()).then(d => { setStatus(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const ok      = status?.connected === true;
  const expired = status?.reason === 'token_expired';
  const hasF    = status?.hasFollowerScope;
  const hasSub  = status?.hasSubScope;
  const wsId    = status?.workspaceId;

  const connectUrl = `/api/auth/twitch?returnUrl=${encodeURIComponent('/innstillinger?tab=integrasjoner')}`;

  return (
    <div className={`bg-g-card border rounded-2xl overflow-hidden ${ok ? 'border-g-green/15' : 'border-red-500/20'}`}>
      <div className="px-6 py-4 border-b border-g-border/40 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-g-text">Twitch Broadcaster Token</h2>
          <p className="text-xs text-g-muted mt-0.5">Kreves for følgere, subscribers og kanaldata</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
          ok      ? 'text-g-green border-g-green/20 bg-g-green/5' :
          expired ? 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5' :
          'text-red-400 border-red-500/20 bg-red-500/5'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-g-green shadow-[0_0_6px_#00ff41]' : expired ? 'bg-yellow-400' : 'bg-red-400'}`} />
          {loading ? 'Sjekker...' : ok ? 'Tilkoblet' : expired ? 'Token utløpt' : 'Ikke tilkoblet'}
        </div>
      </div>

      <div className="p-6 space-y-4">
        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Workspace ID', value: wsId ?? '—', mono: true },
              { label: 'Twitch-konto', value: status?.twitchLogin ? `@${status.twitchLogin}` : '—', mono: true },
              {
                label: 'moderator:read:followers',
                value: hasF === true ? '✓ OK' : hasF === false ? '✗ Mangler' : '—',
                color: hasF === true ? 'text-g-green' : 'text-red-400',
              },
              {
                label: 'channel:read:subscriptions',
                value: hasSub === true ? '✓ OK' : hasSub === false ? '✗ Mangler (Affiliate)' : '—',
                color: hasSub === true ? 'text-g-green' : 'text-yellow-400',
              },
            ].map(r => (
              <div key={r.label} className="bg-g-bg border border-g-border/60 rounded-lg p-3">
                <div className="text-xs text-g-muted uppercase tracking-wide mb-1.5">{r.label}</div>
                <div className={`text-sm font-medium font-mono ${'color' in r ? r.color : 'text-g-text'}`}>{r.value}</div>
              </div>
            ))}
          </div>
        )}

        {!ok && !loading && (
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg text-xs text-red-400/80 leading-relaxed">
            {expired
              ? '⚠ Tokenet ditt er utløpt. Klikk "Koble til Twitch" for å fornye det — dette tar 10 sekunder og fikser følgere og subscribers.'
              : `✗ Ingen broadcaster-token funnet for workspace "${wsId}". Boten bruker et eget Railway-token for chat, men followers/subs krever et personlig brukertoken.`
            }
          </div>
        )}

        {ok && !hasF && (
          <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-xs text-yellow-400 leading-relaxed">
            ⚠ Tokenet mangler <strong>moderator:read:followers</strong>-scope. Koble til på nytt nedenfor for å gi riktig tilgang.
          </div>
        )}

        <a
          href={connectUrl}
          className={`block text-center px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border ${
            ok
              ? 'bg-g-green/10 border-g-green/25 text-g-green hover:bg-g-green/20 hover:border-g-green/40'
              : 'bg-purple-500/5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/50'
          }`}
        >
          {ok ? '↻ Forny Twitch-token' : '⚡ Koble til Twitch (broadcaster)'}
        </a>

        <p className="text-xs text-g-muted/50 text-center">
          Dette er <strong className="text-g-muted/70">ikke</strong> bot-tilkoblingen — dette er broadcaster-token for å lese kanalstatistikk.
        </p>
      </div>
    </div>
  );
}

// ─── Helse Panel ──────────────────────────────────────────────────────────────

function HelsePanel() {
  const [health, setHealth] = useState<Record<string, HealthItem> | null>(null);
  const [loading, setLoading] = useState(false);

  const sjekk = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/content-factory/health').catch(() => null);
    if (res?.ok) setHealth(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { sjekk(); }, [sjekk]);

  const tjenester = health ? [
    { label: 'Railway',  ...health.railway },
    { label: 'Supabase', ...health.supabase },
    { label: 'Storage',  ...health.storage },
    { label: 'OpenAI',   ...health.openai },
    { label: 'Twitch',   ...health.twitch },
  ] : [];

  return (
    <div id="helse" className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-g-border/40">
        <div>
          <h2 className="text-sm font-semibold text-g-text">Systemstatus og API-status</h2>
          <p className="text-xs text-g-muted mt-0.5">Alle integrasjoner og tjenester</p>
        </div>
        <button
          onClick={sjekk}
          disabled={loading}
          className="px-3 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
        >
          {loading ? '⟳ Sjekker...' : '↻ Sjekk alle'}
        </button>
      </div>

      {!health && !loading && (
        <p className="text-sm text-g-muted">Klikk «Sjekk alle» for å teste tilkobling.</p>
      )}

      {loading && (
        <div className="grid grid-cols-5 gap-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-g-bg border border-g-border rounded-lg animate-pulse" />)}
        </div>
      )}

      {health && !loading && (
        <div className="grid grid-cols-5 gap-2">
          {tjenester.map(t => (
            <div key={t.label} className={`p-3 rounded-lg border text-center ${t.ok ? 'border-g-green/20 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <div className="flex items-center justify-center mb-2">
                <span className={`w-2 h-2 rounded-full ${t.ok ? 'bg-g-green' : 'bg-red-500'}`} />
              </div>
              <p className={`text-xs font-semibold ${t.ok ? 'text-g-green' : 'text-red-400'}`}>{t.label}</p>
              <p className="text-xs text-g-muted mt-1 break-all leading-tight">{t.melding}</p>
            </div>
          ))}
        </div>
      )}

      {health && !health.altOk && (
        <div className="mt-4 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400 font-medium">⚠ En eller flere tjenester er nede</p>
          <p className="text-xs text-g-muted mt-1">Pipeline vil feile. Fiks tilkoblingen og kjør sjekk på nytt.</p>
        </div>
      )}
    </div>
  );
}

// ─── Debug Panel ──────────────────────────────────────────────────────────────

function DebugPanel() {
  const [vis, setVis] = useState(false);
  const [data, setData] = useState<{ channelDebug: unknown; dashboardSnapshot: unknown } | null>(null);

  const hent = async () => {
    const [dbg, dash] = await Promise.allSettled([
      fetch('/api/channel-settings/debug').then(r => r.json()).catch(() => null),
      fetch('/api/dashboard').then(r => r.json()).catch(() => null),
    ]);
    setData({
      channelDebug: dbg.status === 'fulfilled' ? dbg.value : null,
      dashboardSnapshot: dash.status === 'fulfilled' ? dash.value : null,
    });
    setVis(true);
  };

  return (
    <div id="debug" className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-g-border/40">
        <div>
          <h2 className="text-sm font-semibold text-g-text">Debug</h2>
          <p className="text-xs text-g-muted mt-0.5">Rådata fra API for feilsøking</p>
        </div>
        <button
          onClick={hent}
          className="px-3 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
        >
          Hent debug-data
        </button>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {[
          { label: 'API Status', href: '/api/status' },
          { label: 'Dashboard API', href: '/api/dashboard' },
          { label: 'CF Health', href: '/api/content-factory/health' },
          { label: 'Bot Activity', href: '/api/bot-activity' },
          { label: 'Bot Health', href: '/api/bot-health' },
        ].map(l => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all font-mono"
          >
            {l.label} ↗
          </a>
        ))}
      </div>

      {vis && data && (
        <pre className="text-xs text-g-muted bg-g-bg border border-g-border rounded-lg p-3 overflow-auto max-h-64 font-mono leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Discord Kanaler Panel ────────────────────────────────────────────────────

function DiscordKanalerPanel() {
  const [kanaler, setKanaler] = useState<{ id: string; navn: string; kategori: string }[]>([]);
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [lagrer, setLagrer] = useState(false);
  const [lagret, setLagret] = useState(false);
  const [lagreFeil, setLagreFeil] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/channel-settings').then(r => r.json()).then(d => {
      setKanaler(d.kanaler ?? []);
      setPrefs(d.preferanser ?? {});
    }).catch(() => {});
  }, []);

  async function lagre() {
    setLagrer(true);
    setLagreFeil(null);
    try {
      const res = await fetch('/api/channel-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setLagreFeil(data?.error ?? `Lagring feilet (HTTP ${res.status})`);
        setLagrer(false);
        return;
      }
      setLagret(true);
      setTimeout(() => setLagret(false), 2000);
    } catch (err: unknown) {
      setLagreFeil(err instanceof Error ? err.message : 'Nettverksfeil — prøv igjen');
    }
    setLagrer(false);
  }

  const kanalTyper = [
    { felt: 'live',            label: 'Live-varsling',        desc: 'Boten poster her når stream starter' },
    { felt: 'chat',            label: 'Chat / Generell',      desc: 'Fallback for promos og meldinger' },
    { felt: 'clips',           label: 'Klipp',                desc: 'Ferdige klipp postes her' },
    { felt: 'partner',         label: 'Partner-reklame',      desc: 'Partner-promos (overstyrer Chat)' },
    { felt: 'subs',            label: 'Subs & Gifts',         desc: 'Sub- og gift-anerkjennelser' },
    { felt: 'raid',            label: 'Raids',                desc: 'Raid-varsler og raid-anbefalinger' },
    { felt: 'streamplan',      label: 'Streamplan',           desc: 'Streamplan-oppdateringer' },
    { felt: 'content_factory', label: 'Content Factory',      desc: 'Ferdige highlights og thumbnails' },
    { felt: 'errors',          label: 'Feil & Varsler',       desc: 'Tekniske feil fra boten' },
    { felt: 'pre_hype',        label: 'Pre-Hype',             desc: 'Pre-hype varsler før stream starter' },
    { felt: 'community',       label: 'Community',            desc: 'Level-ups, hype og community-aktivitet' },
    { felt: 'admin',           label: 'Admin / Bot-analyse',  desc: 'Kanal-analyse og bot-rapporter (kun admin)' },
  ];

  return (
    <div id="discord-kanaler" className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-g-border/40">
        <div>
          <h2 className="text-sm font-semibold text-g-text">Discord Kanaler</h2>
          {kanaler.length === 0 && (
            <p className="text-xs text-yellow-400/70 mt-0.5">DISCORD_BOT_TOKEN eller DISCORD_GUILD_ID mangler</p>
          )}
        </div>
      </div>
      <p className="text-xs text-g-muted mb-5">Velg hvilken Discord-kanal boten bruker for hver hendelsestype. Lagres til Supabase og synces til boten innen 5 min.</p>

      <div className="space-y-2">
        {kanalTyper.map(({ felt, label, desc }) => (
          <div key={felt} className="grid grid-cols-[1fr_auto] gap-3 items-center py-2.5 border-b border-g-border/30 last:border-0">
            <div>
              <p className="text-sm text-g-text">{label}</p>
              <p className="text-xs text-g-muted mt-0.5">{desc}</p>
            </div>
            <select
              value={prefs[felt] ?? ''}
              onChange={e => setPrefs(p => ({ ...p, [felt]: e.target.value }))}
              className="bg-g-bg border border-g-border rounded-lg px-2 py-2 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 min-w-[180px] transition-all"
            >
              <option value="">— Ikke satt —</option>
              {kanaler.map(k => (
                <option key={k.id} value={k.id}>#{k.navn} ({k.kategori})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={lagre}
          disabled={lagrer}
          className="px-5 py-2.5 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 hover:shadow-green-sm transition-all duration-200 disabled:opacity-40"
        >
          {lagrer ? 'Lagrer...' : lagret ? '✓ Lagret!' : 'Lagre kanalvalg'}
        </button>
        {lagreFeil && (
          <span className="text-sm text-red-400">⚠ {lagreFeil}</span>
        )}
      </div>
    </div>
  );
}

// ─── Automatiseringer Panel ───────────────────────────────────────────────────

const TONER = [
  { verdi: 'dark_gaming',  label: 'Dark Gaming',   desc: 'Rå, direkte, hacker-estetikk' },
  { verdi: 'hype',         label: 'Hype',          desc: 'Energisk, caps, emojis, alt er episk' },
  { verdi: 'humoristisk',  label: 'Humoristisk',   desc: 'Lett, selvironisk, inkluderende' },
  { verdi: 'rp_stil',      label: 'RP-stil',       desc: 'Fortellende, i karakter' },
  { verdi: 'cinematic',    label: 'Cinematisk',    desc: 'Dramatisk, slagkraftige setninger' },
  { verdi: 'profesjonell', label: 'Profesjonell',  desc: 'Ryddig, kort, ingen slang' },
];

function AutomatiseringerPanel() {
  const [botSettings, setBotSettings] = useState<BotSettingsData | null>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setBotSettings(d.settings ?? d)).catch(() => {});
  }, []);

  async function lagreFelt(felt: string, verdi: boolean | string) {
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    });
    setBotSettings(prev => prev ? { ...prev, [felt]: verdi } as BotSettingsData : prev);
  }

  const flagg: { label: string; felt: keyof BotSettingsData; aktivtNårFalse: boolean }[] = botSettings ? [
    { label: 'Discord-bot aktiv',       felt: 'pauseDiscord',      aktivtNårFalse: true },
    { label: 'Auto live-varsler',        felt: 'pauseLiveVarsler',  aktivtNårFalse: true },
    { label: 'Auto partner-promo',       felt: 'pausePartnerPromo', aktivtNårFalse: true },
    { label: 'AI proaktive meldinger',   felt: 'pauseProaktiv',     aktivtNårFalse: true },
  ] : [];

  return (
    <div id="automatiseringer" className="bg-g-card border border-g-border rounded-2xl p-6 space-y-5">
      <div className="pb-4 border-b border-g-border/40">
        <h2 className="text-sm font-semibold text-g-text">Bot-innstillinger</h2>
        <p className="text-xs text-g-muted mt-0.5">Skru av/på handlinger og velg bot-tone. Synces til Railway-boten via Supabase.</p>
      </div>

      {!botSettings ? (
        <p className="text-sm text-g-muted">Laster...</p>
      ) : (
        <div className="space-y-0.5">
          {flagg.map(f => {
            const raw = botSettings[f.felt];
            const aktiv = f.aktivtNårFalse ? !raw : !!raw;
            return (
              <div key={f.felt} className="flex items-center justify-between py-3 border-b border-g-border/40 last:border-0">
                <span className="text-sm text-g-text">{f.label}</span>
                <button
                  onClick={() => lagreFelt(f.felt, f.aktivtNårFalse ? !!raw : !raw)}
                  className={`relative w-10 h-5 rounded-full transition-all duration-200 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {botSettings && (
        <div>
          <p className="text-xs font-medium text-g-muted tracking-wide uppercase mb-3">Bot-tone / Personlighet</p>
          <div className="grid grid-cols-3 gap-2">
            {TONER.map(t => (
              <button
                key={t.verdi}
                onClick={() => lagreFelt('tone', t.verdi)}
                className={`p-3 rounded-lg border text-left transition-all ${botSettings.tone === t.verdi ? 'border-g-green/40 bg-g-green/10' : 'border-g-border bg-g-bg hover:border-g-green/20'}`}
              >
                <p className={`text-xs font-semibold ${botSettings.tone === t.verdi ? 'text-g-green' : 'text-g-text'}`}>{t.label}</p>
                <p className="text-xs text-g-muted mt-0.5 leading-tight">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Master Bot Toggle ────────────────────────────────────────────────────────

function MasterBotToggle() {
  const [aktiv, setAktiv] = useState<boolean | null>(null);
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setAktiv(!!(d.settings ?? d).aktiv)).catch(() => {});
    fetch('/api/bot-health').then(r => r.json()).then(d => setBotOnline(d.online)).catch(() => setBotOnline(false));
  }, []);

  async function toggle() {
    if (aktiv === null) return;
    const next = !aktiv;
    setSaving(true);
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktiv: next }),
    }).catch(() => {});
    setAktiv(next);
    setSaving(false);
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
          botOnline === true ? 'bg-g-green shadow-[0_0_8px_#00ff41] animate-pulse' :
          botOnline === false ? 'bg-red-400' : 'bg-g-muted animate-pulse'
        }`} />
        <div>
          <p className="text-sm font-semibold text-g-text">Bot Master-kontroll</p>
          <p className="text-xs text-g-muted mt-0.5">
            Railway: {botOnline === true ? 'Online' : botOnline === false ? 'Offline' : 'Sjekker...'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {saving && <span className="text-xs text-g-muted">Lagrer...</span>}
        <span className={`text-xs font-medium ${aktiv ? 'text-g-green' : 'text-g-muted'}`}>
          {aktiv === null ? '...' : aktiv ? 'Aktiv' : 'Inaktiv'}
        </span>
        {aktiv !== null ? (
          <button
            onClick={toggle}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-all duration-200 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border-2 border-g-border'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200 ${aktiv ? 'left-6 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
          </button>
        ) : (
          <div className="w-12 h-6 bg-g-bg border border-g-border rounded-full animate-pulse" />
        )}
      </div>
    </div>
  );
}

// ─── Bot Watching Status ──────────────────────────────────────────────────────

function BotWatchingStatus() {
  const [s, setS] = useState<BotSettingsData | null>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setS(d.settings ?? d)).catch(() => {});
  }, []);

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-4 flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s?.aktiv ? 'bg-g-green animate-pulse' : 'bg-g-muted'}`} />
      <div>
        <p className="text-sm text-g-text">Bot lytter på Twitch-chat</p>
        <p className="text-xs text-g-muted mt-0.5">
          {s === null ? 'Sjekker...' : s?.aktiv ? 'Aktiv — boten er koblet til og lytter' : 'Inaktiv — skru på i Bot-atferd'}
        </p>
      </div>
    </div>
  );
}

// ─── Bot Heartbeat Card ───────────────────────────────────────────────────────

function BotHeartbeatCard() {
  const [status, setStatus] = useState<{ online?: boolean; lastSeen?: string } | null>(null);

  useEffect(() => {
    fetch('/api/bot-health').then(r => r.json()).then(d => setStatus(d)).catch(() => setStatus({ online: false }));
  }, []);

  return (
    <div className={`bg-g-card border rounded-2xl p-5 flex items-center justify-between ${status?.online ? 'border-g-green/20' : 'border-g-border'}`}>
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          status === null ? 'bg-g-muted animate-pulse' :
          status?.online ? 'bg-g-green animate-pulse shadow-[0_0_8px_#00ff41]' : 'bg-red-400'
        }`} />
        <div>
          <p className="text-sm font-semibold text-g-text">Railway Bot Heartbeat</p>
          <p className="text-xs text-g-muted mt-0.5">
            {status === null ? 'Sjekker...' : status?.online ? 'Online og aktiv' : 'Offline eller ikke tilgjengelig'}
          </p>
        </div>
      </div>
      {status?.lastSeen && (
        <span className="text-xs font-mono text-g-muted">Sist sett: {status.lastSeen}</span>
      )}
    </div>
  );
}

// ─── Economy Section ──────────────────────────────────────────────────────────

const ECONOMY_RATES = {
  DAILY_BONUS: 10,
  STREAK_7: 25,
  STREAK_30: 75,
  TWITCH_SUB: 50,
} as const;

function EconomySection() {
  const [settings, setSettings] = useState<BotSettingsData | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setSettings(d.settings ?? d)).catch(() => {});
  }, []);

  async function lagreFelt(felt: keyof BotSettingsData, verdi: boolean | number | string) {
    setSaving(String(felt));
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    }).catch(() => {});
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, [felt]: verdi } as BotSettingsData;
    });
    setSaving(null);
  }

  function EconToggle({ felt, label, desc }: { felt: keyof BotSettingsData; label: string; desc?: string }) {
    const val = settings?.[felt];
    const aktiv = typeof val === 'boolean' ? val : false;
    const configured = typeof val === 'boolean';
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/30 last:border-0">
        <div>
          <p className="text-sm text-g-text">{label}</p>
          {desc && <p className="text-xs text-g-muted mt-0.5">{desc}</p>}
          {!configured && <p className="text-xs text-g-muted/40 mt-0.5 italic">ikke konfigurert</p>}
        </div>
        <button
          onClick={() => lagreFelt(felt, !aktiv)}
          disabled={saving === String(felt)}
          className={`relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
        </button>
      </div>
    );
  }

  function EconNumber({ felt, label, desc, min, max }: { felt: keyof BotSettingsData; label: string; desc?: string; min?: number; max?: number }) {
    const val = settings?.[felt];
    const numVal = typeof val === 'number' ? val : null;
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/30 last:border-0">
        <div>
          <p className="text-sm text-g-text">{label}</p>
          {desc && <p className="text-xs text-g-muted mt-0.5">{desc}</p>}
          {numVal === null && <p className="text-xs text-g-muted/40 mt-0.5 italic">ikke konfigurert</p>}
        </div>
        {numVal !== null && (
          <input
            type="number"
            value={numVal}
            min={min}
            max={max}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) lagreFelt(felt, n);
            }}
            className="w-24 bg-g-bg border border-g-border rounded-lg px-3 py-2 text-sm text-g-text font-mono text-right focus:outline-none focus:border-g-green/40 transition-all"
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Økonomi / XP / Coins</h2>
        <p className="text-sm text-g-muted mt-1">Administrer coin-system, XP og daglige bonuser.</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-1">System-tilstander</p>
        {!settings ? (
          <p className="text-sm text-g-muted py-3">Laster...</p>
        ) : (
          <>
            <EconToggle felt="economyEnabled" label="Economy-system aktiv" desc="Aktiverer hele coin- og XP-systemet" />
            <EconToggle felt="coinsEnabled" label="Coins aktivert" desc="Brukere tjener coins ved aktivitet" />
            <EconToggle felt="streakBonusEnabled" label="Streak-bonus" desc="Daglig streak gir ekstra coins" />
            <EconNumber felt="xpPerMessage" label="XP per melding" desc="Antall XP brukere får per chat-melding" min={0} max={100} />
            <EconNumber felt="dailyBonusCoins" label="Daglig bonus (coins)" desc="Coins brukere får for daglig innlogging" min={0} />
          </>
        )}
      </div>

      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-4">Statiske rater</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Daglig bonus',     value: ECONOMY_RATES.DAILY_BONUS },
            { label: 'Streak 7 dager',   value: ECONOMY_RATES.STREAK_7 },
            { label: 'Streak 30 dager',  value: ECONOMY_RATES.STREAK_30 },
            { label: 'Twitch Sub',       value: ECONOMY_RATES.TWITCH_SUB },
          ].map(r => (
            <div key={r.label} className="bg-g-bg border border-g-border rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-g-muted">{r.label}</span>
              <span className="text-sm font-mono font-semibold text-g-green">{r.value} <span className="text-g-muted font-normal text-xs">coins</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AI Producer Section ──────────────────────────────────────────────────────

function AiProducerSection() {
  const [settings, setSettings] = useState<BotSettingsData | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setSettings(d.settings ?? d)).catch(() => {});
  }, []);

  async function lagreFelt(felt: keyof BotSettingsData, verdi: boolean | string) {
    setSaving(String(felt));
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    }).catch(() => {});
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, [felt]: verdi } as BotSettingsData;
    });
    setSaving(null);
  }

  function AiToggle({ felt, label, desc }: { felt: keyof BotSettingsData; label: string; desc?: string }) {
    const val = settings?.[felt];
    const aktiv = typeof val === 'boolean' ? val : false;
    const configured = typeof val === 'boolean';
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/30 last:border-0">
        <div>
          <p className="text-sm text-g-text">{label}</p>
          {desc && <p className="text-xs text-g-muted mt-0.5">{desc}</p>}
          {!configured && <p className="text-xs text-g-muted/40 mt-0.5 italic">ikke konfigurert</p>}
        </div>
        <button
          onClick={() => lagreFelt(felt, !aktiv)}
          disabled={saving === String(felt)}
          className={`relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">AI Produsent</h2>
        <p className="text-sm text-g-muted mt-1">Styr AI-adferd, auto-posting og hype-generator.</p>
      </div>

      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-1">AI-funksjoner</p>
        {!settings ? (
          <p className="text-sm text-g-muted py-3">Laster...</p>
        ) : (
          <>
            <AiToggle felt="aiAutoPosting" label="Auto-posting" desc="AI poster automatisk innhold til Discord/Twitch" />
            <AiToggle felt="aiHypeEnabled" label="Hype-generator" desc="AI genererer hype-meldinger ved viktige hendelser" />
            <AiToggle felt="aiSuggestions" label="AI-forslag" desc="Boten foreslår innhold og handlinger til deg" />
            {typeof settings.aiSafetyCooldown === 'number' && (
              <div className="py-3 border-t border-g-border/40 flex items-center justify-between">
                <div>
                  <p className="text-sm text-g-text">Sikkerhetskjøling</p>
                  <p className="text-xs text-g-muted mt-0.5">Minimum sekunder mellom AI-utsendelser</p>
                </div>
                <span className="text-sm font-mono text-g-green">{settings.aiSafetyCooldown}s</span>
              </div>
            )}
          </>
        )}
      </div>

      {settings && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-3">AI-tone / Personlighet</p>
          <div className="grid grid-cols-3 gap-2">
            {TONER_TWITCH.map(t => (
              <button
                key={t.verdi}
                onClick={() => lagreFelt('tone', t.verdi)}
                className={`p-3 rounded-lg border text-left transition-all ${settings.tone === t.verdi ? 'border-g-green/40 bg-g-green/10' : 'border-g-border bg-g-bg hover:border-g-green/20'}`}
              >
                <p className={`text-xs font-semibold ${settings.tone === t.verdi ? 'text-g-green' : 'text-g-text'}`}>{t.label}</p>
                <p className="text-xs text-g-muted mt-0.5 leading-tight">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workspace Section ────────────────────────────────────────────────────────

function WorkspaceSection() {
  const [workspace, setWorkspace] = useState<WorkspaceMe | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locale, setLocale] = useState('no');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/workspace/me').then(r => r.json()).then(d => setWorkspace(d)).catch(() => setWorkspace({}));
    fetch('/api/settings').then(r => r.json()).then(d => setSettings(d)).catch(() => {});
    try {
      const saved = localStorage.getItem('glenvex-locale');
      if (saved) setLocale(saved);
    } catch {}
  }, []);

  function updateSocial(platform: string, value: string) {
    setSettings(prev => prev ? { ...prev, socials: { ...prev.socials, [platform]: value } } : null);
  }

  async function saveSocials() {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Feil ved lagring');
      setSettings(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  function handleLocale(loc: string) {
    setLocale(loc);
    try { localStorage.setItem('glenvex-locale', loc); } catch {}
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Workspace</h2>
        <p className="text-sm text-g-muted mt-1">Merkevare, plattform-tilkoblinger og sosiale medier.</p>
      </div>

      {/* Brand */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-4">Merkevare</p>
        {workspace === null ? (
          <div className="h-14 bg-g-bg border border-g-border rounded-lg animate-pulse" />
        ) : (
          <div className="flex items-center gap-4">
            {workspace.twitchProfileImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={workspace.twitchProfileImage} alt="Profil" className="w-12 h-12 rounded-full border border-g-border object-cover" />
            )}
            <div>
              <p className="text-base font-semibold text-g-text">
                {workspace.brandName ?? workspace.twitchDisplayName ?? workspace.twitchLogin ?? '—'}
              </p>
              <p className="text-xs text-g-muted mt-0.5">
                Merkevare-navn · <span className="text-g-muted/50">Rediger i workspace-innstillinger</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Connection status */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`bg-g-card border rounded-2xl p-4 ${workspace?.twitchConnected ? 'border-g-green/20' : 'border-g-border'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${workspace?.twitchConnected ? 'bg-g-green animate-pulse' : 'bg-g-muted'}`} />
            <p className="text-xs font-medium text-g-text">Twitch</p>
          </div>
          <p className={`text-sm font-mono ${workspace?.twitchLogin ? 'text-g-green' : 'text-g-muted'}`}>
            {workspace?.twitchLogin ? `@${workspace.twitchLogin}` : 'Ikke tilkoblet'}
          </p>
        </div>
        <div className={`bg-g-card border rounded-2xl p-4 ${workspace?.discordConnected ? 'border-g-green/20' : 'border-g-border'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${workspace?.discordConnected ? 'bg-g-green animate-pulse' : 'bg-g-muted'}`} />
            <p className="text-xs font-medium text-g-text">Discord</p>
          </div>
          <p className={`text-sm ${workspace?.discordGuildName ? 'text-g-text' : 'text-g-muted'}`}>
            {workspace?.discordGuildName ?? (workspace?.discordConnected ? 'Tilkoblet' : 'Ikke tilkoblet')}
          </p>
        </div>
      </div>

      {/* Socials */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-g-border/40">
          <p className="text-xs font-medium uppercase tracking-wide text-g-muted">Sosiale medier</p>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-g-green">✓ Lagret</span>}
            {error && <span className="text-xs text-red-400">✗ {error}</span>}
            <button
              onClick={saveSocials}
              disabled={saving || !settings}
              className="px-4 py-1.5 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 transition-all disabled:opacity-40"
            >
              {saving ? 'Lagrer...' : 'Lagre'}
            </button>
          </div>
        </div>
        {!settings ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-g-bg border border-g-border rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {(['tiktok', 'instagram', 'twitter', 'youtube', 'discord'] as const).map(platform => (
              <div key={platform} className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-g-muted block">{platform}</label>
                <input
                  type="text"
                  value={settings.socials?.[platform] || ''}
                  onChange={e => updateSocial(platform, e.target.value)}
                  placeholder={`https://${platform}.com/ditt-brukernavn`}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Language */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-g-muted mb-4">Språk / Language</p>
        <div className="flex gap-2">
          {LOCALES.map(loc => (
            <button
              key={loc}
              onClick={() => handleLocale(loc)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${locale === loc ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'bg-g-bg border-g-border text-g-muted hover:text-g-text hover:border-g-green/20'}`}
            >
              {LOCALE_LABEL[loc]}
            </button>
          ))}
        </div>
      </div>

      {/* Passord */}
      <PassordPanel />

      {/* Tilgang og sikkerhet */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-g-text pb-4 mb-5 border-b border-g-border/40">Tilgang og sikkerhet</h2>
        <div className="space-y-4">
          {[
            { tittel: 'Passord-basert innlogging', tekst: 'Sett et passord for raskere innlogging. Magic link (e-post) er alltid tilgjengelig som backup.' },
            { tittel: 'Én bruker per workspace', tekst: 'Creator OS er bygget for én administrator per workspace. Kontakt support for flerbruker-oppsett.' },
            { tittel: 'Supabase-autentisering', tekst: 'Innlogging håndteres av Supabase Auth. Sessions er kryptert og utløper automatisk.' },
          ].map(t => (
            <div key={t.tittel} className="border-b border-g-border/30 pb-4 last:border-0 last:pb-0">
              <p className="text-sm font-medium text-g-text">{t.tittel}</p>
              <p className="text-xs text-g-muted mt-1 leading-relaxed">{t.tekst}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Logg ut */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-g-text pb-4 mb-4 border-b border-g-border/40">Logg ut</h2>
        <p className="text-sm text-g-muted mb-4">Avslutter gjeldende session og sletter auth-cookie.</p>
        <a
          href="/api/auth/logout"
          className="inline-block px-4 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-all"
        >
          Logg ut
        </a>
      </div>
    </div>
  );
}

// ─── Twitch Section ───────────────────────────────────────────────────────────

function TwitchSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => setSettings(d)).catch(() => {});
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : null);
  }

  async function save() {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Feil ved lagring');
      setSettings(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Twitch</h2>
        <p className="text-sm text-g-muted mt-1">Broadcaster-token, kanal og Content Factory.</p>
      </div>

      <BotWatchingStatus />
      <TwitchBroadcasterPanel />

      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-g-border/40">
          <p className="text-xs font-medium uppercase tracking-wide text-g-muted">Twitch-innstillinger</p>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-g-green">✓ Lagret</span>}
            {error && <span className="text-xs text-red-400">✗ {error}</span>}
            <button
              onClick={save}
              disabled={saving || !settings}
              className="px-4 py-1.5 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 transition-all disabled:opacity-40"
            >
              {saving ? 'Lagrer...' : 'Lagre'}
            </button>
          </div>
        </div>
        {!settings ? (
          <p className="text-sm text-g-muted">Laster...</p>
        ) : (
          <div className="space-y-4">
            {[
              { label: 'Twitch Brukernavn', field: 'twitchUsername' as keyof Settings, placeholder: 'ditt-brukernavn' },
              { label: 'Twitch URL',         field: 'twitchUrl'      as keyof Settings, placeholder: 'https://twitch.tv/ditt-brukernavn' },
            ].map(({ label, field, placeholder }) => (
              <div key={field} className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-g-muted block">{label}</label>
                <input
                  type="text"
                  value={(settings[field] as string) || ''}
                  onChange={e => update(field, e.target.value as Settings[typeof field])}
                  placeholder={placeholder}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-g-muted block">
                Content Factory – overvåk kanal
              </label>
              <input
                type="text"
                value={(settings.contentFactoryChannel as string) || ''}
                onChange={e => update('contentFactoryChannel', e.target.value as Settings['contentFactoryChannel'])}
                placeholder={settings.twitchUsername || 'ditt-brukernavn'}
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
              />
              <p className="text-xs text-g-muted/70 leading-relaxed">
                Hvilken Twitch-kanal Content Factory henter VODs fra. Standard: samme som bot-kanalen ({settings.twitchUsername || 'Twitch Brukernavn ovenfor'}).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Discord Section ──────────────────────────────────────────────────────────

function DiscordSection() {
  const [workspace, setWorkspace] = useState<WorkspaceMe | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    fetch('/api/workspace/me').then(r => r.json()).then(d => setWorkspace(d)).catch(() => setWorkspace({}));
    fetch('/api/settings').then(r => r.json()).then(d => setSettings(d)).catch(() => {});
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : null);
  }

  function SettingsToggle({ label, field }: { label: string; field: keyof Settings }) {
    const checked = (settings?.[field] as boolean) ?? false;
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/50 last:border-0">
        <span className="text-sm text-g-text">{label}</span>
        <button
          onClick={() => update(field, !checked as Settings[typeof field])}
          className={`relative w-10 h-5 rounded-full transition-all ${checked ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${checked ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
        </button>
      </div>
    );
  }

  async function save() {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Feil ved lagring');
      setSettings(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  async function testDiscord() {
    setTestStatus('loading'); setTestMsg('');
    try {
      /* TODO: /api/bot/test-discord */
      const res = await fetch('/api/bot/test-discord', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setTestStatus('error'); setTestMsg('Ikke implementert ennå');
      } else if (res.ok) {
        setTestStatus('ok'); setTestMsg((d as { message?: string }).message ?? 'Sendt!');
      } else {
        setTestStatus('error'); setTestMsg((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch {
      setTestStatus('error'); setTestMsg('Nettverksfeil');
    }
    setTimeout(() => { setTestStatus('idle'); setTestMsg(''); }, 3000);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Discord</h2>
        <p className="text-sm text-g-muted mt-1">Kanaltildeling, meldinger og integrasjon.</p>
      </div>

      {/* Guild status + test button */}
      <div className={`bg-g-card border rounded-2xl p-5 flex items-center justify-between gap-4 ${workspace?.discordConnected ? 'border-g-green/20' : 'border-g-border'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${workspace?.discordConnected ? 'bg-g-green animate-pulse' : 'bg-g-muted'}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-g-text truncate">
              {workspace?.discordGuildName ?? (workspace?.discordConnected ? 'Discord tilkoblet' : 'Discord ikke tilkoblet')}
            </p>
            <p className="text-xs text-g-muted mt-0.5">
              {workspace === null ? 'Sjekker...' : workspace?.discordConnected ? 'Guild er tilkoblet og aktiv' : 'Koble til Discord for å aktivere bot-funksjoner'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {testStatus === 'ok' && <span className="text-xs text-g-green">✓ {testMsg}</span>}
          {testStatus === 'error' && <span className="text-xs text-red-400">✗ {testMsg}</span>}
          <button
            onClick={testDiscord}
            disabled={testStatus === 'loading'}
            className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 transition-all disabled:opacity-40"
          >
            {testStatus === 'loading' ? '⟳ Sender...' : 'Test discord-melding'}
          </button>
        </div>
      </div>

      <DiscordKanalerPanel />

      {/* Advanced Discord settings from /api/settings */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-g-border/40">
          <p className="text-xs font-medium uppercase tracking-wide text-g-muted">Avanserte Discord-innstillinger</p>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-g-green">✓ Lagret</span>}
            {error && <span className="text-xs text-red-400">✗ {error}</span>}
            <button
              onClick={save}
              disabled={saving || !settings}
              className="px-4 py-1.5 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 transition-all disabled:opacity-40"
            >
              {saving ? 'Lagrer...' : 'Lagre'}
            </button>
          </div>
        </div>
        {!settings ? (
          <p className="text-sm text-g-muted">Laster...</p>
        ) : (
          <div className="space-y-4">
            {[
              { label: 'Live Kanal ID',    field: 'discordLiveChannelId' as keyof Settings, placeholder: '123456789012345678' },
              { label: 'Varsel Rolle ID',  field: 'discordLiveRoleId'    as keyof Settings, placeholder: '123456789012345678' },
            ].map(({ label, field, placeholder }) => (
              <div key={field} className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-g-muted block">{label}</label>
                <input
                  type="text"
                  value={(settings[field] as string) || ''}
                  onChange={e => update(field, e.target.value as Settings[typeof field])}
                  placeholder={placeholder}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
                />
              </div>
            ))}
            <div className="border-t border-g-border/40 pt-3 space-y-1">
              <SettingsToggle label="Auto Post Live" field="autoPostLive" />
              <SettingsToggle label="Auto Post Promo" field="autoPostPromo" />
              <SettingsToggle label="Ping Rolle ved Live" field="pingRole" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bot Behavior Section ─────────────────────────────────────────────────────

function BotBehaviorSection() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Bot-atferd</h2>
        <p className="text-sm text-g-muted mt-1">Master-kontroll, chat-innstillinger og automatiseringer.</p>
      </div>
      <MasterBotToggle />
      <TwitchBotAdminPanel />
      <AutomatiseringerPanel />
    </div>
  );
}

// ─── System Section ───────────────────────────────────────────────────────────

function SystemSection() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold gradient-text">Systemstatus</h2>
        <p className="text-sm text-g-muted mt-1">Helse-sjekk, debug og systemsider.</p>
      </div>

      <BotHeartbeatCard />
      <HelsePanel />

      <div className="grid grid-cols-2 gap-5 items-start">
        <DebugPanel />

        <div className="space-y-5">
          <div className="bg-g-card border border-g-border rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-g-text pb-4 mb-4 border-b border-g-border/40">Systemsider</h2>
            <div className="space-y-0.5">
              {[
                { label: 'Identity Diagnostics', href: '/identity-repair',            desc: 'Fiks feil workspace i JWT — topbar viser feil navn?' },
                { label: 'Logging',            href: '/logs',                     desc: 'Alle bot-logger og feilmeldinger' },
                { label: 'Systemhelse (full)', href: '/system-health',            desc: 'Detaljert helsesjekk' },
                { label: 'QA-oversikt',        href: '/content-factory-admin/qa', desc: 'Content factory kvalitetskontroll' },
                { label: 'Setup Wizard',       href: '/setup-wizard',             desc: 'Oppsett av workspace' },
              ].map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex items-center justify-between py-3 border-b border-g-border/30 last:border-0 group"
                >
                  <div>
                    <p className="text-sm text-g-text group-hover:text-g-green transition-colors">{l.label}</p>
                    <p className="text-xs text-g-muted mt-0.5">{l.desc}</p>
                  </div>
                  <span className="text-g-muted group-hover:text-g-green transition-colors text-sm">↗</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-g-card border border-g-border rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-g-text pb-4 mb-4 border-b border-g-border/40">API-snarveier</h2>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Status',        href: '/api/status' },
                { label: 'Dashboard',     href: '/api/dashboard' },
                { label: 'CF Health',     href: '/api/content-factory/health' },
                { label: 'Bot Activity',  href: '/api/bot-activity' },
                { label: 'Bot Health',    href: '/api/bot-health' },
                { label: 'System Events', href: '/api/system-events?limit=20' },
              ].map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all font-mono"
                >
                  {l.label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Layout ──────────────────────────────────────────────────────────────

type SectionId = 'workspace' | 'twitch' | 'discord' | 'bot-behavior' | 'economy' | 'ai-producer' | 'system';

const SEKSJONER: { id: SectionId; label: string; ikon: string; desc: string }[] = [
  { id: 'workspace',    label: 'Workspace',    ikon: '◈', desc: 'Merkevare og tilkoblinger' },
  { id: 'twitch',       label: 'Twitch',       ikon: '▶', desc: 'Broadcaster token og bot' },
  { id: 'discord',      label: 'Discord',      ikon: '◉', desc: 'Kanaler og meldinger' },
  { id: 'bot-behavior', label: 'Bot-atferd',   ikon: '⚙', desc: 'Kontroll og tone' },
  { id: 'economy',      label: 'Økonomi',      ikon: '◎', desc: 'XP, coins og belønninger' },
  { id: 'ai-producer',  label: 'AI Produsent', ikon: '✦', desc: 'AI-atferd og tone' },
  { id: 'system',       label: 'System',       ikon: '⬡', desc: 'Helse og debug' },
];

export default function InnstillingerSide() {
  const [aktivSeksjon, setAktivSeksjon] = useState<SectionId>('workspace');

  return (
    <div className="space-y-6 p-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-semibold gradient-text">Innstillinger</h1>
        <p className="text-sm text-g-muted mt-1">
          {SEKSJONER.find(s => s.id === aktivSeksjon)?.desc}
        </p>
      </div>

      {/* Sidebar + content */}
      <div className="flex gap-6 items-start">

        {/* Sidebar nav */}
        <nav className="w-52 flex-shrink-0 bg-g-card border border-g-border rounded-2xl overflow-hidden">
          <ul>
            {SEKSJONER.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => setAktivSeksjon(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-left text-sm font-medium transition-all border-r-2 border-b border-b-g-border/30 last:border-b-0 ${
                    aktivSeksjon === s.id
                      ? 'bg-g-green/10 border-r-g-green text-g-green'
                      : 'border-r-transparent text-g-muted hover:text-g-text hover:bg-g-bg/60'
                  }`}
                >
                  <span className="text-base leading-none w-4 text-center flex-shrink-0">{s.ikon}</span>
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {aktivSeksjon === 'workspace'    && <WorkspaceSection />}
          {aktivSeksjon === 'twitch'       && <TwitchSection />}
          {aktivSeksjon === 'discord'      && <DiscordSection />}
          {aktivSeksjon === 'bot-behavior' && <BotBehaviorSection />}
          {aktivSeksjon === 'economy'      && <EconomySection />}
          {aktivSeksjon === 'ai-producer'  && <AiProducerSection />}
          {aktivSeksjon === 'system'       && <SystemSection />}
        </div>
      </div>
    </div>
  );
}
