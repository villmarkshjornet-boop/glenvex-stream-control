'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Settings } from '@/types';

interface HealthItem { ok: boolean; melding: string; }

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
    <div id="passord" className="bg-g-card border border-g-border rounded-xl p-5">
      <h2 className="text-xs font-bold text-g-text mb-1">Sett passord</h2>
      <p className="text-[9px] text-g-muted mb-4">Sett et passord så du kan logge inn direkte neste gang.</p>
      <form onSubmit={settPassord} className="space-y-3 max-w-sm">
        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1">Nytt passord</label>
          <input type="password" value={passord} onChange={e => setPassord(e.target.value)}
            minLength={6} required placeholder="Minst 6 tegn"
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:outline-none focus:border-g-green/40" />
        </div>
        <div>
          <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1">Bekreft passord</label>
          <input type="password" value={bekreft} onChange={e => setBekreft(e.target.value)}
            minLength={6} required placeholder="Gjenta passord"
            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text focus:outline-none focus:border-g-green/40" />
        </div>
        {feil && <p className="text-xs text-red-400">{feil}</p>}
        {status === 'ok' && <p className="text-xs text-g-green">✓ Passord satt! Du kan nå logge inn med e-post og passord.</p>}
        <button type="submit" disabled={status === 'loading'}
          className="px-4 py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all disabled:opacity-50">
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

type BotEvent = { id: string; source: string; event_type: string; title: string; created_at: string; metadata?: any };

function TwitchBotAdminPanel() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setSettings(d.settings)).catch(() => {});
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

  async function lagreFelt(felt: string, verdi: any) {
    setSaving(true); setSaved(false);
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    });
    setSettings((prev: any) => prev ? { ...prev, [felt]: verdi } : prev);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function Toggle({ felt, label, desc, invertert = false }: { felt: string; label: string; desc?: string; invertert?: boolean }) {
    const aktiv = invertert ? !settings?.[felt] : !!settings?.[felt];
    return (
      <div className="flex items-center justify-between py-2 border-b border-g-border/30 last:border-0">
        <div>
          <p className="text-xs text-g-text">{label}</p>
          {desc && <p className="text-[9px] text-g-muted">{desc}</p>}
        </div>
        <button
          onClick={() => lagreFelt(felt, invertert ? aktiv : !aktiv)}
          className={`relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}>
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
    <div id="twitch-bot" className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-g-border flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-g-text">Twitch Bot Admin</h2>
          <p className="text-[9px] text-g-muted mt-0.5">Full kontroll over Twitch-boten — chat-atferd, toggle-er og live aktivitet</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[9px] text-g-muted">Lagrer...</span>}
          {saved && <span className="text-[9px] text-g-green">✓ Lagret!</span>}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold border ${
            botOnline === true ? 'text-g-green border-g-green/20 bg-g-green/5' :
            botOnline === false ? 'text-red-400 border-red-500/20 bg-red-500/5' :
            'text-g-muted border-g-border'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${botOnline === true ? 'bg-g-green animate-pulse' : botOnline === false ? 'bg-red-400' : 'bg-g-muted'}`} />
            {botOnline === true ? 'Railway Online' : botOnline === false ? 'Railway Offline' : 'Sjekker...'}
          </div>
        </div>
      </div>

      {!settings ? (
        <div className="p-5"><p className="text-xs text-g-muted">Laster...</p></div>
      ) : (
        <div className="p-5 space-y-6">

          {/* Master toggle */}
          <div>
            <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Master-kontroll</p>
            <div className="flex items-center justify-between p-3 rounded-lg border border-g-border bg-g-bg">
              <div>
                <p className="text-xs font-bold text-g-text">Bot aktiv</p>
                <p className="text-[9px] text-g-muted">Skrur av/på all bot-aktivitet (Twitch + Discord)</p>
              </div>
              <button
                onClick={() => lagreFelt('aktiv', !settings.aktiv)}
                className={`relative w-12 h-6 rounded-full transition-all duration-200 ${settings.aktiv ? 'bg-g-green/70' : 'bg-g-bg border-2 border-g-border'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200 ${settings.aktiv ? 'left-6 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
              </button>
            </div>
          </div>

          {/* Twitch chat toggles */}
          <div>
            <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Twitch Chat</p>
            <div className="bg-g-bg border border-g-border rounded-lg px-3 divide-y divide-g-border/30">
              <Toggle felt="pauseTwitch" label="Twitch chat-svar" desc="Boten svarer i Twitch-chat" invertert />
              <Toggle felt="pausePartnerPromo" label="Partner-promo i chat" desc="AI-generert partner-reklame hvert 60 min" invertert />
              <Toggle felt="pauseLiveVarsler" label="Live-varsler til Discord" desc="Poster embed når stream starter" invertert />
              <Toggle felt="pauseProaktiv" label="Proaktive Discord-meldinger" desc="Promo, streamplan, community-oppdateringer" invertert />
            </div>
          </div>

          {/* Chat-atferd */}
          <div>
            <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Chat-atferd</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-g-bg border border-g-border rounded-lg p-3">
                <label className="text-[9px] text-g-muted uppercase tracking-wider font-bold block mb-2">
                  Svar-sjanse: <span className="text-g-green">{Math.round((settings.svarSjanse ?? 0.35) * 100)}%</span>
                </label>
                <input
                  type="range" min="0" max="100" step="5"
                  value={Math.round((settings.svarSjanse ?? 0.35) * 100)}
                  onChange={e => lagreFelt('svarSjanse', parseInt(e.target.value) / 100)}
                  className="w-full accent-green-500"
                />
                <p className="text-[8px] text-g-muted mt-1">Sjanse for at boten svarer på tilfeldige meldinger</p>
              </div>
              <div className="bg-g-bg border border-g-border rounded-lg p-3">
                <label className="text-[9px] text-g-muted uppercase tracking-wider font-bold block mb-2">
                  Cooldown: <span className="text-g-green">{settings.cooldownSek ?? 15}s</span>
                </label>
                <input
                  type="number" min="5" max="300" step="5"
                  value={settings.cooldownSek ?? 15}
                  onChange={e => lagreFelt('cooldownSek', parseInt(e.target.value) || 15)}
                  className="w-full bg-transparent text-xs text-g-text border-0 outline-none focus:border-0"
                />
                <p className="text-[8px] text-g-muted mt-1">Sekunder mellom svar til samme bruker</p>
              </div>
            </div>
          </div>

          {/* Tone */}
          <div>
            <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Bot-tone i Twitch-chat</p>
            <div className="grid grid-cols-3 gap-2">
              {TONER_TWITCH.map(t => (
                <button key={t.verdi}
                  onClick={() => lagreFelt('tone', t.verdi)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${settings.tone === t.verdi ? 'border-g-green/40 bg-g-green/10' : 'border-g-border bg-g-bg hover:border-g-green/20'}`}>
                  <p className={`text-[10px] font-bold ${settings.tone === t.verdi ? 'text-g-green' : 'text-g-text'}`}>{t.label}</p>
                  <p className="text-[8px] text-g-muted mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Chat-kommandoer */}
          <div>
            <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Tilgjengelige chat-kommandoer</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { cmd: '!discordsiste', desc: 'Oppsummerer siste Discord-aktivitet', plattform: 'Twitch' },
                { cmd: '!discordtema', desc: 'Viser hva som diskuteres i Discord', plattform: 'Twitch' },
                { cmd: '!twitchsiste', desc: 'Oppsummerer siste Twitch-aktivitet', plattform: 'Discord' },
                { cmd: '!twitchtema', desc: 'Viser aktuelle Twitch-temaer', plattform: 'Discord' },
                { cmd: '!communitymemory', desc: 'AI-oppsummering av community-hukommelse', plattform: 'Discord' },
              ].map(c => (
                <div key={c.cmd} className="bg-g-bg border border-g-border rounded p-2">
                  <p className="text-[10px] font-mono font-bold text-g-green">{c.cmd}</p>
                  <p className="text-[8px] text-g-muted mt-0.5">{c.desc}</p>
                  <span className="text-[7px] text-g-muted/60 uppercase tracking-wider">{c.plattform}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live aktivitetsfeed */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold">Bot-aktivitet (siste 24t)</p>
              <button onClick={hentEvents} disabled={loadingEvents}
                className="text-[9px] text-g-muted hover:text-g-green transition-colors">
                {loadingEvents ? '⟳ Laster...' : '↻ Oppdater'}
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-[9px] text-g-muted">Ingen registrert aktivitet de siste 24 timene.</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {events.map(e => (
                  <div key={e.id} className="flex items-start gap-2 py-1.5 border-b border-g-border/20 last:border-0">
                    <span className="text-[9px] text-g-muted flex-shrink-0 w-24 mt-0.5">
                      {new Date(e.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[9px] text-g-muted flex-shrink-0 w-24">
                      {eventTypeLabel[e.event_type] ?? e.event_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[9px] text-g-text flex-1 leading-tight">{e.title}</span>
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

// ─── Integrasjons-helse ───────────────────────────────────────────────────────

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
    { label: 'Railway', ...health.railway },
    { label: 'Supabase', ...health.supabase },
    { label: 'Storage', ...health.storage },
    { label: 'OpenAI', ...health.openai },
    { label: 'Twitch', ...health.twitch },
  ] : [];

  return (
    <div id="helse" className="bg-g-card border border-g-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-bold text-g-text">Systemstatus og API-status</h2>
          <p className="text-[9px] text-g-muted mt-0.5">Alle integrasjoner og tjenester</p>
        </div>
        <button onClick={sjekk} disabled={loading}
          className="px-3 py-1.5 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          {loading ? '⟳ Sjekker...' : '↻ Sjekk alle'}
        </button>
      </div>

      {!health && !loading && (
        <p className="text-xs text-g-muted">Klikk «Sjekk alle» for å teste tilkobling.</p>
      )}

      {loading && (
        <div className="grid grid-cols-5 gap-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-g-bg border border-g-border rounded-lg animate-pulse" />)}
        </div>
      )}

      {health && !loading && (
        <div className="grid grid-cols-5 gap-2">
          {tjenester.map(t => (
            <div key={t.label} className={`p-3 rounded-lg border text-center ${t.ok ? 'border-g-green/20 bg-g-green/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <p className={`text-xl mb-1 ${t.ok ? 'text-g-green' : 'text-red-400'}`}>{t.ok ? '✓' : '✗'}</p>
              <p className={`text-[10px] font-black ${t.ok ? 'text-g-green' : 'text-red-400'}`}>{t.label}</p>
              <p className="text-[8px] text-g-muted mt-1 break-all leading-tight">{t.melding}</p>
            </div>
          ))}
        </div>
      )}

      {health && !health.altOk && (
        <div className="mt-3 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
          <p className="text-[10px] text-red-400 font-bold">⚠ En eller flere tjenester er nede</p>
          <p className="text-[9px] text-g-muted mt-1">Pipeline vil feile. Fiks tilkoblingen og kjør sjekk på nytt.</p>
        </div>
      )}
    </div>
  );
}

// ─── Debug ────────────────────────────────────────────────────────────────────

function DebugPanel() {
  const [vis, setVis] = useState(false);
  const [data, setData] = useState<any>(null);

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
    <div id="debug" className="bg-g-card border border-g-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-bold text-g-text">Debug</h2>
          <p className="text-[9px] text-g-muted mt-0.5">Rådata fra API for feilsøking</p>
        </div>
        <button onClick={hent}
          className="px-3 py-1.5 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          Hent debug-data
        </button>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {[
          { label: 'API Status', href: '/api/status' },
          { label: 'Dashboard API', href: '/api/dashboard' },
          { label: 'CF Health', href: '/api/content-factory/health' },
          { label: 'Bot Activity', href: '/api/bot-activity' },
          { label: 'Bot Health', href: '/api/bot-health' },
        ].map(l => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
            className="px-2.5 py-1.5 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all font-mono">
            {l.label} ↗
          </a>
        ))}
      </div>

      {vis && data && (
        <pre className="text-[8px] text-g-muted bg-g-bg border border-g-border rounded p-3 overflow-auto max-h-64 font-mono leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Discord Kanaler ──────────────────────────────────────────────────────────

function DiscordKanalerPanel() {
  const [kanaler, setKanaler] = useState<{ id: string; navn: string; kategori: string }[]>([]);
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [lagrer, setLagrer] = useState(false);
  const [lagret, setLagret] = useState(false);

  useEffect(() => {
    fetch('/api/channel-settings').then(r => r.json()).then(d => {
      setKanaler(d.kanaler ?? []);
      setPrefs(d.preferanser ?? {});
    }).catch(() => {});
  }, []);

  async function lagre() {
    setLagrer(true);
    await fetch('/api/channel-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    setLagrer(false);
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
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
  ];

  const ingenKanal = { id: '', navn: '— Ikke satt —' };

  return (
    <div id="discord-kanaler" className="bg-g-card border border-g-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xs font-bold text-g-text">Discord Kanaler</h2>
        {kanaler.length === 0 && (
          <span className="text-[9px] text-yellow-400/70">DISCORD_BOT_TOKEN eller DISCORD_GUILD_ID mangler</span>
        )}
      </div>
      <p className="text-[9px] text-g-muted mb-4">Velg hvilken Discord-kanal boten bruker for hver hendelsestype. Lagres til Supabase og synces til boten innen 5 min.</p>

      <div className="space-y-2">
        {kanalTyper.map(({ felt, label, desc }) => (
          <div key={felt} className="grid grid-cols-[1fr_auto] gap-3 items-center py-2 border-b border-g-border/30 last:border-0">
            <div>
              <p className="text-xs text-g-text">{label}</p>
              <p className="text-[9px] text-g-muted">{desc}</p>
            </div>
            <select
              value={prefs[felt] ?? ''}
              onChange={e => setPrefs(p => ({ ...p, [felt]: e.target.value }))}
              className="bg-g-bg border border-g-border rounded px-2 py-1.5 text-[10px] text-g-text font-mono focus:outline-none focus:border-g-green/40 min-w-[180px]">
              <option value={ingenKanal.id}>{ingenKanal.navn}</option>
              {kanaler.map(k => (
                <option key={k.id} value={k.id}>#{k.navn} ({k.kategori})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <button onClick={lagre} disabled={lagrer}
          className="px-5 py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
          {lagrer ? 'Lagrer...' : lagret ? '✓ Lagret!' : 'Lagre kanalvalg'}
        </button>
      </div>
    </div>
  );
}

// ─── Automatiseringer ─────────────────────────────────────────────────────────

const TONER = [
  { verdi: 'dark_gaming',  label: 'Dark Gaming',   desc: 'Rå, direkte, hacker-estetikk' },
  { verdi: 'hype',         label: 'Hype',          desc: 'Energisk, caps, emojis, alt er episk' },
  { verdi: 'humoristisk',  label: 'Humoristisk',   desc: 'Lett, selvironisk, inkluderende' },
  { verdi: 'rp_stil',      label: 'RP-stil',       desc: 'Fortellende, i karakter' },
  { verdi: 'cinematic',    label: 'Cinematisk',    desc: 'Dramatisk, slagkraftige setninger' },
  { verdi: 'profesjonell', label: 'Profesjonell',  desc: 'Ryddig, kort, ingen slang' },
];

function AutomatiseringerPanel() {
  const [botSettings, setBotSettings] = useState<any>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(d => setBotSettings(d.settings ?? d)).catch(() => {});
  }, []);

  async function lagreFelt(felt: string, verdi: any) {
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    });
    setBotSettings((prev: any) => prev ? { ...prev, [felt]: verdi } : prev);
  }

  const flagg = botSettings ? [
    { label: 'Discord-bot aktiv',       felt: 'pauseDiscord',      aktivtNårFalse: true },
    { label: 'Auto live-varsler',        felt: 'pauseLiveVarsler',  aktivtNårFalse: true },
    { label: 'Auto partner-promo',       felt: 'pausePartnerPromo', aktivtNårFalse: true },
    { label: 'AI proaktive meldinger',   felt: 'pauseProaktiv',     aktivtNårFalse: true },
  ] : [];

  return (
    <div id="automatiseringer" className="bg-g-card border border-g-border rounded-xl p-5 space-y-5">
      <div>
        <h2 className="text-xs font-bold text-g-text mb-1">Bot-innstillinger</h2>
        <p className="text-[9px] text-g-muted">Skru av/på handlinger og velg bot-tone. Synces til Railway-boten via Supabase.</p>
      </div>

      {/* Av/på-flagg */}
      {!botSettings ? (
        <p className="text-xs text-g-muted">Laster...</p>
      ) : (
        <div className="space-y-1">
          {flagg.map(f => {
            const aktiv = f.aktivtNårFalse ? !botSettings[f.felt] : !!botSettings[f.felt];
            return (
              <div key={f.felt} className="flex items-center justify-between py-2 border-b border-g-border/40 last:border-0">
                <span className="text-xs text-g-text">{f.label}</span>
                <button
                  onClick={() => lagreFelt(f.felt, f.aktivtNårFalse ? aktiv : !aktiv)}
                  className={`relative w-10 h-5 rounded-full transition-all duration-200 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Tone-velger */}
      {botSettings && (
        <div>
          <p className="text-[10px] text-g-muted tracking-widest uppercase font-bold mb-2">Bot-tone / Personlighet</p>
          <div className="grid grid-cols-3 gap-2">
            {TONER.map(t => (
              <button key={t.verdi}
                onClick={() => lagreFelt('tone', t.verdi)}
                className={`p-2.5 rounded-lg border text-left transition-all ${botSettings.tone === t.verdi ? 'border-g-green/40 bg-g-green/10' : 'border-g-border bg-g-bg hover:border-g-green/20'}`}>
                <p className={`text-[10px] font-bold ${botSettings.tone === t.verdi ? 'text-g-green' : 'text-g-text'}`}>{t.label}</p>
                <p className="text-[8px] text-g-muted mt-0.5 leading-tight">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Innstillinger-siden ───────────────────────────────────────────────────────

type Fane = 'bots' | 'integrasjoner' | 'system' | 'konto';

const FANER: { id: Fane; label: string; ikon: string; desc: string }[] = [
  { id: 'bots',           label: 'Bots',          ikon: '🟣', desc: 'Twitch og Discord bot-kontroll' },
  { id: 'integrasjoner',  label: 'Integrasjoner', ikon: '⚙',  desc: 'Kanaler, Twitch og sosiale medier' },
  { id: 'system',         label: 'Systemstatus',  ikon: '◉',  desc: 'Health checks og debug' },
  { id: 'konto',          label: 'Konto',         ikon: '◈',  desc: 'Passord og tilgang' },
];

export default function InnstillingerSide() {
  const [aktivFane, setAktivFane] = useState<Fane>('bots');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {});
  }, []);

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

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : null);
  }
  function updateSocial(platform: string, value: string) {
    setSettings(prev => prev ? { ...prev, socials: { ...prev.socials, [platform]: value } } : null);
  }
  function SettingsToggle({ label, field }: { label: string; field: keyof Settings }) {
    const checked = settings?.[field] as boolean ?? false;
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/50 last:border-0">
        <span className="text-xs text-g-text">{label}</span>
        <button onClick={() => update(field, !checked as Settings[typeof field])}
          className={`relative w-10 h-5 rounded-full transition-all ${checked ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${checked ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0">

      {/* ─── Topptekst + fane-nav ─────────────────────────────────────────────── */}
      <div className="border-b border-g-border bg-g-sidebar/40 px-6 pb-0 pt-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-lg font-black tracking-wider text-g-text uppercase">Innstillinger</h1>
            <p className="text-[9px] text-g-muted mt-0.5">{FANER.find(f => f.id === aktivFane)?.desc}</p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {aktivFane === 'integrasjoner' && saved && <span className="text-[9px] text-g-green">✓ Lagret</span>}
            {aktivFane === 'integrasjoner' && error && <span className="text-[9px] text-red-400">✗ {error}</span>}
            {aktivFane === 'integrasjoner' && (
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-[10px] font-bold uppercase tracking-widest rounded transition-all">
                {saving ? 'Lagrer...' : 'Lagre'}
              </button>
            )}
          </div>
        </div>

        {/* Fane-knapper */}
        <div className="flex gap-0">
          {FANER.map(fane => (
            <button key={fane.id} onClick={() => setAktivFane(fane.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                aktivFane === fane.id
                  ? 'border-g-green text-g-green'
                  : 'border-transparent text-g-muted hover:text-g-text hover:border-g-border'
              }`}>
              <span className="text-sm">{fane.ikon}</span>
              {fane.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Fane-innhold ─────────────────────────────────────────────────────── */}
      <div className="p-6">

        {/* ── BOTS ──────────────────────────────────────────────────────────── */}
        {aktivFane === 'bots' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-5 items-start">
              {/* Venstre: Twitch */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🟣</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-g-muted">Twitch Bot</span>
                </div>
                <TwitchBotAdminPanel />
              </div>

              {/* Høyre: Discord */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🔵</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-g-muted">Discord Bot</span>
                </div>
                <DiscordKanalerPanel />
                <AutomatiseringerPanel />
              </div>
            </div>

            {/* Info-widgets */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                {
                  ikon: '⟳',
                  tittel: 'Settings syncer innen 5 min',
                  tekst: 'Endringer lagres til Supabase og plukkes opp av Railway-boten ved neste poll.',
                },
                {
                  ikon: '📋',
                  tittel: 'Bot-aktivitet logges automatisk',
                  tekst: 'Alle meldinger boten sender (Twitch og Discord) registreres i aktivitetfeeden.',
                },
                {
                  ikon: '⚡',
                  tittel: 'Cross-platform kommandoer',
                  tekst: '!discordsiste (Twitch) og !twitchsiste (Discord) gir AI-oppsummering på tvers.',
                },
              ].map(w => (
                <div key={w.tittel} className="bg-g-card border border-g-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-g-green text-sm">{w.ikon}</span>
                    <p className="text-[10px] font-bold text-g-text">{w.tittel}</p>
                  </div>
                  <p className="text-[9px] text-g-muted leading-relaxed">{w.tekst}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── INTEGRASJONER ────────────────────────────────────────────────── */}
        {aktivFane === 'integrasjoner' && (
          <div className="space-y-5">
            {settings ? (
              <div className="grid grid-cols-2 gap-5 items-start">
                {/* Venstre kolonne */}
                <div className="space-y-5">
                  <div className="bg-g-card border border-g-border rounded-xl p-5">
                    <h2 className="text-[10px] text-g-muted font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                      <span>🔵</span> Discord
                    </h2>
                    <div className="space-y-3">
                      {[
                        { label: 'Live Kanal ID', field: 'discordLiveChannelId' as keyof Settings, placeholder: '123456789012345678' },
                        { label: 'Varsel Rolle ID', field: 'discordLiveRoleId' as keyof Settings, placeholder: '123456789012345678' },
                      ].map(({ label, field, placeholder }) => (
                        <div key={field}>
                          <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{label}</label>
                          <input type="text" value={(settings[field] as string) || ''}
                            onChange={e => update(field, e.target.value as Settings[typeof field])}
                            placeholder={placeholder}
                            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40" />
                        </div>
                      ))}
                      <SettingsToggle label="Auto Post Live" field="autoPostLive" />
                      <SettingsToggle label="Auto Post Promo" field="autoPostPromo" />
                      <SettingsToggle label="Ping Rolle ved Live" field="pingRole" />
                    </div>
                  </div>

                  <div className="bg-g-card border border-g-border rounded-xl p-5">
                    <h2 className="text-[10px] text-g-muted font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
                      <span>🟣</span> Twitch
                    </h2>
                    <div className="space-y-3">
                      {[
                        { label: 'Twitch Brukernavn', field: 'twitchUsername' as keyof Settings, placeholder: 'glenvex' },
                        { label: 'Twitch URL', field: 'twitchUrl' as keyof Settings, placeholder: 'https://twitch.tv/glenvex' },
                      ].map(({ label, field, placeholder }) => (
                        <div key={field}>
                          <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{label}</label>
                          <input type="text" value={(settings[field] as string) || ''}
                            onChange={e => update(field, e.target.value as Settings[typeof field])}
                            placeholder={placeholder}
                            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Høyre kolonne */}
                <div className="space-y-5">
                  <div className="bg-g-card border border-g-border rounded-xl p-5">
                    <h2 className="text-[10px] text-g-muted font-bold tracking-widest uppercase mb-4">Sosiale Medier</h2>
                    <div className="space-y-3">
                      {(['tiktok', 'instagram', 'twitter', 'youtube', 'discord'] as const).map(platform => (
                        <div key={platform}>
                          <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{platform}</label>
                          <input type="text" value={settings.socials?.[platform] || ''}
                            onChange={e => updateSocial(platform, e.target.value)}
                            placeholder={`https://${platform}.com/glenvex`}
                            className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tips-widget */}
                  <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-3">
                    <p className="text-[10px] font-bold text-g-text uppercase tracking-widest">Hvor finner jeg IDer?</p>
                    {[
                      { label: 'Discord Kanal-ID', tip: 'Discord → Høyreklikk kanal → Kopier kanal-ID (developer mode på)' },
                      { label: 'Discord Rolle-ID', tip: 'Discord → Serverinnstillinger → Roller → Høyreklikk rolle' },
                      { label: 'Twitch Credentials', tip: 'dev.twitch.tv → Your Console → Applications' },
                    ].map(t => (
                      <div key={t.label} className="border-b border-g-border/30 pb-2 last:border-0 last:pb-0">
                        <p className="text-[9px] font-bold text-g-muted uppercase">{t.label}</p>
                        <p className="text-[9px] text-g-muted/70 mt-0.5 leading-relaxed">{t.tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5">
                {[1, 2].map(i => <div key={i} className="h-64 bg-g-card border border-g-border rounded-xl animate-pulse" />)}
              </div>
            )}
          </div>
        )}

        {/* ── SYSTEMSTATUS ─────────────────────────────────────────────────── */}
        {aktivFane === 'system' && (
          <div className="space-y-5">
            <HelsePanel />

            <div className="grid grid-cols-2 gap-5 items-start">
              <DebugPanel />

              {/* Systemsider + tips */}
              <div className="space-y-3">
                <div className="bg-g-card border border-g-border rounded-xl p-5">
                  <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-3">Systemsider</p>
                  <div className="space-y-1">
                    {[
                      { label: 'Logging',           href: '/logs',                        desc: 'Alle bot-logger og feilmeldinger' },
                      { label: 'Systemhelse (full)', href: '/system-health',              desc: 'Detaljert helsesjekk' },
                      { label: 'QA-oversikt',        href: '/content-factory-admin/qa',   desc: 'Content factory kvalitetskontroll' },
                      { label: 'Setup Wizard',        href: '/setup-wizard',              desc: 'Oppsett av workspace' },
                    ].map(l => (
                      <Link key={l.href} href={l.href}
                        className="flex items-center justify-between py-2 border-b border-g-border/30 last:border-0 group">
                        <div>
                          <p className="text-xs text-g-text group-hover:text-g-green transition-colors">{l.label}</p>
                          <p className="text-[9px] text-g-muted">{l.desc}</p>
                        </div>
                        <span className="text-g-muted group-hover:text-g-green transition-colors text-xs">↗</span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[10px] font-bold text-g-text mb-2">API-snarveier</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'Status', href: '/api/status' },
                      { label: 'Dashboard', href: '/api/dashboard' },
                      { label: 'CF Health', href: '/api/content-factory/health' },
                      { label: 'Bot Activity', href: '/api/bot-activity' },
                      { label: 'Bot Health', href: '/api/bot-health' },
                      { label: 'System Events', href: '/api/system-events?limit=20' },
                    ].map(l => (
                      <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                        className="px-2 py-1 border border-g-border rounded text-[9px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all font-mono">
                        {l.label} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── KONTO ────────────────────────────────────────────────────────── */}
        {aktivFane === 'konto' && (
          <div className="grid grid-cols-2 gap-5 items-start">
            <PassordPanel />

            <div className="space-y-3">
              <div className="bg-g-card border border-g-border rounded-xl p-5">
                <p className="text-[10px] font-bold text-g-text mb-3">Tilgang og sikkerhet</p>
                <div className="space-y-3">
                  {[
                    { tittel: 'Passord-basert innlogging', tekst: 'Sett et passord for raskere innlogging. Magic link (e-post) er alltid tilgjengelig som backup.' },
                    { tittel: 'Én bruker per workspace', tekst: 'GLENVEX Creator OS er bygget for én administrator. Kontakt support for flerbruker-oppsett.' },
                    { tittel: 'Supabase-autentisering', tekst: 'Innlogging håndteres av Supabase Auth. Sessions er kryptert og utløper automatisk.' },
                  ].map(t => (
                    <div key={t.tittel} className="border-b border-g-border/30 pb-3 last:border-0 last:pb-0">
                      <p className="text-[10px] font-bold text-g-text">{t.tittel}</p>
                      <p className="text-[9px] text-g-muted mt-1 leading-relaxed">{t.tekst}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-[10px] font-bold text-g-text mb-2">Logg ut</p>
                <p className="text-[9px] text-g-muted mb-3">Avslutter gjeldende session og sletter auth-cookie.</p>
                <a href="/api/auth/logout"
                  className="inline-block px-4 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded transition-all">
                  Logg ut
                </a>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
