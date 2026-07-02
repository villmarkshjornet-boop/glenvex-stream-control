'use client';

import { useEffect, useState, useCallback } from 'react';
import type { PartnerBotSettings } from '@/app/api/partner-bot/settings/route';
import { PageHeader, Toggle as UIToggle, SectionLabel, Spinner, EmptyState } from '@/components/ui';

interface Proposal {
  id: string;
  partner_name: string;
  platform: string;
  trigger_type: string;
  message_twitch: string | null;
  message_discord: string | null;
  affiliate_url: string | null;
  discount_code: string | null;
  confidence: number;
  expires_at: string;
  created_at: string;
}

const DEFAULT: PartnerBotSettings = {
  enabled: true,
  twitchEnabled: true,
  discordEnabled: true,
  pollsEnabled: false,
  affiliateDisclosure: '',
  maxPostsPerStream: 3,
  cooldownMinutes: 45,
  pollCooldownMinutes: 120,
  viewerPeakMultiplier: 1.5,
  chatSilenceMinutes: 8,
  allowBothChannels: false,
  requireApproval: true,
  tone: 'natural',
};

function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <UIToggle value={value} onChange={onChange} />
      <div>
        <div className="text-xs font-semibold text-g-text">{label}</div>
        {hint && <div className="text-xs text-g-muted mt-0.5 leading-snug">{hint}</div>}
      </div>
    </label>
  );
}

function NumberInput({ value, onChange, label, hint, min, max, step }: { value: number; onChange: (v: number) => void; label: string; hint?: string; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <label className="block text-sm text-g-text font-medium mb-1">{label}</label>
      {hint && <div className="text-xs text-g-muted mb-2">{hint}</div>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-32 px-3 py-1.5 bg-g-bg border border-g-border rounded-2xl text-xs text-g-text focus:outline-none focus:border-g-green/50"
      />
    </div>
  );
}

export default function PartnerBotSettingsPage() {
  const [settings, setSettings] = useState<PartnerBotSettings>(DEFAULT);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; field: 'twitch' | 'discord'; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/partner-bot/settings'),
        fetch('/api/partner-bot/proposals?status=pending'),
      ]);
      if (sRes.ok) {
        const { settings: s } = await sRes.json();
        setSettings(s);
      }
      if (pRes.ok) {
        const { proposals: p } = await pRes.json();
        setProposals(p ?? []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/partner-bot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Lagring feilet');
    }
    setSaving(false);
  };

  const handleProposal = async (id: string, action: 'approve' | 'reject', extra?: { messageTwitch?: string; messageDiscord?: string }) => {
    const res = await fetch(`/api/partner-bot/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    if (res.ok) {
      setProposals(prev => prev.filter(p => p.id !== id));
    }
  };

  const set = <K extends keyof PartnerBotSettings>(key: K, value: PartnerBotSettings[K]) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Partner Sales Bot" subtitle="Kontekstsensitiv, anti-spam partner-promotering for Twitch og Discord." />

      {/* ── Global kill switch ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Status</p>
        <Toggle
          value={settings.enabled}
          onChange={v => set('enabled', v)}
          label="Partner Bot aktivert"
          hint="Master-bryter. Skrur av all automatisk partner-promotering."
        />
      </section>

      {/* ── Platform ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl space-y-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Plattformer</p>
        <Toggle value={settings.twitchEnabled} onChange={v => set('twitchEnabled', v)} label="Twitch chat-promo" />
        <Toggle value={settings.discordEnabled} onChange={v => set('discordEnabled', v)} label="Discord-promo" />
        <Toggle
          value={settings.allowBothChannels}
          onChange={v => set('allowBothChannels', v)}
          label="Post til begge plattformer simultant"
          hint="Sender til Twitch og Discord i samme runde. Krever begge aktivert."
        />
        <Toggle value={settings.pollsEnabled} onChange={v => set('pollsEnabled', v)} label="Publikumsavstemninger" hint="Slå på for å lære hva seerne foretrekker." />
      </section>

      {/* ── Approval ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Godkjenning</p>
        <Toggle
          value={settings.requireApproval}
          onChange={v => set('requireApproval', v)}
          label="Krev manuell godkjenning (anbefalt)"
          hint="Bot lagrer forslag nedenfor. Du godkjenner eller avviser før sending."
        />
      </section>

      {/* ── Cooldowns ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl space-y-5">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Cooldowns og grenser</p>
        <div className="grid grid-cols-2 gap-5">
          <NumberInput value={settings.maxPostsPerStream} onChange={v => set('maxPostsPerStream', v)} label="Maks promoer per stream" min={1} max={10} />
          <NumberInput value={settings.cooldownMinutes} onChange={v => set('cooldownMinutes', v)} label="Cooldown (minutter)" hint="Min tid mellom promoer" min={5} max={240} />
          <NumberInput value={settings.chatSilenceMinutes} onChange={v => set('chatSilenceMinutes', v)} label="Chat-stillhet trigger (min)" hint="Promo etter N stille minutter" min={2} max={30} />
          <NumberInput value={settings.viewerPeakMultiplier} onChange={v => set('viewerPeakMultiplier', v)} label="Viewer-peak multiplier" hint="Trigger ved X × snittseere" min={1.0} max={5.0} step={0.1} />
          <NumberInput value={settings.pollCooldownMinutes} onChange={v => set('pollCooldownMinutes', v)} label="Poll cooldown (min)" hint="Min tid mellom avstemninger" min={30} max={480} />
        </div>
      </section>

      {/* ── Message settings ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl space-y-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">Meldingsinnstillinger</p>
        <div>
          <label className="block text-sm font-medium text-g-text mb-1">Tone</label>
          <select
            value={settings.tone}
            onChange={e => set('tone', e.target.value as PartnerBotSettings['tone'])}
            className="w-48 px-3 py-1.5 bg-g-card border border-g-border rounded text-sm text-g-text focus:outline-none focus:border-g-green"
          >
            <option value="natural">Natural (anbefalt)</option>
            <option value="energetic">Energisk</option>
            <option value="minimal">Minimal</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-g-text mb-1">Affiliate-tekst</label>
          <div className="text-xs text-g-muted mb-2">Legges til meldingen, f.eks. «#ad» eller «(sponset)»</div>
          <input
            type="text"
            value={settings.affiliateDisclosure}
            onChange={e => set('affiliateDisclosure', e.target.value)}
            placeholder="#ad"
            maxLength={30}
            className="w-48 px-3 py-1.5 bg-g-card border border-g-border rounded text-sm text-g-text focus:outline-none focus:border-g-green"
          />
        </div>
      </section>

      {/* ── Save button ── */}
      <div className="flex items-center gap-4 mb-12">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200 disabled:opacity-50"
        >
          {saving ? 'Lagrer…' : saved ? '✓ Lagret' : 'Lagre innstillinger'}
        </button>
        {error && <span className="text-red-400 text-sm">{error}</span>}
      </div>

      {/* ── Pending proposals ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-g-text">Ventende forslag</h2>
          <button onClick={load} className="text-xs text-g-muted hover:text-g-text transition-colors">↻ Oppdater</button>
        </div>

        {proposals.length === 0 ? (
          <div className="p-5 bg-g-card border border-g-border rounded-2xl text-center text-g-muted text-sm">
            Ingen ventende forslag. Boten legger forslag her når den finner gode tidspunkter.
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map(p => {
              const expiresIn = Math.max(0, Math.round((new Date(p.expires_at).getTime() - Date.now()) / 60_000));
              return (
                <div key={p.id} className="p-4 bg-g-card border border-g-border rounded-2xl">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="font-semibold text-g-text">{p.partner_name}</div>
                      <div className="text-xs text-g-muted mt-0.5">
                        {p.platform} · trigger: {p.trigger_type} · score: {(p.confidence * 100).toFixed(0)}% · utløper om {expiresIn}min
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleProposal(p.id, 'approve', {
                          messageTwitch: editingMsg?.id === p.id && editingMsg.field === 'twitch' ? editingMsg.value : p.message_twitch ?? undefined,
                          messageDiscord: editingMsg?.id === p.id && editingMsg.field === 'discord' ? editingMsg.value : p.message_discord ?? undefined,
                        })}
                        className="px-3 py-1 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 transition-all duration-200"
                      >
                        Godkjenn
                      </button>
                      <button
                        onClick={() => handleProposal(p.id, 'reject')}
                        className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg hover:bg-red-500/15 transition-all duration-200"
                      >
                        Avvis
                      </button>
                    </div>
                  </div>

                  {p.message_twitch && (
                    <div className="mb-2">
                      <div className="text-xs text-g-muted mb-1">Twitch</div>
                      {editingMsg?.id === p.id && editingMsg.field === 'twitch' ? (
                        <textarea
                          className="w-full px-2 py-1.5 bg-g-bg border border-g-green rounded text-xs text-g-text resize-none"
                          rows={2}
                          value={editingMsg.value}
                          onChange={e => setEditingMsg({ ...editingMsg, value: e.target.value })}
                          onBlur={() => setEditingMsg(null)}
                        />
                      ) : (
                        <div
                          className="text-xs text-g-text bg-g-bg px-2 py-1.5 rounded border border-g-border cursor-text hover:border-g-green/50 transition-colors"
                          onClick={() => setEditingMsg({ id: p.id, field: 'twitch', value: p.message_twitch! })}
                        >
                          {p.message_twitch}
                        </div>
                      )}
                    </div>
                  )}

                  {p.message_discord && (
                    <div>
                      <div className="text-xs text-g-muted mb-1">Discord</div>
                      {editingMsg?.id === p.id && editingMsg.field === 'discord' ? (
                        <textarea
                          className="w-full px-2 py-1.5 bg-g-bg border border-g-green rounded text-xs text-g-text resize-none"
                          rows={2}
                          value={editingMsg.value}
                          onChange={e => setEditingMsg({ ...editingMsg, value: e.target.value })}
                          onBlur={() => setEditingMsg(null)}
                        />
                      ) : (
                        <div
                          className="text-xs text-g-text bg-g-bg px-2 py-1.5 rounded border border-g-border cursor-text hover:border-g-green/50 transition-colors"
                          onClick={() => setEditingMsg({ id: p.id, field: 'discord', value: p.message_discord! })}
                        >
                          {p.message_discord}
                        </div>
                      )}
                    </div>
                  )}

                  {p.affiliate_url && (
                    <div className="mt-2 text-xs text-g-muted">
                      URL: <span className="text-g-green">{p.affiliate_url}</span>
                      {p.discount_code && <span className="ml-2">Kode: {p.discount_code}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
