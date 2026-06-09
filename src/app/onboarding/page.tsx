'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 1 | 2 | 3;

interface FormData {
  // Step 1 — Workspace
  workspaceSlug: string;
  brandName: string;
  // Step 2 — Twitch
  twitchUsername: string;
  twitchClientId: string;
  twitchClientSecret: string;
  // Step 3 — Discord
  discordBotToken: string;
  discordGuildId: string;
  discordInviteUrl: string;
  discordLiveChannelId: string;
  discordChatChannelId: string;
}

const INIT: FormData = {
  workspaceSlug: '', brandName: '',
  twitchUsername: '', twitchClientId: '', twitchClientSecret: '',
  discordBotToken: '', discordGuildId: '', discordInviteUrl: '',
  discordLiveChannelId: '', discordChatChannelId: '',
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

function Field({ label, value, onChange, type = 'text', placeholder, hint, mono = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder-g-muted/40 focus:outline-none focus:border-g-green/50 transition-colors ${mono ? 'font-mono text-xs' : ''}`}
      />
      {hint && <p className="text-[10px] text-g-muted/70">{hint}</p>}
    </div>
  );
}

function StepHeader({ step, total, title, sub }: { step: Step; total: number; title: string; sub: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < step ? 'bg-g-green' : 'bg-g-border'}`} />
        ))}
      </div>
      <div>
        <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg {step} av {total}</p>
        <h2 className="text-base font-black text-g-text mt-0.5">{title}</h2>
        <p className="text-xs text-g-muted mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(INIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(field: keyof FormData) {
    return (val: string) => setForm(f => ({ ...f, [field]: val }));
  }

  function canNext(): boolean {
    if (step === 1) return form.workspaceSlug.length >= 2 && form.brandName.length >= 2;
    if (step === 2) return form.twitchUsername.length >= 1 && form.twitchClientId.length >= 10 && form.twitchClientSecret.length >= 10;
    if (step === 3) return form.discordBotToken.length >= 20 && form.discordGuildId.length >= 15;
    return false;
  }

  async function finish() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Noe gikk galt');
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">

        {/* Logo */}
        <div className="text-center">
          <div className="text-g-green font-black text-xl tracking-[0.15em] uppercase"
            style={{ textShadow: '0 0 20px rgba(0,255,65,0.4)' }}>
            GLENVEX
          </div>
          <p className="text-[9px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS · Oppsett</p>
        </div>

        <div className="bg-g-card border border-g-border rounded-xl p-6 space-y-6">

          {/* ── Step 1: Workspace ── */}
          {step === 1 && (
            <>
              <StepHeader step={1} total={3} title="Din merkevare" sub="Hva heter du og kanalen din?" />
              <div className="space-y-4">
                <Field label="Twitch-kanalnavn / Merkevarenavn" value={form.brandName}
                  onChange={v => { set('brandName')(v); set('workspaceSlug')(slugify(v)); }}
                  placeholder="f.eks. NordicGamer" />
                <Field label="Workspace ID (slug)" value={form.workspaceSlug}
                  onChange={v => set('workspaceSlug')(slugify(v))}
                  placeholder="nordicgamer" mono
                  hint="Kun små bokstaver og bindestrek. Dette er din unike ID i systemet." />
              </div>
            </>
          )}

          {/* ── Step 2: Twitch ── */}
          {step === 2 && (
            <>
              <StepHeader step={2} total={3} title="Twitch-tilkobling" sub="Koble til din Twitch-kanal" />
              <div className="space-y-4">
                <div className="bg-g-bg/60 border border-g-border/50 rounded-lg p-3 text-[11px] text-g-muted space-y-1">
                  <p className="text-g-text font-bold text-xs">Slik får du Twitch-nøklene:</p>
                  <p>1. Gå til <span className="text-g-green font-mono">dev.twitch.tv/console</span></p>
                  <p>2. Registrer ny applikasjon</p>
                  <p>3. OAuth Redirect URL: <span className="font-mono text-g-text">http://localhost</span></p>
                  <p>4. Kategori: Broadcasting → Kopier Client ID og generer Secret</p>
                </div>
                <Field label="Twitch-brukernavn" value={form.twitchUsername}
                  onChange={set('twitchUsername')} placeholder="nordicgamer" />
                <Field label="Client ID" value={form.twitchClientId}
                  onChange={set('twitchClientId')} placeholder="abc123..." mono />
                <Field label="Client Secret" value={form.twitchClientSecret}
                  onChange={set('twitchClientSecret')} type="password" placeholder="••••••••••••••••" mono />
              </div>
            </>
          )}

          {/* ── Step 3: Discord ── */}
          {step === 3 && (
            <>
              <StepHeader step={3} total={3} title="Discord-tilkobling" sub="Koble boten til Discord-serveren din" />
              <div className="space-y-4">
                <div className="bg-g-bg/60 border border-g-border/50 rounded-lg p-3 text-[11px] text-g-muted space-y-1">
                  <p className="text-g-text font-bold text-xs">Slik setter du opp Discord-boten:</p>
                  <p>1. Gå til <span className="text-g-green font-mono">discord.com/developers/applications</span></p>
                  <p>2. New Application → Bot → Add Bot → Kopier Bot Token</p>
                  <p>3. Aktiver: Server Members Intent + Message Content Intent</p>
                  <p>4. OAuth2 → Scopes: bot + applications.commands → Permissions: Administrator</p>
                  <p>5. Inviter boten til serveren din</p>
                  <p>6. Høyreklikk server → Kopier Server ID (= Guild ID)</p>
                </div>
                <Field label="Bot Token" value={form.discordBotToken}
                  onChange={set('discordBotToken')} type="password" placeholder="••••••••••••••••" mono />
                <Field label="Guild ID (Server ID)" value={form.discordGuildId}
                  onChange={set('discordGuildId')} placeholder="1234567890123456789" mono />
                <Field label="Invitasjonslenke til serveren" value={form.discordInviteUrl}
                  onChange={set('discordInviteUrl')} placeholder="https://discord.gg/..." />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Live-varslingskanal ID" value={form.discordLiveChannelId}
                    onChange={set('discordLiveChannelId')} placeholder="1234..." mono />
                  <Field label="Chat-kanal ID" value={form.discordChatChannelId}
                    onChange={set('discordChatChannelId')} placeholder="1234..." mono />
                </div>
                <p className="text-[10px] text-g-muted">Høyreklikk på en kanal i Discord → Kopier kanal-ID for å finne ID-ene</p>

                {error && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}
              </div>
            </>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(s => (s - 1) as Step)}
                className="flex-1 py-2.5 border border-g-border rounded-lg text-sm text-g-muted hover:text-g-text hover:border-g-border/80 transition-all">
                ← Tilbake
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(s => (s + 1) as Step)}
                disabled={!canNext()}
                className="flex-1 bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 hover:border-g-green/50 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                Neste →
              </button>
            ) : (
              <button
                onClick={finish}
                disabled={loading || !canNext()}
                className="flex-1 bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 hover:border-g-green/50 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Setter opp workspace...' : '→ Åpne dashbordet mitt'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
