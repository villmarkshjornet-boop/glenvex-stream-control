'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [useMagic, setUseMagic] = useState(false);

  // Håndter ?code= fra Supabase magic link (fallback hvis middleware ikke fanget det)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      window.location.href = `/api/auth/callback?code=${encodeURIComponent(code)}`;
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Step 1: ping to verify the API is reachable at all
    try {
      const ping = await fetch('/api/auth/ping');
      if (!ping.ok) {
        setError(`Login API nås men returnerer feil (ping HTTP ${ping.status}). Sjekk Vercel logs.`);
        setLoading(false);
        return;
      }
      const pingData = await ping.json().catch(() => null);
      if (!pingData?.ok) {
        setError(`Ping returnerte uventet svar: ${JSON.stringify(pingData)}`);
        setLoading(false);
        return;
      }
      if (!pingData.env?.supabaseUrl || !pingData.env?.supabaseAnonKey) {
        setError(`Supabase env mangler i Vercel: supabaseUrl=${pingData.env?.supabaseUrl} anonKey=${pingData.env?.supabaseAnonKey}`);
        setLoading(false);
        return;
      }
    } catch (pingErr: any) {
      setError(`Login API unreachable (ping feilet): ${pingErr.message}`);
      setLoading(false);
      return;
    }

    // Step 2: actual login
    let res: Response | undefined;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          mode: useMagic ? 'magic' : mode,
        }),
      });
    } catch (networkErr: any) {
      setError(`/api/auth/login unreachable (fetch failed): ${networkErr.message}`);
      setLoading(false);
      return;
    }

    try {
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Serverfeil (HTTP ${res.status})`);
        return;
      }

      if (data.magic) {
        setMagicSent(true);
      } else if (data.immediate) {
        window.location.href = '/onboarding';
      } else {
        window.location.href = data.workspaceId ? '/' : '/onboarding';
      }
    } catch (err: any) {
      setError(`Ugyldig svar fra /api/auth/login (HTTP ${res.status}): ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (magicSent) {
    return (
      <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="w-14 h-14 rounded-full bg-g-green/10 border border-g-green/30 flex items-center justify-center mx-auto">
            <span className="text-g-green text-2xl">✓</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-g-text">Sjekk e-posten din</h2>
            <p className="text-sm text-g-muted mt-2 leading-relaxed">
              Vi har sendt en innloggingslenke til{' '}
              <span className="text-g-text font-medium">{email}</span>.
            </p>
          </div>
          <button
            onClick={() => setMagicSent(false)}
            className="text-xs text-g-muted/60 hover:text-g-muted transition-colors"
          >
            ← Tilbake
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-g-bg p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <p className="text-xl font-bold tracking-widest text-g-green font-mono">GLENVEX</p>
          <p className="text-xs text-g-muted mt-1">Creator OS</p>
        </div>

        {/* Card */}
        <div className="bg-g-card border border-g-border rounded-2xl p-8 space-y-5">
          <div>
            <h1 className="text-base font-semibold text-g-text">
              {mode === 'signin' ? 'Logg inn' : 'Opprett konto'}
            </h1>
            <p className="text-sm text-g-muted mt-1">
              {mode === 'signin' ? 'Velkommen tilbake' : 'Kom i gang på under 5 minutter'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium tracking-wide text-g-muted block">
                E-post
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="din@epost.no"
                required
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
              />
            </div>

            {!useMagic && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium tracking-wide text-g-muted block">
                  Passord
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required={!useMagic}
                  minLength={6}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-5 py-2.5 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 hover:shadow-green-sm transition-all duration-200 disabled:opacity-40"
            >
              {loading
                ? 'Venter...'
                : useMagic
                ? 'Send innloggingslenke'
                : mode === 'signin'
                ? 'Logg inn'
                : 'Opprett konto'}
            </button>
          </form>

          {/* Magic link toggle */}
          <button
            onClick={() => { setUseMagic(v => !v); setError(''); }}
            className="w-full text-xs text-g-muted/60 hover:text-g-muted transition-colors text-center"
          >
            {useMagic ? 'Bruk passord i stedet' : 'Logg inn uten passord (e-postlenke)'}
          </button>
        </div>

        {/* Footer — toggle mode */}
        <div className="text-center mt-6">
          <span className="text-xs text-g-muted/60">
            {mode === 'signin' ? 'Har du ikke konto?' : 'Har du allerede konto?'}{' '}
          </span>
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
            className="text-xs text-g-muted hover:text-g-text transition-colors font-medium"
          >
            {mode === 'signin' ? 'Registrer deg' : 'Logg inn'}
          </button>
        </div>

      </div>
    </div>
  );
}
