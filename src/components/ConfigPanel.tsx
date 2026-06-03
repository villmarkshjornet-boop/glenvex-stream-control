'use client';

import { useState, useEffect } from 'react';
import type { Settings } from '@/types';

interface Props {
  settings?: Settings | null;
  onSave?: (settings: Settings) => void;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-g-text">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-all duration-200 ${
          checked ? 'bg-g-green/80' : 'bg-g-bg border border-g-border'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
            checked ? 'left-4 bg-g-bg' : 'left-0.5 bg-g-muted'
          }`}
          style={checked ? { boxShadow: '0 0 6px #00ff41' } : {}}
        />
      </button>
    </div>
  );
}

export default function ConfigPanel({ settings: initialSettings, onSave }: Props) {
  const [settings, setSettings] = useState<Partial<Settings>>(initialSettings || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (initialSettings) setSettings(initialSettings);
  }, [initialSettings]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const updated = await res.json();
      setSettings(updated);
      onSave?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    }
    setSaving(false);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="bg-g-card border border-g-border rounded-lg p-5">
      <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
        Konfigurasjon
      </h2>

      <div className="space-y-3">
        {/* Live Channel */}
        <div>
          <label className="text-[10px] text-g-muted block mb-1 tracking-wider uppercase">
            Live Kanal ID
          </label>
          <input
            type="text"
            value={settings.discordLiveChannelId || ''}
            onChange={(e) => update('discordLiveChannelId', e.target.value)}
            placeholder="Channel ID..."
            className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text placeholder-g-muted focus:outline-none focus:border-g-green/40 transition-colors font-mono"
          />
        </div>

        {/* Role */}
        <div>
          <label className="text-[10px] text-g-muted block mb-1 tracking-wider uppercase">
            Varsel Rolle ID
          </label>
          <input
            type="text"
            value={settings.discordLiveRoleId || ''}
            onChange={(e) => update('discordLiveRoleId', e.target.value)}
            placeholder="Role ID..."
            className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text placeholder-g-muted focus:outline-none focus:border-g-green/40 transition-colors font-mono"
          />
        </div>

        {/* Divider */}
        <div className="border-t border-g-border pt-2">
          <Toggle
            label="Auto Post Live"
            checked={settings.autoPostLive ?? true}
            onChange={(v) => update('autoPostLive', v)}
          />
          <Toggle
            label="Auto Post Promo"
            checked={settings.autoPostPromo ?? false}
            onChange={(v) => update('autoPostPromo', v)}
          />
          <Toggle
            label="Ping Rolle"
            checked={settings.pingRole ?? true}
            onChange={(v) => update('pingRole', v)}
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`mt-4 w-full py-2 rounded text-xs font-bold tracking-widest uppercase transition-all ${
          saved
            ? 'bg-g-green/20 border border-g-green/40 text-g-green'
            : 'bg-g-green/10 border border-g-green/20 text-g-green hover:bg-g-green/20 hover:border-g-green/40'
        }`}
        style={{ textShadow: '0 0 8px rgba(0,255,65,0.4)' }}
      >
        {saving ? '...' : saved ? '✓ Lagret' : 'Lagre Endringer'}
      </button>
    </div>
  );
}
