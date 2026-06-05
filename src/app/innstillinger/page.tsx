'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Settings } from '@/types';

interface HealthItem { ok: boolean; melding: string; }

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

// ─── Automatiseringer ─────────────────────────────────────────────────────────

function AutomatiseringerPanel() {
  const [botSettings, setBotSettings] = useState<any>(null);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.json()).then(setBotSettings).catch(() => {});
  }, []);

  async function toggleFlag(felt: string, verdi: boolean) {
    await fetch('/api/bot-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [felt]: verdi }),
    });
    setBotSettings((prev: any) => prev ? { ...prev, [felt]: verdi } : prev);
  }

  const flagg = botSettings ? [
    { label: 'Discord-bot aktiv', felt: 'discordPause', aktivtNårFalse: true },
    { label: 'Auto live-varsler', felt: 'pauseLiveVarsler', aktivtNårFalse: true },
    { label: 'Auto partner-promo', felt: 'pausePartnerPromo', aktivtNårFalse: true },
    { label: 'AI proaktive meldinger', felt: 'pauseProaktiv', aktivtNårFalse: true },
  ] : [];

  return (
    <div id="automatiseringer" className="bg-g-card border border-g-border rounded-xl p-5">
      <h2 className="text-xs font-bold text-g-text mb-1">Automatiseringer</h2>
      <p className="text-[9px] text-g-muted mb-4">Skru av/på bot-handlinger</p>

      {!botSettings ? (
        <p className="text-xs text-g-muted">Laster...</p>
      ) : (
        <div className="space-y-3">
          {flagg.map(f => {
            const aktiv = f.aktivtNårFalse ? !botSettings[f.felt] : !!botSettings[f.felt];
            return (
              <div key={f.felt} className="flex items-center justify-between py-2 border-b border-g-border/40 last:border-0">
                <span className="text-xs text-g-text">{f.label}</span>
                <button
                  onClick={() => {
                    const nyVerdi = f.aktivtNårFalse ? aktiv : !aktiv;
                    toggleFlag(f.felt, nyVerdi);
                  }}
                  className={`relative w-10 h-5 rounded-full transition-all duration-200 ${aktiv ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${aktiv ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Innstillinger-siden ───────────────────────────────────────────────────────

export default function InnstillingerSide() {
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
  function Toggle({ label, field }: { label: string; field: keyof Settings }) {
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
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Innstillinger</h1>
        <p className="text-[9px] text-g-muted mt-0.5">Konfigurasjon, system health, automatiseringer og debug</p>
      </div>

      {/* Snarvei-lenker */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'Integrasjoner', href: '#helse' },
          { label: 'Systemstatus', href: '#helse' },
          { label: 'Automatiseringer', href: '#automatiseringer' },
          { label: 'Debug', href: '#debug' },
          { label: 'Logging', href: '/logs' },
          { label: 'QA', href: '/content-factory-admin/qa' },
        ].map(l => (
          <a key={l.label + l.href} href={l.href}
            className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            {l.label}
          </a>
        ))}
      </div>

      {/* Integrasjons-helse */}
      <HelsePanel />

      {/* Automatiseringer */}
      <AutomatiseringerPanel />

      {/* Integrasjonsinnstillinger */}
      {settings ? (
        <>
          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Discord</h2>
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
              <Toggle label="Auto Post Live" field="autoPostLive" />
              <Toggle label="Auto Post Promo" field="autoPostPromo" />
              <Toggle label="Ping Rolle ved Live" field="pingRole" />
            </div>
          </div>

          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Twitch</h2>
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

          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Sosiale Medier</h2>
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

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving}
              className="px-6 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
              {saving ? 'Lagrer...' : saved ? '✓ Lagret!' : 'Lagre innstillinger'}
            </button>
            {error && <span className="text-xs text-red-400">✗ {error}</span>}
          </div>
        </>
      ) : (
        <div className="h-48 bg-g-card border border-g-border rounded-xl animate-pulse" />
      )}

      {/* Debug */}
      <DebugPanel />

      {/* Navigasjonslenker */}
      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Andre systemsider</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/logs" className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">Logging</Link>
          <Link href="/system-health" className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">Systemhelse (full)</Link>
          <Link href="/content-factory-admin/qa" className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">QA</Link>
          <Link href="/setup-wizard" className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">Setup Wizard</Link>
        </div>
      </div>
    </div>
  );
}
