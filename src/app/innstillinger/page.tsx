'use client';

import { useEffect, useState } from 'react';
import type { Settings } from '@/types';

export default function Innstillinger() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {});
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
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
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : null);
  }

  function updateSocial(platform: string, value: string) {
    setSettings(prev =>
      prev ? { ...prev, socials: { ...prev.socials, [platform]: value } } : null
    );
  }

  function Toggle({ label, field }: { label: string; field: keyof Settings }) {
    const checked = settings?.[field] as boolean ?? false;
    return (
      <div className="flex items-center justify-between py-3 border-b border-g-border/50">
        <span className="text-sm text-g-text">{label}</span>
        <button
          onClick={() => update(field, !checked as Settings[typeof field])}
          className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
            checked ? 'bg-g-green/70' : 'bg-g-bg border border-g-border'
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
            checked ? 'left-5 bg-g-bg' : 'left-0.5 bg-g-muted'
          }`} />
        </button>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Innstillinger</h1>
        <p className="text-xs text-g-muted mt-0.5">Systemkonfigurasjon for GLENVEX Stream Control</p>
      </div>

      {/* Discord */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Discord</h2>
        <div className="space-y-3">
          {[
            { label: 'Live Kanal ID', field: 'discordLiveChannelId' as keyof Settings, placeholder: '123456789012345678' },
            { label: 'Varsel Rolle ID', field: 'discordLiveRoleId' as keyof Settings, placeholder: '123456789012345678' },
          ].map(({ label, field, placeholder }) => (
            <div key={field}>
              <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{label}</label>
              <input
                type="text"
                value={(settings[field] as string) || ''}
                onChange={e => update(field, e.target.value as Settings[typeof field])}
                placeholder={placeholder}
                className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40 transition-colors"
              />
            </div>
          ))}
          <Toggle label="Auto Post Live" field="autoPostLive" />
          <Toggle label="Auto Post Promo" field="autoPostPromo" />
          <Toggle label="Ping Rolle ved Live" field="pingRole" />
        </div>
      </div>

      {/* Twitch */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Twitch</h2>
        <div className="space-y-3">
          {[
            { label: 'Twitch Brukernavn', field: 'twitchUsername' as keyof Settings, placeholder: 'glenvex' },
            { label: 'Twitch URL', field: 'twitchUrl' as keyof Settings, placeholder: 'https://twitch.tv/glenvex' },
          ].map(({ label, field, placeholder }) => (
            <div key={field}>
              <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{label}</label>
              <input
                type="text"
                value={(settings[field] as string) || ''}
                onChange={e => update(field, e.target.value as Settings[typeof field])}
                placeholder={placeholder}
                className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40 transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Socials */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Sosiale Medier</h2>
        <div className="space-y-3">
          {(['tiktok', 'instagram', 'twitter', 'youtube', 'discord'] as const).map(platform => (
            <div key={platform}>
              <label className="text-[10px] text-g-muted tracking-widest uppercase block mb-1">{platform}</label>
              <input
                type="text"
                value={settings.socials?.[platform] || ''}
                onChange={e => updateSocial(platform, e.target.value)}
                placeholder={`https://${platform}.com/glenvex`}
                className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono placeholder-g-muted/50 focus:outline-none focus:border-g-green/40 transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all"
        >
          {saving ? 'Lagrer...' : saved ? '✓ Lagret!' : 'Lagre Innstillinger'}
        </button>
        {error && <span className="text-xs text-red-400">✗ {error}</span>}
      </div>
    </div>
  );
}
