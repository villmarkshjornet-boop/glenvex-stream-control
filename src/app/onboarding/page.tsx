'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BrandLogo } from '@/components/ui';

interface OboardingStatus {
  workspaceId: string | null;
  brandName: string | null;
  twitchConnected: boolean;
  twitchLogin: string | null;
  twitchDisplayName: string | null;
  twitchProfileImage: string | null;
  discordConnected: boolean;
  guildId: string | null;
  guildName: string | null;
  channelsSaved: boolean;
  onboardingComplete: boolean;
  alphaEnabled: boolean;
  currentStep: number;
}

interface DiscordChannel { id: string; navn: string; kategori: string }

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

const STEPS = [
  { n: 1, label: 'Velkommen' },
  { n: 2, label: 'Twitch' },
  { n: 3, label: 'Discord' },
  { n: 4, label: 'Kanaler' },
  { n: 5, label: 'Aktiver' },
];

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 w-full">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 transition-all ${
            step > s.n  ? 'bg-g-green text-g-bg' :
            step === s.n ? 'bg-g-green/20 border border-g-green text-g-green' :
            'bg-g-bg border border-g-border text-g-muted'
          }`}>
            {step > s.n ? '✓' : s.n}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 flex-1 rounded-full transition-all ${step > s.n ? 'bg-g-green' : 'bg-g-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ConnectButton({ href, icon, label, connected, connectedLabel, disabled = false }: {
  href: string; icon: string; label: string; connected: boolean; connectedLabel: string; disabled?: boolean;
}) {
  if (connected) {
    return (
      <div className="flex items-center gap-3 p-4 bg-g-green/5 border border-g-green/20 rounded-xl">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm font-bold text-g-green">✓ {connectedLabel}</p>
          <p className="text-[9px] text-g-muted">Tilkoblet</p>
        </div>
      </div>
    );
  }
  return (
    <a href={disabled ? undefined : href}
      className={`flex items-center gap-3 p-4 border rounded-xl transition-all ${
        disabled
          ? 'border-g-border/30 opacity-40 cursor-not-allowed'
          : 'border-g-border hover:border-g-green/30 hover:bg-g-green/5 cursor-pointer'
      }`}>
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-g-text">{label}</p>
        <p className="text-[9px] text-g-muted">Klikk for å koble til</p>
      </div>
      <span className="text-g-muted text-xs">→</span>
    </a>
  );
}

const OAUTH_ERRORS: Record<string, { heading: string; detail: string }> = {
  twitch_cancelled:         { heading: 'Twitch-tilkobling avbrutt', detail: 'Du avbrøt tilkoblingen. Klikk "Koble til Twitch" og prøv igjen.' },
  twitch_state_mismatch:    { heading: 'Twitch-tilkobling utløp', detail: 'Tilkoblingen tok for lang tid eller ble avbrutt. Prøv igjen.' },
  twitch_token_failed:      { heading: 'Klarte ikke koble til Twitch', detail: 'Twitch returnerte ingen tilgangsnøkkel. Prøv igjen, eller kontakt support.' },
  twitch_userinfo_failed:   { heading: 'Klarte ikke hente Twitch-profil', detail: 'Prøv å koble til på nytt.' },
  twitch_db_failed:         { heading: 'Lagringsfeil (Twitch)', detail: 'Tilkoblingen ble godkjent, men vi klarte ikke lagre den. Prøv igjen.' },
  discord_cancelled:        { heading: 'Discord-tilkobling avbrutt', detail: 'Du avbrøt invitasjonen av boten. Klikk "Legg til Discord-bot" og prøv igjen.' },
  discord_state_mismatch:   { heading: 'Discord-tilkobling utløp', detail: 'Tilkoblingen tok for lang tid. Prøv igjen.' },
  discord_config_missing:   { heading: 'Mangler Discord-konfigurasjon', detail: 'Noe er galt på serversiden. Kontakt support.' },
  discord_token_failed:     { heading: 'Klarte ikke koble til Discord', detail: 'Discord returnerte ingen tilgangsnøkkel. Prøv å invitere boten på nytt.' },
  discord_db_failed:        { heading: 'Lagringsfeil (Discord)', detail: 'Boten ble lagt til, men vi klarte ikke lagre det. Prøv igjen.' },
  server_config:            { heading: 'Konfigurasjonsfeil på server', detail: 'Noe er galt i GLENVEX-oppsettet. Kontakt support.' },
};

function OnboardingInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [step,      setStep]      = useState(1);
  const [status,    setStatus]    = useState<OboardingStatus | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<{ heading: string; detail: string } | null>(null);

  // Step 1 state
  const [brandName,  setBrandName]  = useState('');
  const [wsSlug,     setWsSlug]     = useState('');
  const [step1Saved, setStep1Saved] = useState(false);

  // Step 4 state
  const [channels,  setChannels]  = useState<DiscordChannel[]>([]);
  const [prefs,     setPrefs]     = useState<Record<string, string>>({});
  const [savingCh,  setSavingCh]  = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/onboarding/status').catch(() => null);
    if (!res?.ok) return;
    const d: OboardingStatus = await res.json();
    setStatus(d);
    if (d.brandName) setBrandName(d.brandName);
    if (d.workspaceId) { setWsSlug(d.workspaceId); setStep1Saved(true); }
    return d;
  }, []);

  useEffect(() => {
    loadStatus().then(d => {
      if (!d) return;
      // URL param overrides DB step (for post-OAuth redirects)
      const urlStep = parseInt(searchParams.get('step') ?? '0', 10);
      const urlError = searchParams.get('error');
      if (urlError) {
        setError(OAUTH_ERRORS[urlError] ?? { heading: 'Tilkoblingsfeil', detail: `Noe gikk galt (kode: ${urlError}). Prøv igjen, eller kontakt support.` });
      }
      setStep(urlStep > 1 ? urlStep : d.currentStep);
    });
  }, [loadStatus, searchParams]);

  // Step 4 channel loading state
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsLoaded,  setChannelsLoaded]  = useState(false);

  const loadChannels = useCallback(async () => {
    if (!status?.discordConnected) return;
    setChannelsLoading(true);
    try {
      const r = await fetch('/api/channel-settings');
      const d = await r.json();
      setChannels(d.kanaler ?? []);
      setPrefs(d.preferanser ?? {});
    } catch {}
    setChannelsLoading(false);
    setChannelsLoaded(true);
  }, [status?.discordConnected]);

  // Load Discord channels when on step 4
  useEffect(() => {
    if (step !== 4) return;
    loadChannels();
  }, [step, loadChannels]);

  async function saveWorkspace() {
    if (!brandName || !wsSlug) return;
    setLoading(true); setError(null);
    const res = await fetch('/api/onboarding/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName, workspaceSlug: wsSlug }),
    });
    const d = await res.json();
    setLoading(false);
    if (!res.ok) { setError({ heading: 'Feil ved opprettelse', detail: d.error ?? 'Prøv igjen.' }); return; }
    setStep1Saved(true);
    setStep(2);
  }

  async function saveChannels() {
    setSavingCh(true);
    const res = await fetch('/api/onboarding/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    setSavingCh(false);
    if (res.ok) { await loadStatus(); setStep(5); }
    else { const d = await res.json(); setError({ heading: 'Feil ved kanallagring', detail: d.error ?? 'Prøv igjen.' }); }
  }

  async function activate() {
    setLoading(true); setError(null);
    const res = await fetch('/api/onboarding/activate', { method: 'POST' });
    const d = await res.json();
    setLoading(false);
    if (!res.ok) { setError({ heading: 'Feil ved aktivering', detail: d.error ?? 'Prøv igjen.' }); return; }
    router.push('/waiting');
    router.refresh();
  }

  const CHANNEL_TYPES = [
    { felt: 'live',            label: 'Live-varsling',   desc: 'Boten poster her når stream starter' },
    { felt: 'chat',            label: 'Chat / Generell', desc: 'Promos og generelle meldinger' },
    { felt: 'clips',           label: 'Klipp',           desc: 'Ferdige klipp' },
    { felt: 'subs',            label: 'Subs & Gifts',    desc: 'Sub-anerkjennelser' },
    { felt: 'errors',          label: 'Feil & Varsler',  desc: 'Tekniske feil fra boten' },
  ];

  return (
    <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-5">

        <div className="text-center"><BrandLogo subtitle="Creator OS · Oppsett" /></div>

        <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-6">

          <ProgressBar step={step} />

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 space-y-1">
              <p className="text-xs font-bold text-red-400">{error.heading}</p>
              <p className="text-[11px] text-red-400/70">{error.detail}</p>
              <button
                onClick={() => setError(null)}
                className="text-[10px] text-red-400/50 hover:text-red-400 underline underline-offset-2 transition-colors"
              >
                Lukk
              </button>
            </div>
          )}

          {/* ── Step 1: Workspace ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg 1 av 5</p>
                <h2 className="text-base font-black text-g-text mt-0.5">Velkommen til Glenvex</h2>
                <p className="text-xs text-g-muted mt-0.5">Sett opp ditt creator workspace.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1">Ditt navn / kanalnavn</label>
                  <input type="text" value={brandName}
                    onChange={e => { setBrandName(e.target.value); setWsSlug(slugify(e.target.value)); }}
                    placeholder="f.eks. NordicGamer"
                    className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder-g-muted/40 focus:outline-none focus:border-g-green/50 transition-colors" />
                </div>
                <div>
                  <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1">Workspace ID</label>
                  <input type="text" value={wsSlug}
                    onChange={e => setWsSlug(slugify(e.target.value))}
                    placeholder="nordicgamer"
                    className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder-g-muted/40 focus:outline-none focus:border-g-green/50 font-mono text-xs transition-colors" />
                  <p className="text-[9px] text-g-muted mt-1">Kun små bokstaver og bindestrek. Kan ikke endres etter opprettelse.</p>
                </div>
              </div>
              <button onClick={saveWorkspace} disabled={loading || brandName.length < 2 || wsSlug.length < 2}
                className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                {loading ? 'Oppretter workspace...' : 'Opprett workspace →'}
              </button>
            </div>
          )}

          {/* ── Step 2: Twitch ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg 2 av 5</p>
                <h2 className="text-base font-black text-g-text mt-0.5">Koble til Twitch</h2>
                <p className="text-xs text-g-muted mt-0.5">Autoriser Glenvex til å lese din Twitch-kanal.</p>
              </div>
              <ConnectButton
                href="/api/auth/twitch"
                icon="🟣"
                label="Koble til Twitch"
                connected={!!status?.twitchConnected}
                connectedLabel={status?.twitchDisplayName ?? status?.twitchLogin ?? 'Tilkoblet'}
              />
              {status?.twitchConnected && (
                <button onClick={() => setStep(3)}
                  className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all">
                  Neste →
                </button>
              )}
            </div>
          )}

          {/* ── Step 3: Discord ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg 3 av 5</p>
                <h2 className="text-base font-black text-g-text mt-0.5">Koble til Discord</h2>
                <p className="text-xs text-g-muted mt-0.5">Legg til Glenvex-boten på Discord-serveren din.</p>
              </div>
              <ConnectButton
                href="/api/auth/discord-bot"
                icon="🔵"
                label="Legg til Discord-bot"
                connected={!!status?.discordConnected}
                connectedLabel={status?.guildName ?? 'Server tilkoblet'}
              />
              {status?.discordConnected && (
                <button onClick={() => setStep(4)}
                  className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all">
                  Neste →
                </button>
              )}
            </div>
          )}

          {/* ── Step 4: Channels ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg 4 av 5</p>
                <h2 className="text-base font-black text-g-text mt-0.5">Velg kanaler</h2>
                <p className="text-xs text-g-muted mt-0.5">Hvilke Discord-kanaler skal boten bruke?</p>
              </div>
              <div className="space-y-2">
                {CHANNEL_TYPES.map(({ felt, label, desc }) => (
                  <div key={felt} className="grid grid-cols-[1fr_auto] gap-3 items-center py-1.5 border-b border-g-border/30 last:border-0">
                    <div>
                      <p className="text-xs text-g-text">{label}</p>
                      <p className="text-[9px] text-g-muted">{desc}</p>
                    </div>
                    <select
                      value={prefs[felt] ?? ''}
                      onChange={e => setPrefs(p => ({ ...p, [felt]: e.target.value }))}
                      className="bg-g-bg border border-g-border rounded px-2 py-1.5 text-[10px] text-g-text font-mono focus:outline-none focus:border-g-green/40 min-w-[160px]">
                      <option value="">— Ikke satt —</option>
                      {channels.map(k => (
                        <option key={k.id} value={k.id}>#{k.navn} ({k.kategori})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {channelsLoading && (
                <p className="text-[10px] text-g-muted">Henter kanaler fra Discord...</p>
              )}
              {!channelsLoading && channelsLoaded && channels.length === 0 && (
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
                  <p className="text-xs font-bold text-yellow-400">Ingen kanaler funnet</p>
                  <p className="text-[11px] text-g-muted/70 leading-snug">
                    Dette kan skyldes at boten ikke er riktig invitert, mangler rettigheter til å lese kanaler, eller Discord-serveren har ingen tekstkanaler.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      href="/api/auth/discord-bot"
                      className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[11px] text-g-green font-bold hover:bg-g-green/20 transition-colors"
                    >
                      Inviter bot på nytt
                    </a>
                    <button
                      onClick={loadChannels}
                      className="px-3 py-1.5 border border-g-border rounded-lg text-[11px] text-g-muted font-bold hover:text-g-text hover:border-g-border/80 transition-colors"
                    >
                      Prøv å hente kanaler igjen
                    </button>
                  </div>
                  <p className="text-[10px] text-g-muted/40">
                    Boten trenger: <span className="font-mono">Read Messages</span> og <span className="font-mono">Send Messages</span>
                  </p>
                </div>
              )}
              <button onClick={saveChannels} disabled={savingCh}
                className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all disabled:opacity-50">
                {savingCh ? 'Lagrer...' : 'Lagre og fortsett →'}
              </button>
              <button onClick={() => setStep(5)} disabled={savingCh}
                className="w-full text-[11px] text-g-muted hover:text-g-text transition-colors py-1">
                Hopp over for nå
              </button>
            </div>
          )}

          {/* ── Step 5: Activate ── */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg 5 av 5</p>
                <h2 className="text-base font-black text-g-text mt-0.5">Aktiver Glenvex</h2>
                <p className="text-xs text-g-muted mt-0.5">Se over og send inn forespørselen.</p>
              </div>

              <div className="bg-g-bg border border-g-border rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-bold text-g-muted uppercase tracking-widest">Oppsummering</p>
                {[
                  { label: 'Workspace', val: status?.workspaceId ?? '–', ok: !!status?.workspaceId },
                  { label: 'Twitch', val: status?.twitchDisplayName ?? status?.twitchLogin ?? 'Ikke tilkoblet', ok: !!status?.twitchConnected },
                  { label: 'Discord', val: status?.guildName ?? 'Ikke tilkoblet', ok: !!status?.discordConnected },
                  { label: 'Kanaler', val: status?.channelsSaved ? 'Lagret' : 'Ikke satt', ok: !!status?.channelsSaved },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between">
                    <span className="text-[11px] text-g-muted">{r.label}</span>
                    <span className={`text-[11px] font-bold ${r.ok ? 'text-g-green' : 'text-g-muted'}`}>
                      {r.ok ? '✓' : '○'} {r.val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-g-bg/50 border border-g-border/30 rounded-lg p-3">
                <p className="text-[10px] text-g-muted leading-relaxed">
                  Etter aktivering går du til ventelisten. En administrator vil godkjenne deg som alpha-tester og åpne tilgangen.
                </p>
              </div>

              <button onClick={activate} disabled={loading}
                className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green font-bold text-sm py-3 rounded-lg transition-all disabled:opacity-50">
                {loading ? 'Aktiverer...' : '→ Send inn og vent på godkjenning'}
              </button>
            </div>
          )}

          {/* Back navigation */}
          {step > 1 && step < 5 && (
            <button onClick={() => setStep(s => s - 1)}
              className="w-full py-2 text-[11px] text-g-muted hover:text-g-text transition-colors">
              ← Tilbake
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
